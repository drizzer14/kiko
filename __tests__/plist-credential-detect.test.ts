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

const PROJECT_PATH = 'ios/Kiko.xcodeproj/project.pbxproj';
const ENGLISH_NAME_TABLE = 'ios/Kiko/en.lproj/InfoPlist.strings';
const UKRAINIAN_NAME_TABLE = 'ios/Kiko/uk.lproj/InfoPlist.strings';
const PRIVACY_MANIFEST = 'ios/Kiko/PrivacyInfo.xcprivacy';

const BOTH_DISK_SPACE_SOURCES =
  '{ "dependencies": { "react-native-fs": "2.20.0", "@op-engineering/op-sqlite": "18.1.4" } }\n';

// The PBXBuildFile line also says "in Resources", so only an entry inside the
// Resources build phase section proves the build copies the tables.
const projectFile = (
  nameTables: string[],
  resourcesPhaseFiles: string[] = ['InfoPlist.strings'],
): string =>
  [
    'name = "Inject Debug-only ATS local networking";',
    '862F59B3640A40159C5B4910 /* InfoPlist.strings in Resources */ = {isa = PBXBuildFile; };',
    ...nameTables.map((table) => `path = Kiko/${table}.lproj/InfoPlist.strings;`),
    '/* Begin PBXResourcesBuildPhase section */',
    ...resourcesPhaseFiles.map((file) => `0000000000000000000000AA /* ${file} in Resources */,`),
    '/* End PBXResourcesBuildPhase section */',
    '',
  ].join('\n');

const privacyManifest = (categories: string[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '<key>NSPrivacyAccessedAPITypes</key>',
    '<array>',
    ...categories.map(
      (category) =>
        `<dict><key>NSPrivacyAccessedAPIType</key><string>${category}</string><key>NSPrivacyAccessedAPITypeReasons</key><array><string>E174.1</string></array></dict>`,
    ),
    '</array>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');

// Every root starts valid on every assertion but the one a case breaks: an
// override replaces a file's body, and `null` deletes the file.
const buildRoot = (
  pinnedDomains: Record<string, string[]>,
  client: string,
  overrides: Record<string, string | null> = {},
): string => {
  const root = mkdtempSync(join(tmpdir(), 'kiko-plist-'));
  createdPaths.push(root);
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'scripts/checks/plist.sh'));
  copyFileSync(LIB, join(root, 'scripts/checks/_lib.sh'));
  writeFile(root, 'ios/Kiko/Info.plist', infoPlist(pinnedDomains));
  writeFile(root, PROJECT_PATH, projectFile(['en', 'uk']));
  writeFile(root, ENGLISH_NAME_TABLE, '"CFBundleDisplayName" = "Kiko";\n');
  writeFile(root, UKRAINIAN_NAME_TABLE, '"CFBundleDisplayName" = "Кіко";\n');
  writeFile(root, PRIVACY_MANIFEST, privacyManifest(['NSPrivacyAccessedAPICategoryDiskSpace']));
  writeFile(root, 'package.json', BOTH_DISK_SPACE_SOURCES);
  writeFile(root, '.env', `QUOTES_API_ENDPOINT=https://${QUOTES_HOST}/api\n`);
  writeFile(root, 'src/quotes.client.ts', client);

  for (const [relativePath, body] of Object.entries(overrides)) {
    if (body === null) {
      rmSync(join(root, relativePath));
    } else {
      writeFile(root, relativePath, body);
    }
  }

  return root;
};

const runPlistCheck = (root: string, environment: NodeJS.ProcessEnv = process.env) =>
  spawnSync('bash', [join(root, 'scripts/checks/plist.sh')], {
    encoding: 'utf8',
    env: environment,
  });

