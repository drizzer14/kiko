import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';

// scripts/checks/semgrep-rules.sh discovers a fixture pair by FILENAME
// (`<rule-id>.(bad|good).<ext>`) at the top of rules/fixtures/. A rule
// scoped by `paths.include` (a path-prefixed glob) needs its fixture placed
// under a mirrored path for the include to match at all — kiko-linter's
// "Semgrep facts" gotcha — so the runner must ALSO discover a fixture
// nested at `rules/fixtures/<rule-id>/<mirrored path>/<name>.(bad|good).<ext>`,
// crediting it to the rule id named by the FIRST directory segment, not by
// its own filename. This test proves that discovery mechanism in isolation,
// via the `KIKO_RULES_FIXTURES` seam (never against the real, much larger
// rules/fixtures/ tree), reusing the real `kiko-no-switch` fixture pair's
// own content so the probe still exercises a real rule under the project's
// real rules/semgrep-mobile.yml + rules/semgrep-prewrite.yml configs.
const SCRIPT = join(__dirname, '../scripts/checks/semgrep-rules.sh');
const REAL_FIXTURES = join(__dirname, '../rules/fixtures');
const REAL_BAD = join(REAL_FIXTURES, 'kiko-no-switch.bad.ts');
const REAL_GOOD = join(REAL_FIXTURES, 'kiko-no-switch.good.ts');

function runScript(fixturesDirectory: string): SpawnSyncReturns<string> {
  return spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, KIKO_RULES_FIXTURES: fixturesDirectory },
  });
}

function makeTemporaryFixturesRoot(): string {
  return mkdtempSync(join(tmpdir(), 'kiko-nested-fixtures-'));
}

describe('scripts/checks/semgrep-rules.sh nested fixture discovery (KIKO_RULES_FIXTURES seam)', () => {
  it('has semgrep available on PATH', () => {
    const which = spawnSync('which', ['semgrep'], { encoding: 'utf8' });

    expect(which.status).toBe(0);
  });

  it('credits a nested bad fixture (and its nested good pair) toward its rule id', () => {
    const root = makeTemporaryFixturesRoot();
    try {
      const mirrored = join(root, 'kiko-no-switch', 'src', 'somewhere');
      mkdirSync(mirrored, { recursive: true });
      copyFileSync(REAL_BAD, join(mirrored, 'example.bad.ts'));
      copyFileSync(REAL_GOOD, join(mirrored, 'example.good.ts'));

      const result = runScript(root);

      expect(result.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails a nested fixture missing its pair', () => {
    const root = makeTemporaryFixturesRoot();
    try {
      const mirrored = join(root, 'kiko-no-switch', 'src', 'somewhere');
      mkdirSync(mirrored, { recursive: true });
      copyFileSync(REAL_BAD, join(mirrored, 'example.bad.ts'));
      // No .good.ts pair placed alongside it.

      const result = runScript(root);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('no negative fixture');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still discovers a flat, top-level fixture pair (no regression)', () => {
    const root = makeTemporaryFixturesRoot();
    try {
      copyFileSync(REAL_BAD, join(root, 'kiko-no-switch.bad.ts'));
      copyFileSync(REAL_GOOD, join(root, 'kiko-no-switch.good.ts'));

      const result = runScript(root);

      expect(result.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
