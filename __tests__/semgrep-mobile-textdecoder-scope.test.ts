import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

// kiko-no-textdecoder-textencoder's message says the ban is "under src/", so its `paths.include`
// must keep a single-file scan of an e2e/ file (the fast-tier hook's own shape) from failing
// Class A. This runs the REAL semgrep binary against the REAL rules file on a throwaway project
// tree.
const MOBILE_RULES = join(__dirname, '../rules/semgrep-mobile.yml');
const RULE_ID_SUFFIX = 'kiko-no-textdecoder-textencoder';
const SOURCE = 'export const decoded = new TextDecoder().decode(new Uint8Array());\n';

const createdDirectories: string[] = [];

function createProject(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kiko-textdecoder-scope-'));
  createdDirectories.push(directory);

  return directory;
}

function writeProjectFile(project: string, relativePath: string): string {
  const absolutePath = join(project, relativePath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, SOURCE);

  return absolutePath;
}

function ruleFindings(project: string, target: string): string[] {
  const result = spawnSync(
    'semgrep',
    ['--quiet', '--metrics', 'off', '--json', '--config', MOBILE_RULES, target],
    { encoding: 'utf8', cwd: project },
  );
  const parsed = JSON.parse(result.stdout) as {
    results: { check_id: string }[];
    errors: unknown[];
  };

  // A Semgrep error would leave no findings and let the e2e case pass vacuously.
  expect(result.status).toBe(0);
  expect(parsed.errors).toEqual([]);

  return parsed.results
    .map((finding) => finding.check_id)
    .filter((identifier) => identifier.endsWith(RULE_ID_SUFFIX));
}

afterEach(() => {
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();

    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('kiko-no-textdecoder-textencoder scope', () => {
  it('reports a TextDecoder use under src/ (positive control)', () => {
    const project = createProject();
    const target = writeProjectFile(project, 'src/data-transfer/decode.ts');

    expect(ruleFindings(project, target)).toHaveLength(1);
    expect(ruleFindings(project, 'src/data-transfer/decode.ts')).toHaveLength(1);
  });

  it('draws no finding for a TextDecoder use in an e2e/ file scanned alone', () => {
    const project = createProject();
    const target = writeProjectFile(project, 'e2e/screenshot/fixtures/generate-demo.ts');

    expect(ruleFindings(project, target)).toEqual([]);
    expect(ruleFindings(project, 'e2e/screenshot/fixtures/generate-demo.ts')).toEqual([]);
  });
});