// A `node` that always fails, first on PATH: the check must fail closed, not
// read an empty answer as "react-native-fs does not ship".
const brokenNodeEnvironment = (root: string): NodeJS.ProcessEnv => {
  const shimDirectory = join(root, 'broken-node-bin');
  mkdirSync(shimDirectory);
  writeFileSync(join(shimDirectory, 'node'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

  return { ...process.env, PATH: `${shimDirectory}:${process.env.PATH}` };
};

const QUERY_TOKEN_CLIENT = [
  "import { QUOTES_API_ENDPOINT } from '@env';",
  '',
  "const NO_STORE: RequestInit = { headers: { 'Cache-Control': 'no-store' } };",
  '',
  'export const fetchQuote = (token: string): Promise<Response> =>',
  "  fetch(`${QUOTES_API_ENDPOINT}/eod?${new URLSearchParams({ 'api_token': token })}`, NO_STORE);",
  '',
].join('\n');

const CACHEABLE_QUERY_TOKEN_CLIENT = [
  "import { QUOTES_API_ENDPOINT } from '@env';",
  '',
  'export const fetchQuote = (token: string): Promise<Response> =>',
  "  fetch(QUOTES_API_ENDPOINT + '/eod?' + new URLSearchParams({ api_token: token }));",
  '',
].join('\n');

const NO_CACHE_QUERY_TOKEN_CLIENT = [
  "import { QUOTES_API_ENDPOINT } from '@env';",
  '',
  'export const fetchQuote = (token: string): Promise<Response> =>',
  "  fetch(QUOTES_API_ENDPOINT + '/eod?api_token=' + token, {",
  "    headers: { 'Cache-Control': 'no-cache' },",
  '  });',
  '',
].join('\n');

const HEADERS_SET_QUERY_TOKEN_CLIENT = [
  "import { QUOTES_API_ENDPOINT } from '@env';",
  '',
  'export const fetchQuote = (token: string): Promise<Response> => {',
  '  const headers = new Headers();',
  "  headers.set('cache-control', 'no-store');",
  '',
  "  return fetch(QUOTES_API_ENDPOINT + '/eod?api_token=' + token, { headers });",
  '};',
  '',
].join('\n');

const HEADER_TOKEN_CLIENT = [
  "import { QUOTES_API_ENDPOINT } from '@env';",
  '',
  'export const fetchQuote = (token: string): Promise<Response> =>',
  "  fetch(QUOTES_API_ENDPOINT + '/eod', { headers: { 'X-Token': token } });",
  '',
].join('\n');

const UNQUOTED_KEY_TOKEN_CLIENT = [
  "import { QUOTES_API_ENDPOINT } from '@env';",
  '',
  'export const quoteUrl = (token: string): string =>',
  '  `${QUOTES_API_ENDPOINT}/eod?${new URLSearchParams({ api_token: token })}`;',
  '',
].join('\n');

const TEMPLATE_QUERY_TOKEN_CLIENT = [
  "import { QUOTES_API_ENDPOINT } from '@env';",
  '',
  'export const quoteUrl = (token: string): string =>',
  '  `${QUOTES_API_ENDPOINT}/eod?api_token=${token}`;',
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
  createdPaths.splice(0).forEach((path) => {
    rmSync(path, { recursive: true, force: true });
  });
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

  it('finds a pinned host that sorts first in a pinned-domain list far larger than a pipe buffer', () => {
    // 4000 hosts of about 21 bytes each is past the 64 KB pipe buffer; the fillers start with
    // "z" so the real host is listed before them and grep -x stops reading early.
    const fillers = Object.fromEntries(
      Array.from({ length: 4000 }, (_, index) => [`zz-${index}.example.com`, TWO_PINS]),
    );
    const result = runPlistCheck(
      buildRoot({ [QUOTES_HOST]: TWO_PINS, ...fillers }, QUERY_TOKEN_CLIENT),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('fails (exit 2) when the formatter unquoted the api_token object key', () => {
    const result = runPlistCheck(buildRoot({}, UNQUOTED_KEY_TOKEN_CLIENT));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(QUOTES_HOST);
  });

  it('fails (exit 2) when api_token sits in a template query string', () => {
    const result = runPlistCheck(buildRoot({}, TEMPLATE_QUERY_TOKEN_CLIENT));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(QUOTES_HOST);
  });

  it("fails (exit 2) naming the file when a pinned 'api_token' client sends no Cache-Control: no-store", () => {
    const result = runPlistCheck(
      buildRoot({ [QUOTES_HOST]: TWO_PINS }, CACHEABLE_QUERY_TOKEN_CLIENT),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('src/quotes.client.ts');
    expect(result.stderr).toContain('no-store');
  });

  it("fails (exit 2) when the 'api_token' client sends Cache-Control: no-cache, not no-store", () => {
    const result = runPlistCheck(
      buildRoot({ [QUOTES_HOST]: TWO_PINS }, NO_CACHE_QUERY_TOKEN_CLIENT),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('src/quotes.client.ts');
  });

  it("passes when the 'api_token' client sets a lowercase cache-control: no-store through Headers.set", () => {
    const result = runPlistCheck(
      buildRoot({ [QUOTES_HOST]: TWO_PINS }, HEADERS_SET_QUERY_TOKEN_CLIENT),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('does not require no-store from a client whose credential is a header, not a URL parameter', () => {
    const result = runPlistCheck(buildRoot({ [QUOTES_HOST]: TWO_PINS }, HEADER_TOKEN_CLIENT));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('ignores a client that carries no credential marker', () => {
    const result = runPlistCheck(buildRoot({}, NO_CREDENTIAL_CLIENT));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});

describe('scripts/checks/plist.sh localized home-screen name', () => {
  it('fails (exit 2) naming the table when the Ukrainian name table is missing', () => {
    const result = runPlistCheck(
      buildRoot({}, NO_CREDENTIAL_CLIENT, { [UKRAINIAN_NAME_TABLE]: null }),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('uk.lproj/InfoPlist.strings');
  });

  it('fails (exit 2) when the Ukrainian table carries the Latin name', () => {
    const result = runPlistCheck(
      buildRoot({}, NO_CREDENTIAL_CLIENT, {
        [UKRAINIAN_NAME_TABLE]: '"CFBundleDisplayName" = "Kiko";\n',
      }),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('uk.lproj/InfoPlist.strings');
  });

  it('fails (exit 2) when the Xcode project does not reference the English table', () => {
    const result = runPlistCheck(
      buildRoot({}, NO_CREDENTIAL_CLIENT, { [PROJECT_PATH]: projectFile(['uk']) }),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('en.lproj/InfoPlist.strings');
  });

  it('passes when the Resources build phase is far larger than a pipe buffer and lists the table first', () => {
    const padding = Array.from({ length: 3000 }, (_, index) => `Padding-${index}.png`);
    const result = runPlistCheck(
      buildRoot({}, NO_CREDENTIAL_CLIENT, {
        [PROJECT_PATH]: projectFile(['en', 'uk'], ['InfoPlist.strings', ...padding]),
      }),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('fails (exit 2) when the tables are a build file but not in the Resources build phase', () => {
    const result = runPlistCheck(
      buildRoot({}, NO_CREDENTIAL_CLIENT, {
        [PROJECT_PATH]: projectFile(['en', 'uk'], ['PrivacyInfo.xcprivacy']),
      }),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Resources build phase');
  });
});

describe('scripts/checks/plist.sh disk-space privacy reason', () => {
  it('fails (exit 2) when react-native-fs ships and the manifest declares no DiskSpace reason', () => {
    const result = runPlistCheck(
      buildRoot({}, NO_CREDENTIAL_CLIENT, { [PRIVACY_MANIFEST]: privacyManifest([]) }),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('NSPrivacyAccessedAPICategoryDiskSpace');
  });

  // op-sqlite's bundled SQLite (SQLCipher included) calls fstatfs on Apple
  // platforms, so the reason stays required after react-native-fs goes.
  it('fails (exit 2) when only op-sqlite ships and the manifest declares no DiskSpace reason', () => {
    const result = runPlistCheck(
      buildRoot({}, NO_CREDENTIAL_CLIENT, {
        [PRIVACY_MANIFEST]: privacyManifest([]),
        'package.json': '{ "dependencies": { "@op-engineering/op-sqlite": "18.1.4" } }\n',
      }),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('@op-engineering/op-sqlite');
    expect(result.stderr).toContain('NSPrivacyAccessedAPICategoryDiskSpace');
  });

  it('passes when only op-sqlite ships and the manifest declares the DiskSpace reason', () => {
    const result = runPlistCheck(
      buildRoot({}, NO_CREDENTIAL_CLIENT, {
        'package.json': '{ "dependencies": { "@op-engineering/op-sqlite": "18.1.4" } }\n',
      }),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('passes without a DiskSpace reason once no disk-space API user is a dependency', () => {
    const result = runPlistCheck(
      buildRoot({}, NO_CREDENTIAL_CLIENT, {
        [PRIVACY_MANIFEST]: privacyManifest([]),
        'package.json': '{ "dependencies": {} }\n',
      }),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('fails (exit 2) when node cannot tell which disk-space API users ship', () => {
    const root = buildRoot({}, NO_CREDENTIAL_CLIENT);
    const result = runPlistCheck(root, brokenNodeEnvironment(root));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('react-native-fs');
    expect(result.stderr).toContain('@op-engineering/op-sqlite');
  });
});
