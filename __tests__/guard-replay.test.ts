import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';

// scripts/checks/guard-replay.sh replays the pre-write guard on the Stop tier
// for every .ts/.tsx file the session changed outside the guard (a Bash or
// python write, or a commit of one). Every test runs COPIES of the real
// wrappers and the real rule file in a throwaway repository with the real
// Semgrep, so the replay proves the guard's own new-finding semantics, not a
// stub's. The setup commits live in a main checkout and each test works in a
// linked worktree of it, the way an Orca worktree starts: the replay counts
// only the commits made in its own worktree.
const CHECKS = join(__dirname, '../scripts/checks');
const PREWRITE_RULES = join(__dirname, '../rules/semgrep-prewrite.yml');

// The medium-tier wrappers other than the replay run knip, depcheck, and tsc
// against a real project, so the Stop-tier tests replace them with a pass.
const OTHER_MEDIUM_WRAPPERS = [
  'dup.sh',
  'override-guard.sh',
  'knip.sh',
  'deps.sh',
  'semgrep-rules.sh',
  'plist.sh',
  'typecheck.sh',
];

const SWITCH_SOURCE = [
  'export const pick = (value: number): string => {',
  '  switch (value) {',
  '    case 1:',
  "      return 'one';",
  '    default:',
  "      return 'other';",
  '  }',
  '};',
  '',
].join('\n');

const UNSORTED_UNSEPARATED_SOURCE = [
  "import { b } from './bb';",
  "import { a } from './a';",
  '',
  'export const total = (): number => {',
  '  const sum = a + b;',
  '  if (sum > 1) {',
  '    return sum;',
  '  }',
  '  return 0;',
  '};',
  '',
].join('\n');

// Two lines apart, so a change to the first and an append after the last
// merge without a conflict.
const TWO_REGION_SOURCE = [
  'export const first = 1;',
  'export const second = 1;',
  'export const third = 1;',
  'export const last = 1;',
  '',
].join('\n');

const CRASHING_SEMGREP = ['#!/usr/bin/env bash', 'exit 7', ''].join('\n');

// A clean Semgrep that takes 2 s: the guard sends nine fixed flag tokens
// before its targets, and checks every target is in `paths.scanned`.
const SLOW_SEMGREP = [
  '#!/usr/bin/env bash',
  'sleep 2',
  'shift 9',
  'scanned="$(printf \'"%s",\' "$@" | sed \'s/,$//\')"',
  'printf \'{"results":[],"errors":[],"paths":{"scanned":[%s]}}\' "$scanned"',
  '',
].join('\n');

type Checkout = { worktree: string; main: string; state: string; root: string };

type Run = { code: number | null; stderr: string };

const git = (cwd: string, ...gitArguments: string[]): string =>
  execFileSync('git', gitArguments, { cwd, encoding: 'utf8', stdio: 'pipe' });

const writeFile = (root: string, relativePath: string, body: string): void => {
  const absolutePath = join(root, relativePath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, body);
};

const writeExecutable = (root: string, relativePath: string, body: string): string => {
  writeFile(root, relativePath, body);
  const absolutePath = join(root, relativePath);
  execFileSync('chmod', ['755', absolutePath]);

  return absolutePath;
};

const commitAll = (cwd: string, message: string): void => {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', message);
};

const buildCheckout = (
  committedFiles: Record<string, string>,
  { stubOtherMediumWrappers = false } = {},
): Checkout => {
  const root = mkdtempSync(join(tmpdir(), 'kiko-guard-replay-'));
  const main = join(root, 'main');
  const worktree = join(root, 'worktree');
  const state = join(root, 'state');
  mkdirSync(main);
  mkdirSync(state);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.email', 'test@example.com');
  git(main, 'config', 'user.name', 'Test');
  cpSync(CHECKS, join(main, 'scripts/checks'), { recursive: true });
  writeFile(main, 'rules/semgrep-prewrite.yml', readFileSync(PREWRITE_RULES, 'utf8'));
  writeFile(main, 'src/kept.ts', 'export const kept = 1;\n');

  if (stubOtherMediumWrappers) {
    for (const wrapper of OTHER_MEDIUM_WRAPPERS) {
      writeExecutable(main, `scripts/checks/${wrapper}`, '#!/usr/bin/env bash\nexit 0\n');
    }
  }

  for (const [relativePath, body] of Object.entries(committedFiles)) {
    writeFile(main, relativePath, body);
  }

  commitAll(main, 'base');
  git(main, 'worktree', 'add', '-q', '-b', 'feature', worktree);

  return { worktree, main, state, root };
};

