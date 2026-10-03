import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// The mutation tests run a COPY of the real mutation.sh + _lib.sh inside a
// throwaway git repository, because the wrapper computes its ROOT as
// scripts/checks/../.. and the real worktree is far above the file cap.
const SCRIPT = join(__dirname, '../../scripts/checks/mutation.sh');
const LIB = join(__dirname, '../../scripts/checks/_lib.sh');
const SCORE_SCRIPT = join(__dirname, '../../scripts/checks/mutation-score.js');

// Bash lines that print one JSON entry per file of the comma list in
// `$mutate_argument`, comma-separated. Bash 3.2-safe: IFS field-splitting, no
// arrays.
const printEachMutatedFile = (entryFormat: string): string[] => [
  '  first=1',
  '  old_ifs="$IFS"',
  "  IFS=','",
  '  for file in $mutate_argument; do',
  '    [ -n "$file" ] || continue',
  '    [ "$first" -eq 0 ] && printf \',\'',
  '    first=0',
  `    printf '${entryFormat}' "$file"`,
  '  done',
  '  IFS="$old_ifs"',
];

// Writes a trivial, fully-killed mutation.json report for every file named in
// the stub's own `--mutate=` argument, with that list as the report's own
// `config.mutate` scope, so the CHANGE-SET gate
// (scripts/checks/mutation-score.js, run by mutation.sh after a passing
// Stryker exit) finds a report that belongs to this run and clears both the 75
// total and the 60 per-file floor — these lines test the surrounding wrapper
// machinery (cap, lock, ETA, streaming, dedup), not the scorer itself (see
// __tests__/mutation-score.test.ts for that).
const STUB_WRITES_PASSING_REPORT = [
  'mkdir -p reports/mutation',
  'mutate_argument=""',
  'for argument in "$@"; do',
  '  case "$argument" in',
  // "--mutate=" is 9 characters; cut avoids bash parameter-expansion syntax
  // that a JS string literal containing it reads as an (unintended) template
  // placeholder to a linter.
  '    --mutate=*) mutate_argument="$(printf %s "$argument" | cut -c10-)" ;;',
  '  esac',
  'done',
  '{',
  '  printf \'{"config":{"mutate":[\'',
  ...printEachMutatedFile('"%s"'),
  '  printf \']},"files":{\'',
  ...printEachMutatedFile('"%s":{"mutants":[{"status":"Killed"}]}'),
  "  printf '}}'",
  '} > reports/mutation/mutation.json',
].join('\n');

// Same idea as STUB_WRITES_PASSING_REPORT above, for the raw bash stub bodies
// in mutation-stream.test.ts/mutation-lock.test.ts, which always change the
// one fixed file `src/changed.ts` (buildMutationRepository's own default) and
// so never need to read it back out of an argument list.
export const PASSING_REPORT_FOR_CHANGED_FILE = [
  'mkdir -p reports/mutation',
  'printf \'{"config":{"mutate":["src/changed.ts"]},"files":{"src/changed.ts":{"mutants":[{"status":"Killed"}]}}}\' > reports/mutation/mutation.json',
].join('\n');

const ARGUMENT_STUB = [
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$@" >> "$KIKO_STUB_ARGUMENTS"',
  STUB_WRITES_PASSING_REPORT,
  'exit 0',
].join('\n');

// A developer's own `export KIKO_MUTATION_BASE=...` (or FULL) must not change
// the scope a test runs the wrapper with: the throwaway repository has no such
// commit, so every run would be refused. A test's own `environment` still wins.
const SCOPE_VARIABLES = new Set(['KIKO_MUTATION_BASE', 'KIKO_MUTATION_FULL']);

const wrapperEnvironment = (environment: Record<string, string>): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !SCOPE_VARIABLES.has(name))),
  ...environment,
});

const runGit = (cwd: string, ...gitArguments: string[]): void => {
  execFileSync('git', gitArguments, { cwd, encoding: 'utf8', stdio: 'pipe' });
};

export const writeFile = (root: string, relativePath: string, body: string): void => {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, body);
};

