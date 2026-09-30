import {
  rmSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  copyFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/lint.sh (the fast-tier Biome wrapper, run per-file on every
// Edit/Write/MultiEdit) must not fail a file biome.json deliberately excludes
// from linting entirely (biome.json's files.includes: "!rules/fixtures/**/*.bad.*")
// — Biome reports "No files were processed in the specified paths." with a
// non-zero exit for such a target, which is Biome saying "out of scope", not
// "found a violation"; a clean, ignored file must never trip a failure
// block.
//
// Biome prints that EXACT SAME message for a path that does not exist at all
// (internalError/io, swallowed underneath it) — so the check must not treat
// every occurrence of the message as "out of scope"; it must fail closed for
// a target that simply isn't there.
//
// A good fixture is format-checked like any source file, but never linted: it
// may hold a shape another rule's lint would reject. The fixture rows run a
// copy of lint.sh against the real biome.json in a throwaway root, so no test
// writes into the real rules/fixtures/.
const REPOSITORY_ROOT = join(__dirname, '..');

const SCRIPT = join(REPOSITORY_ROOT, 'scripts/checks/lint.sh');

const runLint = (target: string, cwd?: string): SpawnSyncReturns<string> =>
  spawnSync('bash', [join(cwd ?? REPOSITORY_ROOT, 'scripts/checks/lint.sh'), target], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: mkdtempSync(join(tmpdir(), 'kiko-lint-state-')) },
  });

const fixtureRoot = (files: Record<string, string>): string => {
  // Biome matches files.includes against the real path of its root, and the
  // macOS tmpdir is a symlink (/var -> /private/var).
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kiko-lint-fixture-')));
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'scripts/checks/lint.sh'));
  copyFileSync(
    join(REPOSITORY_ROOT, 'scripts/checks/_lib.sh'),
    join(root, 'scripts/checks/_lib.sh'),
  );
  copyFileSync(join(REPOSITORY_ROOT, 'biome.json'), join(root, 'biome.json'));
  symlinkSync(join(REPOSITORY_ROOT, 'node_modules'), join(root, 'node_modules'));
  execFileSync('git', ['init', '-q'], { cwd: root });

  for (const [relativePath, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, relativePath)), { recursive: true });
    writeFileSync(join(root, relativePath), body);
  }

  return root;
};

const UNFORMATTED = 'export const value = {a:1};\n';

const FORMATTED_LINT_FAILURE = 'export const pass = (value: any) => value;\n';

describe('scripts/checks/lint.sh', () => {
  it('exits 0 for a bad fixture, which biome.json excludes (rules/fixtures/**/*.bad.*)', () => {
    const result = runLint(join(REPOSITORY_ROOT, 'rules/fixtures/kiko-no-switch.bad.ts'));

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('exits 0 for an unformatted bad fixture', () => {
    const root = fixtureRoot({ 'rules/fixtures/kiko-probe.bad.ts': UNFORMATTED });

    const result = runLint(join(root, 'rules/fixtures/kiko-probe.bad.ts'), root);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('format-checks a good fixture', () => {
    const root = fixtureRoot({ 'rules/fixtures/kiko-probe.good.ts': UNFORMATTED });

    const result = runLint(join(root, 'rules/fixtures/kiko-probe.good.ts'), root);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED');
    expect(result.stderr).toContain('format');
  });

  it('does not lint a formatted good fixture, nested or flat', () => {
    const root = fixtureRoot({
      'rules/fixtures/kiko-probe.good.ts': FORMATTED_LINT_FAILURE,
      'rules/fixtures/kiko-probe/src/x/probe.good.tsx': FORMATTED_LINT_FAILURE,
    });

    const flat = runLint(join(root, 'rules/fixtures/kiko-probe.good.ts'), root);
    const nested = runLint(join(root, 'rules/fixtures/kiko-probe/src/x/probe.good.tsx'), root);

    expect([flat.status, flat.stderr]).toEqual([0, '']);
    expect([nested.status, nested.stderr]).toEqual([0, '']);
  });

  it('fails closed for a nonexistent path instead of reading it as excluded', () => {
    const result = runLint(join(REPOSITORY_ROOT, 'src/does-not-exist.ts'));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED');
  });

  it('fails for a real file with a lint violation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kiko-lint-violation-'));
    const target = join(directory, 'violation.ts');
    writeFileSync(target, FORMATTED_LINT_FAILURE);

    const result = runLint(target);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED');
    expect(result.stderr).toContain('noExplicitAny');
  });

  // biome.json sets vcs.useIgnoreFile: true, so Biome itself reports "No
  // files were processed…" for ANY real file .gitignore covers — not only
  // the biome.json files.includes exclusions above. lint.sh's hand-copied
  // case list (ios/, vendor/, coverage/, rules/fixtures/, *.jsbundle) must
  // also treat a gitignored path like .claude/worktrees/ as out of scope —
  // a clean, ignored file must never fail.
  it('exits 0 for a clean file under a gitignored path outside the biome.json exclude list', () => {
    const directory = join(REPOSITORY_ROOT, '.claude/worktrees/kiko-lint-gitignore-probe/src');
    mkdirSync(directory, { recursive: true });
    const target = join(directory, 'clean.ts');
    writeFileSync(target, 'export const value = 1;\n');

    try {
      const result = runLint(target);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    } finally {
      rmSync(join(REPOSITORY_ROOT, '.claude/worktrees/kiko-lint-gitignore-probe'), {
        recursive: true,
        force: true,
      });
    }
  });
});