// A developer's own KIKO_PREWRITE_* seam must not change which engine a test
// runs; a test's own `environment` still wins.
const wrapperEnvironment = (state: string, environment: Record<string, string>) => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('KIKO_PREWRITE_')),
  ),
  TMPDIR: state,
  ...environment,
});

const runScript = (
  checkout: Checkout,
  scriptName: string,
  environment: Record<string, string> = {},
): Run => {
  const result = spawnSync('bash', [join(checkout.worktree, 'scripts/checks', scriptName)], {
    cwd: checkout.worktree,
    env: wrapperEnvironment(checkout.state, environment),
    encoding: 'utf8',
  });

  return { code: result.status, stderr: result.stderr };
};

const runReplay = (checkout: Checkout, environment: Record<string, string> = {}): Run =>
  runScript(checkout, 'guard-replay.sh', environment);

const crashingSemgrep = (checkout: Checkout): Record<string, string> => ({
  KIKO_PREWRITE_SEMGREP_BIN: writeExecutable(checkout.root, 'semgrep-crash', CRASHING_SEMGREP),
});

const moveMain = (checkout: Checkout): void => {
  writeFile(checkout.main, 'src/other.ts', 'export const other = 1;\n');
  commitAll(checkout.main, 'main moves');
};

const TIMEOUT = 60000;

