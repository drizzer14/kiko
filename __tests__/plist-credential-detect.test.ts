import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

// scripts/checks/plist.sh computes its ROOT as scripts/checks/../.., so each
// case runs a COPY of it inside a throwaway root whose Info.plist, .env and
// src/ clients the test controls.
const REPOSITORY_ROOT = join(__dirname, '..');
const SCRIPT = join(REPOSITORY_ROOT, 'scripts/checks/plist.sh');
const LIB = join(REPOSITORY_ROOT, 'scripts/checks/_lib.sh');

const QUOTES_HOST = 'quotes.example.com';

const createdPaths: string[] = [];

const writeFile = (root: string, relativePath: string, body: string): void => {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, body);
};

const pinnedDomainEntry = (host: string, pins: string[]): string =>
  [
    `<key>${host}</key>`,
    '<dict>',
    '<key>NSIncludesSubdomains</key>',
    '<false/>',
    '<key>NSPinnedCAIdentities</key>',
    '<array>',
    ...pins.map((pin) => `<dict><key>SPKI-SHA256-BASE64</key><string>${pin}</string></dict>`),
    '</array>',
    '</dict>',
  ].join('\n');

const infoPlist = (pinnedDomains: Record<string, string[]>): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '<key>NSAppTransportSecurity</key>',
    '<dict>',
    '<key>NSAllowsArbitraryLoads</key>',
    '<false/>',
    '<key>NSPinnedDomains</key>',
    '<dict>',
    ...Object.entries(pinnedDomains).map(([host, pins]) => pinnedDomainEntry(host, pins)),
    '</dict>',
    '</dict>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');

const buildRoot = (pinnedDomains: Record<string, string[]>, client: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'kiko-plist-'));
  createdPaths.push(root);
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'scripts/checks/plist.sh'));
  copyFileSync(LIB, join(root, 'scripts/checks/_lib.sh'));
  writeFile(root, 'ios/Kiko/Info.plist', infoPlist(pinnedDomains));
  writeFile(
    root,
    'ios/Kiko.xcodeproj/project.pbxproj',
    'name = "Inject Debug-only ATS local networking";\n',
  );
  writeFile(root, '.env', `QUOTES_API_ENDPOINT=https://${QUOTES_HOST}/api\n`);
  writeFile(root, 'src/quotes.client.ts', client);

  return root;
};

const runPlistCheck = (root: string) =>
  spawnSync('bash', [join(root, 'scripts/checks/plist.sh')], { encoding: 'utf8' });

const QUERY_TOKEN_CLIENT = [
  "import { QUOTES_API_ENDPOINT } from '@env';",
  '',
  'export const quoteUrl = (token: string): string =>',
  "  `${QUOTES_API_ENDPOINT}/eod?${new URLSearchParams({ 'api_token': token })}`;",
  '',
].join('\n');

const NO_CREDENTIAL_CLIENT = [
  "import { QUOTES_API_ENDPOINT } from '@env';",
  '',
  'export const quoteUrl = (): string => `${QUOTES_API_ENDPOINT}/eod`;',
  '',
].join('\n');

const TWO_PINS = [
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
];

afterEach(() => {
  while (createdPaths.length > 0) {
    const path = createdPaths.pop();

    if (path) rmSync(path, { recursive: true, force: true });
  }
});

describe('scripts/checks/plist.sh credential detection', () => {
  it("fails (exit 2) naming the host when an 'api_token' client's @env host is unpinned", () => {
    const result = runPlistCheck(buildRoot({}, QUERY_TOKEN_CLIENT));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(QUOTES_HOST);
    expect(result.stderr).toContain('src/quotes.client.ts');
  });

  it("passes when the 'api_token' client's host is pinned with two CA pins", () => {
    const result = runPlistCheck(buildRoot({ [QUOTES_HOST]: TWO_PINS }, QUERY_TOKEN_CLIENT));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('ignores a client that carries no credential marker', () => {
    const result = runPlistCheck(buildRoot({}, NO_CREDENTIAL_CLIENT));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('passes on the real repository', () => {
    const result = spawnSync('bash', [SCRIPT], { encoding: 'utf8' });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
