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

const ARGUMENT_STUB = [
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$@" >> "$KIKO_STUB_ARGUMENTS"',
  'exit 0',
].join('\n');

export const runGit = (cwd: string, ...gitArguments: string[]): void => {
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
  stderr: string;
  // null when Stryker never started.
  stubArguments: string[] | null;
};

// Each run gets a fresh TMPDIR (so a fresh dedup state) unless `environment`
// passes its own TMPDIR.
export const runWithArgumentStub = (
  script: string,
  environment: Record<string, string>,
): ArgumentStubRun => {
  const stubDirectory = mkdtempSync(join(tmpdir(), 'kiko-mutation-stub-'));
  const argumentsFile = join(stubDirectory, 'arguments');
  const stub = writeExecutable(join(stubDirectory, 'stub'), ARGUMENT_STUB);

  const result = spawnSync('bash', [script], {
    cwd: dirname(dirname(dirname(script))),
    env: {
      ...process.env,
      KIKO_MUTATION_BIN: stub,
      KIKO_STUB_ARGUMENTS: argumentsFile,
      TMPDIR: mkdtempSync(join(tmpdir(), 'kiko-mutation-state-')),
      ...environment,
    },
    encoding: 'utf8',
  });

  const stubArguments = existsSync(argumentsFile)
    ? readFileSync(argumentsFile, 'utf8').split('\n').filter(Boolean)
    : null;

  return { code: result.status, stderr: result.stderr, stubArguments };
};

export const mutatedFiles = (stubArguments: string[] | null): string[] =>
  (stubArguments ?? [])
    .find((argument) => argument.startsWith('--mutate='))
    ?.slice('--mutate='.length)
    .split(',') ?? [];
