import {
  rmSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
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
const COMMENT_ONLY_SCRIPT = join(__dirname, '../../scripts/checks/comment-only-changes.js');
const RANGES_SCRIPT = join(__dirname, '../../scripts/checks/mutation-ranges.js');

// The throwaway repository has no node_modules, so the comment-only script
// cannot find `typescript` there and keeps every file. A test that needs the
// real parse sets NODE_PATH to this directory.
export const REAL_NODE_MODULES = join(__dirname, '../../node_modules');

const KILLED_MUTANT_AT_LINE = [
  '{"status":"Killed","location":',
  '{"start":{"line":%s,"column":1},"end":{"line":%s,"column":2}}}',
].join('');

// Writes a trivial, fully-killed mutation.json report for the entries named in
// the stub's own `--mutate=` argument (a comma list of `path` or
// `path:start-end`), with those entries verbatim as the report's own
// `config.mutate` scope, so the CHANGE-SET gate
// (scripts/checks/mutation-score.js, run by mutation.sh after a passing
// Stryker exit) finds a report that belongs to this run and clears both the 75
// total and the 60 per-file floor — these lines test the surrounding wrapper
// machinery (cap, lock, ETA, streaming, dedup), not the scorer itself (see
// __tests__/mutation-score.test.ts for that). One `files[path]` per unique
// path, one Killed mutant per entry on that entry's start line (line 1 for a
// plain path). Bash 3.2-safe: no arrays, no here-strings.
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
  // The trailing newline matters: `read` fails on a last line without one.
  'entries_of() { printf "%s\\n" "$mutate_argument" | tr "," "\\n"; }',
  'path_of() { printf %s "$1" | sed \'s/:.*//\'; }',
  'start_of() {',
  '  start="$(printf %s "$1" | sed -n \'s/^[^:]*:\\([0-9][0-9]*\\)-.*/\\1/p\')"',
  '  [ -n "$start" ] || start=1',
  '  printf %s "$start"',
  '}',
  '{',
  '  printf \'{"config":{"mutate":[\'',
  '  first=1',
  '  while IFS= read -r entry; do',
  '    [ -n "$entry" ] || continue',
  '    [ "$first" -eq 0 ] && printf \',\'',
  '    first=0',
  '    printf \'"%s"\' "$entry"',
  '  done < <(entries_of)',
  '  printf \']},"files":{\'',
  '  first=1',
  '  seen=""',
  '  while IFS= read -r entry; do',
  '    [ -n "$entry" ] || continue',
  '    file="$(path_of "$entry")"',
  '    case ",$seen," in *",$file,"*) continue ;; esac',
  '    seen="$seen,$file"',
  '    [ "$first" -eq 0 ] && printf \',\'',
  '    first=0',
  '    printf \'"%s":{"mutants":[\' "$file"',
  '    inner=1',
  '    while IFS= read -r other; do',
  '      [ -n "$other" ] || continue',
  '      [ "$(path_of "$other")" = "$file" ] || continue',
  '      line="$(start_of "$other")"',
  '      [ "$inner" -eq 0 ] && printf \',\'',
  '      inner=0',
  `      printf '${KILLED_MUTANT_AT_LINE}' "$line" "$line"`,
  '    done < <(entries_of)',
  "    printf ']}'",
  '  done < <(entries_of)',
  "  printf '}}'",
  '} > reports/mutation/mutation.json',
].join('\n');

// Same idea as STUB_WRITES_PASSING_REPORT above, for the raw bash stub bodies
// in mutation-stream.test.ts/mutation-lock.test.ts, which always change the
// one fixed one-line file `src/changed.ts` (buildMutationRepository's own
// default), so its single range is `src/changed.ts:1-1`.
export const PASSING_REPORT_FOR_CHANGED_FILE = [
  'mkdir -p reports/mutation',
  `printf '{"config":{"mutate":["src/changed.ts:1-1"]},"files":{"src/changed.ts":{"mutants":[${KILLED_MUTANT_AT_LINE}]}}}' 1 1 > reports/mutation/mutation.json`,
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
  copyFileSync(COMMENT_ONLY_SCRIPT, join(root, 'scripts/checks/comment-only-changes.js'));
  copyFileSync(RANGES_SCRIPT, join(root, 'scripts/checks/mutation-ranges.js'));

  return script;
};

// `main` holds one source file plus `baseFiles`; HEAD is a `feature` branch off
// it that commits `featureFiles` (relative path to body, `null` deletes the
// file). An empty `featureFiles` leaves `feature` equal to `main`.
export const buildMutationRepository = (
  root: string,
  featureFiles: Record<string, string | null>,
  baseFiles: Record<string, string> = {},
): { root: string; script: string } => {
  mkdirSync(root, { recursive: true });
  runGit(root, 'init', '-q', '-b', 'main');
  runGit(root, 'config', 'user.email', 'test@example.com');
  runGit(root, 'config', 'user.name', 'Test');
  const script = copyMutationScripts(root);
  writeFile(root, 'src/keep.ts', 'export const kept = 1;\n');

  for (const [relativePath, body] of Object.entries(baseFiles)) {
    writeFile(root, relativePath, body);
  }

  commitAll(root, 'base');
  runGit(root, 'checkout', '-q', '-b', 'feature');
  const entries = Object.entries(featureFiles);

  if (entries.length > 0) {
    for (const [relativePath, body] of entries) {
      if (body === null) {
        rmSync(join(root, relativePath));
      } else {
        writeFile(root, relativePath, body);
      }
    }

    commitAll(root, 'feature change');
  }

  return { root, script };
};

// A 12-line source file; `edits` replaces the given 1-based lines.
export const twelveLines = (edits: Record<number, string> = {}): string =>
  `${Array.from({ length: 12 }, (_, index) => edits[index + 1] ?? `export const line${index + 1} = ${index + 1};`).join('\n')}\n`;

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

// The raw `--mutate` entries: `path:start-end` for a changed-line range, a
// plain `path` for a whole file.
export const mutateEntries = (stubArguments: string[] | null): string[] =>
  (stubArguments ?? [])
    .find((argument) => argument.startsWith('--mutate='))
    ?.slice('--mutate='.length)
    .split(',') ?? [];

export const mutatedFiles = (stubArguments: string[] | null): string[] => [
  ...new Set(mutateEntries(stubArguments).map((entry) => entry.replace(/:\d+-\d+$/, ''))),
];

export const writeStrykerStub = (temporaryDirectory: string, body: string): string =>
  writeExecutable(join(temporaryDirectory, 'stryker-stub'), body);

// The out-of-repo TSV the wrapper appends to for `root` when TMPDIR is `temporaryDirectory`.
// Asking _lib.sh keeps the tests off the path layout, which is keyed by the git directory.
export const mutationStateFile = (
  root: string,
  temporaryDirectory: string,
  kind: 'history' | 'files',
): string =>
  spawnSync('bash', ['-c', `source "${LIB}"\nharness_mutation_${kind}_file "$1"`, 'bash', root], {
    env: { ...process.env, TMPDIR: temporaryDirectory },
    encoding: 'utf8',
  }).stdout.trim();

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
