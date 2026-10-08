import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

// scripts/checks/deps.sh's npm-ls step must surface only the lines npm
// itself marks as the problem (its stderr, plus any tree line tagged
// "invalid:"/"missing:") in the failure block — never the whole resolved
// tree, which can run to thousands of lines and drowns the actual
// ELSPROBLEMS cause. Runs a COPY of the real deps.sh + _lib.sh +
// deps-ranges.js inside a throwaway git repository (the mutation.sh test
// pattern), with a stub `npm` on PATH standing in for the real binary so
// the test controls the ELSPROBLEMS output.
const SCRIPT = join(__dirname, '../scripts/checks/deps.sh');
const LIB = join(__dirname, '../scripts/checks/_lib.sh');
const DEPS_RANGES = join(__dirname, '../scripts/checks/deps-ranges.js');

const createdPaths: string[] = [];

const runGit = (cwd: string, ...gitArguments: string[]): void => {
  execFileSync('git', gitArguments, { cwd, encoding: 'utf8', stdio: 'pipe' });
};

const writeExecutable = (path: string, body: string): void => {
  writeFileSync(path, body, { mode: 0o755 });
  chmodSync(path, 0o755);
};

const NPM_STUB_WITH_ELSPROBLEMS = [
  '#!/usr/bin/env bash',
  'if [ "$1" = "ci" ]; then exit 0; fi',
  'if [ "$1" = "ls" ] && [ "$2" = "--all" ]; then',
  '  echo "npm error code ELSPROBLEMS" 1>&2',
  '  echo "npm error invalid: left-pad@1.0.0 /fixture/node_modules/left-pad, expected left-pad@^2.0.0" 1>&2',
  '  for i in $(seq 1 40); do echo "FILLER-TREE-LINE-$i"; done',
  '  echo "invalid: left-pad@1.0.0 /fixture/node_modules/left-pad, expected left-pad@^2.0.0"',
  '  echo "missing: right-pad@^1.0.0, required by fixture@1.0.0"',
  '  exit 1',
  'fi',
  'exit 0',
  '',
].join('\n');

function buildFixtureRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'kiko-deps-fixture-'));
  createdPaths.push(root);
  mkdirSync(join(root, 'scripts/checks'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'scripts/checks/deps.sh'));
  copyFileSync(LIB, join(root, 'scripts/checks/_lib.sh'));
  copyFileSync(DEPS_RANGES, join(root, 'scripts/checks/deps-ranges.js'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  writeExecutable(join(root, 'node_modules/.bin/depcheck'), '#!/usr/bin/env bash\nexit 0\n');
  runGit(root, 'init', '-q', '-b', 'main');
  runGit(root, 'config', 'user.email', 'test@example.com');
  runGit(root, 'config', 'user.name', 'Test');
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root, stdio: 'pipe' });

  return root;
}

function runDepsCheckWithFailingNpmLs(root: string): { code: number | null; stderr: string } {
  const stubDirectory = mkdtempSync(join(tmpdir(), 'kiko-deps-npm-stub-'));
  createdPaths.push(stubDirectory);
  writeExecutable(join(stubDirectory, 'npm'), NPM_STUB_WITH_ELSPROBLEMS);

  const result = spawnSync('bash', [join(root, 'scripts/checks/deps.sh')], {
    cwd: dirname(dirname(root)),
    env: {
      ...process.env,
      PATH: `${stubDirectory}:${process.env.PATH}`,
      TMPDIR: mkdtempSync(join(tmpdir(), 'kiko-deps-state-')),
    },
    encoding: 'utf8',
  });

  return { code: result.status, stderr: result.stderr };
}

afterEach(() => {
  while (createdPaths.length > 0) {
    const directory = createdPaths.pop();

    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("scripts/checks/deps.sh's npm ls --all failure block", () => {
  it('surfaces only the problem lines, never the whole resolved tree', () => {
    const root = buildFixtureRepository();

    const { code, stderr } = runDepsCheckWithFailingNpmLs(root);

    expect(code).toBe(2);
    expect(stderr).toContain('ELSPROBLEMS');
    expect(stderr).toContain('invalid: left-pad@1.0.0');
    expect(stderr).toContain('missing: right-pad@^1.0.0');
    expect(stderr).not.toContain('FILLER-TREE-LINE-1');
    expect(stderr).not.toContain('FILLER-TREE-LINE-40');
  });

  // A `node_modules/node_modules` self-link (a stray `ln -s … node_modules` run
  // inside an installed folder) makes npm report every package invalid; the
  // check names the link and its fix before npm ls runs, so the failing stub
  // npm here never gets to print its ELSPROBLEMS.
  it('names a node_modules/node_modules self-link and its fix before npm ls runs', () => {
    const root = buildFixtureRepository();
    symlinkSync('.', join(root, 'node_modules/node_modules'));

    const { code, stderr } = runDepsCheckWithFailingNpmLs(root);

    expect(code).toBe(2);
    expect(stderr).toContain('CHECK FAILED');
    expect(stderr).toContain('node_modules/node_modules');
    expect(stderr).toContain('rm node_modules/node_modules');
    expect(stderr).toContain('rm -r node_modules');
    expect(stderr).not.toContain('ELSPROBLEMS');
  });

  it('names a dangling node_modules/node_modules link too', () => {
    const root = buildFixtureRepository();
    symlinkSync('../gone', join(root, 'node_modules/node_modules'));

    const { code, stderr } = runDepsCheckWithFailingNpmLs(root);

    expect(code).toBe(2);
    expect(stderr).toContain('rm node_modules/node_modules');
    expect(stderr).not.toContain('ELSPROBLEMS');
  });

  // `rm` fails on a real folder, so that case names the reinstall instead.
  it('names a real node_modules/node_modules folder and the reinstall, not an rm that fails', () => {
    const root = buildFixtureRepository();
    mkdirSync(join(root, 'node_modules/node_modules'));

    const { code, stderr } = runDepsCheckWithFailingNpmLs(root);

    expect(code).toBe(2);
    expect(stderr).toContain('node_modules/node_modules is a folder');
    expect(stderr).toContain('npm ci');
    expect(stderr).not.toContain('rm node_modules/node_modules');
    expect(stderr).toContain('Do not rm -r node_modules');
    expect(stderr).not.toContain('ELSPROBLEMS');
  });
});