describe('guard-replay.sh', () => {
  it(
    'fails a violation written into a tracked file outside the guard',
    () => {
      const checkout = buildCheckout({ 'src/pick.ts': 'export const pick = 1;\n' });
      writeFile(checkout.worktree, 'src/pick.ts', SWITCH_SOURCE);

      const { code, stderr } = runReplay(checkout);

      expect(code).toBe(2);
      expect(stderr).toContain('bypassed the pre-write guard');
      expect(stderr).toContain('rule kiko-no-switch at src/pick.ts:2');
    },
    TIMEOUT,
  );

  it(
    'passes a clean change silently',
    () => {
      const checkout = buildCheckout({});
      writeFile(checkout.worktree, 'src/kept.ts', 'export const kept = 2;\n');

      expect(runReplay(checkout)).toEqual({ code: 0, stderr: '' });
    },
    TIMEOUT,
  );

  it(
    'passes a pre-existing violation the change leaves alone',
    () => {
      const checkout = buildCheckout({ 'src/pick.ts': SWITCH_SOURCE });
      writeFile(checkout.worktree, 'src/pick.ts', `${SWITCH_SOURCE}export const extra = 2;\n`);

      expect(runReplay(checkout)).toEqual({ code: 0, stderr: '' });
    },
    TIMEOUT,
  );

  it(
    'fails a new file with a violation',
    () => {
      const checkout = buildCheckout({});
      writeFile(checkout.worktree, 'src/fresh.ts', SWITCH_SOURCE);

      const { code, stderr } = runReplay(checkout);

      expect(code).toBe(2);
      expect(stderr).toContain('rule kiko-no-switch at src/fresh.ts:2');
    },
    TIMEOUT,
  );

  it(
    'fails a violation committed in this worktree even when the tree is clean',
    () => {
      const checkout = buildCheckout({ 'src/pick.ts': 'export const pick = 1;\n' });
      writeFile(checkout.worktree, 'src/pick.ts', SWITCH_SOURCE);
      commitAll(checkout.worktree, 'bypass');

      const { code, stderr } = runReplay(checkout);

      expect(code).toBe(2);
      expect(stderr).toContain('rule kiko-no-switch at src/pick.ts:2');
    },
    TIMEOUT,
  );

  it(
    'passes a committed violation a later commit fixed',
    () => {
      const checkout = buildCheckout({ 'src/pick.ts': 'export const pick = 1;\n' });
      writeFile(checkout.worktree, 'src/pick.ts', SWITCH_SOURCE);
      commitAll(checkout.worktree, 'bypass');
      writeFile(checkout.worktree, 'src/pick.ts', 'export const pick = 2;\n');
      commitAll(checkout.worktree, 'fix');

      expect(runReplay(checkout)).toEqual({ code: 0, stderr: '' });
    },
    TIMEOUT,
  );

  it(
    'fails a violation committed after an earlier pass recorded its mark',
    () => {
      const checkout = buildCheckout({ 'src/pick.ts': 'export const pick = 1;\n' });
      expect(runReplay(checkout).code).toBe(0);

      writeFile(checkout.worktree, 'src/pick.ts', SWITCH_SOURCE);
      commitAll(checkout.worktree, 'bypass');

      const { code, stderr } = runReplay(checkout);

      expect(code).toBe(2);
      expect(stderr).toContain('rule kiko-no-switch at src/pick.ts:2');
    },
    TIMEOUT,
  );

  it(
    'fails a flagged commit again after a rebase onto a moved main',
    () => {
      const checkout = buildCheckout({ 'src/pick.ts': 'export const pick = 1;\n' });
      expect(runReplay(checkout).code).toBe(0);

      writeFile(checkout.worktree, 'src/pick.ts', SWITCH_SOURCE);
      commitAll(checkout.worktree, 'bypass');
      expect(runReplay(checkout).code).toBe(2);

      moveMain(checkout);
      git(checkout.worktree, 'rebase', '-q', 'main');

      const { code, stderr } = runReplay(checkout);

      expect(code).toBe(2);
      expect(stderr).toContain('rule kiko-no-switch at src/pick.ts:2');
    },
    TIMEOUT,
  );

  it(
    'fails a violating commit re-applied by a reset and a cherry-pick',
    () => {
      const checkout = buildCheckout({ 'src/pick.ts': 'export const pick = 1;\n' });
      expect(runReplay(checkout).code).toBe(0);

      writeFile(checkout.worktree, 'src/pick.ts', SWITCH_SOURCE);
      commitAll(checkout.worktree, 'bypass');
      const bypass = git(checkout.worktree, 'rev-parse', 'HEAD').trim();
      git(checkout.worktree, 'reset', '-q', '--hard', 'HEAD~1');
      writeFile(checkout.worktree, 'src/kept.ts', 'export const kept = 2;\n');
      commitAll(checkout.worktree, 'another parent, so the pick gets a new sha');
      git(checkout.worktree, 'cherry-pick', bypass);

      const { code, stderr } = runReplay(checkout);

      expect(code).toBe(2);
      expect(stderr).toContain('rule kiko-no-switch at src/pick.ts:2');
    },
    TIMEOUT,
  );

  it(
    'fails a violation committed and pulled with a rebase in the same turn',
    () => {
      const checkout = buildCheckout({ 'src/pick.ts': 'export const pick = 1;\n' });
      writeFile(checkout.worktree, 'src/pick.ts', SWITCH_SOURCE);
      commitAll(checkout.worktree, 'bypass');
      moveMain(checkout);
      git(checkout.worktree, 'pull', '-q', '--rebase', '.', 'main');

      const { code, stderr } = runReplay(checkout);

      expect(code).toBe(2);
      expect(stderr).toContain('rule kiko-no-switch at src/pick.ts:2');
    },
    TIMEOUT,
  );

  it(
    'passes a clean commit rebased onto a moved main',
    () => {
      const checkout = buildCheckout({});
      writeFile(checkout.worktree, 'src/kept.ts', 'export const kept = 2;\n');
      commitAll(checkout.worktree, 'clean');
      moveMain(checkout);
      git(checkout.worktree, 'rebase', '-q', 'main');

      expect(runReplay(checkout)).toEqual({ code: 0, stderr: '' });
    },
    TIMEOUT,
  );

  it(
    'passes a merge commit that joins both sides of a file, one carrying a finding',
    () => {
      const checkout = buildCheckout({ 'src/pick.ts': TWO_REGION_SOURCE });
      writeFile(checkout.main, 'src/pick.ts', `${TWO_REGION_SOURCE}${SWITCH_SOURCE}`);
      commitAll(checkout.main, 'main side');
      const worktreeSide = TWO_REGION_SOURCE.replace('first = 1', 'first = 2');
      writeFile(checkout.worktree, 'src/pick.ts', worktreeSide);
      commitAll(checkout.worktree, 'worktree side');
      git(checkout.worktree, 'merge', '-q', '--no-ff', '--no-edit', 'main');

      expect(runReplay(checkout)).toEqual({ code: 0, stderr: '' });
    },
    TIMEOUT,
  );

  it(
    'fails a violation written into a merge before it was committed',
    () => {
      const checkout = buildCheckout({});
      expect(runReplay(checkout).code).toBe(0);

      moveMain(checkout);
      git(checkout.worktree, 'merge', '-q', '--no-ff', '--no-commit', 'main');
      writeFile(checkout.worktree, 'src/kept.ts', SWITCH_SOURCE);
      git(checkout.worktree, 'add', '-A');
      git(checkout.worktree, 'commit', '-q', '--no-edit');

      const { code, stderr } = runReplay(checkout);

      expect(code).toBe(2);
      expect(stderr).toContain('rule kiko-no-switch at src/kept.ts:2');
    },
    TIMEOUT,
  );

  it(
    'names an unfinished merge instead of a bypassed guard',
    () => {
      const checkout = buildCheckout({ 'src/pick.ts': 'export const pick = 1;\n' });
      writeFile(checkout.main, 'src/pick.ts', 'export const pick = 2;\n');
      commitAll(checkout.main, 'main side');
      writeFile(checkout.worktree, 'src/pick.ts', 'export const pick = 3;\n');
      commitAll(checkout.worktree, 'worktree side');
      spawnSync('git', ['merge', '-q', '--no-edit', 'main'], { cwd: checkout.worktree });

      const { code, stderr } = runReplay(checkout);

      expect(code).toBe(2);
      expect(stderr).toContain('unfinished merge');
      expect(stderr).not.toContain('bypassed the pre-write guard');
    },
    TIMEOUT,
  );

  it(
    'skips on a first replay a commit another local branch already has',
    () => {
      const checkout = buildCheckout({ 'src/pick.ts': 'export const pick = 1;\n' });
      writeFile(checkout.worktree, 'src/pick.ts', SWITCH_SOURCE);
      commitAll(checkout.worktree, 'bypass');
      git(checkout.worktree, 'branch', 'published');

      expect(runReplay(checkout)).toEqual({ code: 0, stderr: '' });
    },
    TIMEOUT,
  );

  it(
    'passes a merge of commits made in another checkout',
    () => {
      const checkout = buildCheckout({});
      expect(runReplay(checkout).code).toBe(0);

      writeFile(checkout.main, 'src/pick.ts', SWITCH_SOURCE);
      commitAll(checkout.main, 'another branch');
      git(checkout.worktree, 'merge', '-q', '--no-edit', 'main');

      expect(runReplay(checkout)).toEqual({ code: 0, stderr: '' });
    },
    TIMEOUT,
  );

  it(
    'passes a clean merge commit of another branch that carries a finding',
    () => {
      const checkout = buildCheckout({});
      expect(runReplay(checkout).code).toBe(0);

      writeFile(checkout.main, 'src/pick.ts', SWITCH_SOURCE);
      commitAll(checkout.main, 'another branch');
      git(checkout.worktree, 'merge', '-q', '--no-ff', '--no-edit', 'main');

      expect(runReplay(checkout)).toEqual({ code: 0, stderr: '' });
    },
    TIMEOUT,
  );

  it(
    'passes the import-order and blank-line fixers rewriting a file',
    () => {
      const checkout = buildCheckout({ 'src/total.ts': UNSORTED_UNSEPARATED_SOURCE });
      const target = join(checkout.worktree, 'src/total.ts');

      for (const fixer of ['import-order.js', 'blank-line-separation.js']) {
        spawnSync('node', [join(checkout.worktree, 'scripts/checks', fixer), '--write', target]);
      }

      expect(readFileSync(target, 'utf8')).not.toBe(UNSORTED_UNSEPARATED_SOURCE);
      expect(runReplay(checkout)).toEqual({ code: 0, stderr: '' });
    },
    TIMEOUT,
  );

  it(
    'fails closed when the guard engine crashes',
    () => {
      const checkout = buildCheckout({});
      writeFile(checkout.worktree, 'src/kept.ts', 'export const kept = 2;\n');

      const { code, stderr } = runReplay(checkout, crashingSemgrep(checkout));

      expect(code).toBe(2);
      expect(stderr).toContain('could not check');
    },
    TIMEOUT,
  );

  it(
    'skips an input set that already passed and re-runs once a file changes',
    () => {
      const checkout = buildCheckout({});
      writeFile(checkout.worktree, 'src/kept.ts', 'export const kept = 2;\n');
      expect(runReplay(checkout).code).toBe(0);

      expect(runReplay(checkout, crashingSemgrep(checkout)).code).toBe(0);

      writeFile(checkout.worktree, 'src/kept.ts', 'export const kept = 3;\n');
      expect(runReplay(checkout, crashingSemgrep(checkout)).code).toBe(2);
    },
    TIMEOUT,
  );
});