export const writeExecutable = (path: string, body: string): string => {
  writeFileSync(path, body, { mode: 0o755 });
  chmodSync(path, 0o755);

  return path;
};

export const commitAll = (root: string, message: string): void => {
  runGit(root, 'add', '-A');
  runGit(root, 'commit', '-qm', message);
};

export const copyMutationScripts = (root: string): string => {
  const script = join(root, 'scripts/checks/mutation.sh');
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(SCRIPT, script);
  copyFileSync(LIB, join(root, 'scripts/checks/_lib.sh'));
  copyFileSync(SCORE_SCRIPT, join(root, 'scripts/checks/mutation-score.js'));

  return script;
};

// `main` holds one source file; HEAD is a `feature` branch off it that commits
// `featureFiles` (relative path to body). An empty `featureFiles` leaves
// `feature` equal to `main`.
export const buildMutationRepository = (
  root: string,
  featureFiles: Record<string, string>,
): { root: string; script: string } => {
  mkdirSync(root, { recursive: true });
  runGit(root, 'init', '-q', '-b', 'main');
  runGit(root, 'config', 'user.email', 'test@example.com');
  runGit(root, 'config', 'user.name', 'Test');
  const script = copyMutationScripts(root);
  writeFile(root, 'src/keep.ts', 'export const kept = 1;\n');
  commitAll(root, 'base');
  runGit(root, 'checkout', '-q', '-b', 'feature');
  const entries = Object.entries(featureFiles);

  if (entries.length > 0) {
    for (const [relativePath, body] of entries) {
      writeFile(root, relativePath, body);
    }

    commitAll(root, 'feature change');
  }

  return { root, script };
};

export type ArgumentStubRun = {
  code: number | null;
  stdout: string;
  stderr: string;
  // null when Stryker never started.
  stubArguments: string[] | null;
};

// Each run gets a fresh TMPDIR (so a fresh dedup state) unless `environment`
// passes its own TMPDIR.
export const runWithArgumentStub = (
  script: string,
  environment: Record<string, string>,
  scriptArguments: string[] = [],
): ArgumentStubRun => {
  const stubDirectory = mkdtempSync(join(tmpdir(), 'kiko-mutation-stub-'));
  const argumentsFile = join(stubDirectory, 'arguments');
  const stub = writeExecutable(join(stubDirectory, 'stub'), ARGUMENT_STUB);

  const result = spawnSync('bash', [script, ...scriptArguments], {
    cwd: dirname(dirname(dirname(script))),
    env: wrapperEnvironment({
      KIKO_MUTATION_BIN: stub,
      KIKO_STUB_ARGUMENTS: argumentsFile,
      TMPDIR: mkdtempSync(join(tmpdir(), 'kiko-mutation-state-')),
      ...environment,
    }),
    encoding: 'utf8',
  });

  const stubArguments = existsSync(argumentsFile)
    ? readFileSync(argumentsFile, 'utf8').split('\n').filter(Boolean)
    : null;

  return { code: result.status, stdout: result.stdout, stderr: result.stderr, stubArguments };
};

export const mutatedFiles = (stubArguments: string[] | null): string[] =>
  (stubArguments ?? [])
    .find((argument) => argument.startsWith('--mutate='))
    ?.slice('--mutate='.length)
    .split(',') ?? [];

export const writeStrykerStub = (temporaryDirectory: string, body: string): string =>
  writeExecutable(join(temporaryDirectory, 'stryker-stub'), body);

export type StubRun = { code: number | null; stdout: string; stderr: string };

// The repository lives at `<temporaryDirectory>/project`, and that same
// directory is the TMPDIR, so the dedup state and the global lock are isolated
// per test.
export const runWithStub = (bin: string, temporaryDirectory: string, callLog: string): StubRun => {
  const script = join(temporaryDirectory, 'project', 'scripts/checks/mutation.sh');
  const result = spawnSync('bash', [script], {
    env: wrapperEnvironment({
      KIKO_MUTATION_BIN: bin,
      TMPDIR: temporaryDirectory,
      KIKO_STUB_CALLS: callLog,
    }),
    encoding: 'utf8',
  });

  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};