describe('medium.sh guard replay', () => {
  it(
    'fails the Stop tier on a violation written outside the guard',
    () => {
      const checkout = buildCheckout({}, { stubOtherMediumWrappers: true });
      writeFile(checkout.worktree, 'src/pick.ts', SWITCH_SOURCE);

      const { code, stderr } = runScript(checkout, 'medium.sh');

      expect(code).toBe(2);
      expect(stderr).toContain('rule kiko-no-switch at src/pick.ts:2');
    },
    TIMEOUT,
  );

  it(
    'fails the Stop tier on a committed violation when the tree is clean',
    () => {
      const checkout = buildCheckout({}, { stubOtherMediumWrappers: true });
      writeFile(checkout.worktree, 'src/pick.ts', SWITCH_SOURCE);
      commitAll(checkout.worktree, 'bypass');

      const { code, stderr } = runScript(checkout, 'medium.sh');

      expect(code).toBe(2);
      expect(stderr).toContain('rule kiko-no-switch at src/pick.ts:2');
    },
    TIMEOUT,
  );

  it(
    'fails closed at the replay deadline, and a run by hand then records the pass',
    () => {
      const checkout = buildCheckout({}, { stubOtherMediumWrappers: true });
      const slowGuard = {
        KIKO_PREWRITE_SEMGREP_BIN: writeExecutable(checkout.root, 'semgrep-slow', SLOW_SEMGREP),
        KIKO_GUARD_REPLAY_DEADLINE_SECONDS: '1',
      };

      for (const name of ['one', 'two', 'three', 'four', 'five', 'six']) {
        writeFile(checkout.worktree, `src/${name}.ts`, `export const ${name} = 1;\n`);
      }

      const stopped = runScript(checkout, 'medium.sh', slowGuard);

      expect(stopped.code).toBe(2);
      expect(stopped.stderr).toContain('deadline');
      expect(stopped.stderr).toContain('npm run check:guard-replay');

      expect(runReplay(checkout, slowGuard)).toEqual({ code: 0, stderr: '' });
      expect(runScript(checkout, 'medium.sh', slowGuard)).toEqual({ code: 0, stderr: '' });
    },
    TIMEOUT,
  );
});
