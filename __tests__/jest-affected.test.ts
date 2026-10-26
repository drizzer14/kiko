import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { isolatedGitEnvironment } from './test-support/isolated-git';

// scripts/checks/jest-affected.sh runs only the jest suites a change can affect. Every row spawns
// the real script in a throwaway git repository whose `node_modules/.bin/jest` and `npm` are
// stubs that record their arguments, so a missing script is an assertion on the exit code, never
// an import error, and no row runs a real jest.
const REPOSITORY_ROOT = join(__dirname, '..');
const SCRIPT = 'scripts/checks/jest-affected.sh';
const LIBRARY = 'scripts/checks/_lib.sh';
const INVENTORY_LIST = 'scripts/checks/jest-inventory-suites.txt';
const SEMGREP_LIST = 'scripts/checks/semgrep-jest-suites.txt';
const SEMGREP_SUITE = '__tests__/semgrep-one.test.ts';

const JEST_STUB = `#!/bin/bash
printf '%s\\n' "$*" >> "$STUB_LOG/jest.log"
for argument in "$@"; do
  if [ "$argument" = --listTests ]; then
    cat "$STUB_LOG/list" 2>/dev/null
    exit 0
  fi
done
exit "\${STUB_JEST_EXIT:-0}"
`;

const NPM_STUB = `#!/bin/bash
printf '%s\\n' "$*" >> "$STUB_LOG/npm.log"
exit "\${STUB_NPM_EXIT:-0}"
`;

type Sandbox = {
  root: string;
  home: string;
  logs: string;
  binaries: string;
};

type Result = {
  status: number | null;
  stdout: string;
  stderr: string;
  jestCalls: string[][];
  npmCalls: string[][];
};

type Options = {
  files?: Record<string, string>;
  inventory?: string[];
};

const environmentOf = (sandbox: Sandbox, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
  isolatedGitEnvironment(sandbox.home, {
    PATH: `${sandbox.binaries}:${process.env.PATH ?? ''}`,
    STUB_LOG: sandbox.logs,
    ...extra,
  });

const git = (sandbox: Sandbox, ...gitArguments: string[]): string => {
  const result = spawnSync('git', gitArguments, {
    cwd: sandbox.root,
    env: environmentOf(sandbox),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git ${gitArguments.join(' ')} failed: ${result.stderr}`);
  }

  return result.stdout.trim();
};

const write = (sandbox: Sandbox, path: string, content: string): void => {
  const target = join(sandbox.root, path);

  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
};

const writeAll = (sandbox: Sandbox, files: Record<string, string>): void => {
  for (const [path, content] of Object.entries(files)) write(sandbox, path, content);
};

const commitAll = (sandbox: Sandbox, message: string): void => {
  git(sandbox, 'add', '--all');
  git(sandbox, 'commit', '--quiet', '--allow-empty', '-m', message);
};

const writeStub = (path: string, content: string): void => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

// The base commit is on `main`; the work happens on `feature`, so the default base is the
// merge-base with main.
const createSandbox = ({ files = {}, inventory = [] }: Options = {}): Sandbox => {
  const parent = realpathSync(createTemporaryDirectory('jest-affected-'));
  const sandbox: Sandbox = {
    root: join(parent, 'repository'),
    home: join(parent, 'home'),
    logs: join(parent, 'logs'),
    binaries: join(parent, 'binaries'),
  };

  for (const folder of [sandbox.root, sandbox.home, sandbox.logs, sandbox.binaries]) {
    mkdirSync(folder, { recursive: true });
  }

  writeStub(join(sandbox.binaries, 'npm'), NPM_STUB);
  git(sandbox, 'init', '--quiet', '--initial-branch=main');
  git(sandbox, 'config', 'user.email', 'qa@example.com');
  git(sandbox, 'config', 'user.name', 'qa');

  mkdirSync(join(sandbox.root, 'scripts/checks'), { recursive: true });
  copyFileSync(join(REPOSITORY_ROOT, LIBRARY), join(sandbox.root, LIBRARY));

  if (existsSync(join(REPOSITORY_ROOT, SCRIPT))) {
    copyFileSync(join(REPOSITORY_ROOT, SCRIPT), join(sandbox.root, SCRIPT));
  }

  mkdirSync(join(sandbox.root, 'node_modules/.bin'), { recursive: true });
  writeStub(join(sandbox.root, 'node_modules/.bin/jest'), JEST_STUB);

  write(sandbox, '.gitignore', 'node_modules\n');
  write(sandbox, SEMGREP_LIST, `# real semgrep suites\n${SEMGREP_SUITE}\n`);
  write(sandbox, INVENTORY_LIST, `# tree-scanning suites\n${inventory.join('\n')}\n`);
  writeAll(sandbox, files);
  commitAll(sandbox, 'base');
  git(sandbox, 'checkout', '--quiet', '-b', 'feature');

  return sandbox;
};

const readCalls = (path: string): string[][] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => line.split(' '))
    : [];

const runScript = (
  sandbox: Sandbox,
  scriptArguments: string[] = [],
  extra: { related?: string[]; jestExit?: number; npmExit?: number } = {},
): Result => {
  writeFileSync(
    join(sandbox.logs, 'list'),
    (extra.related ?? []).map((path) => `${join(sandbox.root, path)}\n`).join(''),
  );

  const result = spawnSync('bash', [SCRIPT, ...scriptArguments], {
    cwd: sandbox.root,
    env: environmentOf(sandbox, {
      STUB_JEST_EXIT: String(extra.jestExit ?? 0),
      STUB_NPM_EXIT: String(extra.npmExit ?? 0),
    }),
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    jestCalls: readCalls(join(sandbox.logs, 'jest.log')),
    npmCalls: readCalls(join(sandbox.logs, 'npm.log')),
  };
};

const listTestsCalls = (result: Result): string[][] =>
  result.jestCalls.filter((call) => call.includes('--listTests'));

const runCalls = (result: Result): string[][] =>
  result.jestCalls.filter((call) => call.includes('--runTestsByPath'));

const relatedArguments = (result: Result): string[] =>
  listTestsCalls(result).flatMap((call) => call.slice(call.indexOf('--findRelatedTests') + 1));

const pathsOfRun = (call: string[]): string[] =>
  call.slice(call.indexOf('--runTestsByPath') + 1).filter((word) => !word.startsWith('--'));

const suitesRun = (result: Result): string[] => runCalls(result).flatMap(pathsOfRun);

const SUITE_BODY = "describe('x', () => { it('y', () => {}); });\n";

afterAll(removeTemporaryDirectories);

describe('scripts/checks/jest-affected.sh', () => {
  it('runs no jest and says so when nothing changed since the base', () => {
    const result = runScript(createSandbox());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no related suite');
    expect(result.jestCalls).toEqual([]);
  });

  it('runs the related suites by path with --maxWorkers=2 last', () => {
    const sandbox = createSandbox({ files: { 'src/a.test.ts': SUITE_BODY } });

    writeAll(sandbox, { 'src/a.ts': 'export const a = 1;\n' });
    commitAll(sandbox, 'change a');

    const result = runScript(sandbox, [], { related: ['src/a.test.ts'] });
    const [listCall] = listTestsCalls(result);
    const [runCall] = runCalls(result);

    expect(result.status).toBe(0);
    expect(listCall.slice(listCall.indexOf('--findRelatedTests') + 1)).toEqual(['src/a.ts']);
    expect(pathsOfRun(runCall)).toContain('src/a.test.ts');
    expect(runCall[runCall.length - 1]).toBe('--maxWorkers=2');
  });

  it('counts uncommitted and untracked changes', () => {
    const sandbox = createSandbox({ files: { 'src/a.test.ts': SUITE_BODY } });

    writeAll(sandbox, { 'src/b.ts': 'export const b = 1;\n' });

    const result = runScript(sandbox, [], { related: ['src/a.test.ts'] });

    expect(relatedArguments(result)).toContain('src/b.ts');
  });

  it('counts an uncommitted edit of a tracked file', () => {
    const sandbox = createSandbox({
      files: { 'src/c.ts': 'export const c = 1;\n', 'src/c.test.ts': SUITE_BODY },
    });

    writeAll(sandbox, { 'src/c.ts': 'export const c = 2;\n' });

    const result = runScript(sandbox, [], { related: ['src/c.test.ts'] });

    expect(relatedArguments(result)).toContain('src/c.ts');
  });

  it('adds the doc-reading suites for a skill change', () => {
    const readerBody = "readFileSync('.claude/skills/x/SKILL.md');\n";
    const sandbox = createSandbox({
      files: {
        '.claude/skills/x/SKILL.md': 'text\n',
        '__tests__/doc-reader.test.ts': readerBody,
        '__tests__/unrelated.test.ts': SUITE_BODY,
      },
    });

    writeAll(sandbox, { '.claude/skills/x/SKILL.md': 'changed text\n' });

    const result = runScript(sandbox);

    expect(suitesRun(result)).toContain('__tests__/doc-reader.test.ts');
    expect(suitesRun(result)).not.toContain('__tests__/unrelated.test.ts');
  });

  it('adds suites that name a changed script by its quoted basename', () => {
    const sandbox = createSandbox({
      files: {
        'scripts/checks/foo.sh': '#!/bin/bash\n',
        '__tests__/names-foo.test.ts': "spawn('foo.sh');\n",
        '__tests__/names-other.test.ts': "spawn('bar.sh');\n",
      },
    });

    writeAll(sandbox, { 'scripts/checks/foo.sh': '#!/bin/bash\necho changed\n' });

    const result = runScript(sandbox);

    expect(suitesRun(result)).toContain('__tests__/names-foo.test.ts');
    expect(suitesRun(result)).not.toContain('__tests__/names-other.test.ts');
    expect(relatedArguments(result)).not.toContain('scripts/checks/foo.sh');
  });

  it('adds suites that name a changed script by its quoted repo-relative path', () => {
    const sandbox = createSandbox({
      files: {
        'scripts/checks/foo.sh': '#!/bin/bash\n',
        '__tests__/names-path.test.ts': "spawn('scripts/checks/foo.sh');\n",
      },
    });

    writeAll(sandbox, { 'scripts/checks/foo.sh': '#!/bin/bash\necho changed\n' });

    expect(suitesRun(runScript(sandbox))).toContain('__tests__/names-path.test.ts');
  });

  it('maps a deleted script by name only', () => {
    const sandbox = createSandbox({
      files: {
        'scripts/checks/gone.sh': '#!/bin/bash\n',
        '__tests__/names-gone.test.ts': "spawn('gone.sh');\n",
      },
    });

    rmSync(join(sandbox.root, 'scripts/checks/gone.sh'));

    const result = runScript(sandbox);

    expect(suitesRun(result)).toContain('__tests__/names-gone.test.ts');
    expect(result.jestCalls.flat()).not.toContain('scripts/checks/gone.sh');
  });

  it('adds suites that read a changed src file by its quoted repo-relative path, not its basename', () => {
    const sandbox = createSandbox({
      files: {
        'src/env.d.ts': 'export const A: string;\n',
        '__tests__/reads-env.test.ts': "readFileSync(join(ROOT, 'src/env.d.ts'));\n",
        '__tests__/names-basename.test.ts': "spawn('env.d.ts');\n",
      },
    });

    writeAll(sandbox, { 'src/env.d.ts': 'export const A: string;\nexport const B: string;\n' });

    const result = runScript(sandbox);

    expect(suitesRun(result)).toContain('__tests__/reads-env.test.ts');
    expect(suitesRun(result)).not.toContain('__tests__/names-basename.test.ts');
    expect(relatedArguments(result)).toContain('src/env.d.ts');
  });

  it('adds suites that read a changed __tests__ fixture relative to their own folder', () => {
    const sandbox = createSandbox({
      files: {
        '__tests__/fixtures/x.json': '{}\n',
        '__tests__/reads-fixture.test.ts': "readFileSync(join(__dirname, 'fixtures/x.json'));\n",
        '__tests__/reads-other.test.ts': "readFileSync(join(__dirname, 'fixtures/y.json'));\n",
      },
    });

    writeAll(sandbox, { '__tests__/fixtures/x.json': '{"changed":true}\n' });

    const result = runScript(sandbox);

    expect(suitesRun(result)).toContain('__tests__/reads-fixture.test.ts');
    expect(suitesRun(result)).not.toContain('__tests__/reads-other.test.ts');
  });

  it('adds suites that import a deleted src module by its extensionless specifier', () => {
    const sandbox = createSandbox({
      files: {
        'src/lib/gone.ts': 'export const gone = 1;\n',
        'src/lib/user.test.ts': "import { gone } from './gone';\n",
        'src/lib/quoted.test.ts': 'import { gone } from "../lib/gone";\n',
        'src/lib/other.test.ts': "import { gone } from './gone-other';\n",
      },
    });

    rmSync(join(sandbox.root, 'src/lib/gone.ts'));

    const result = runScript(sandbox);

    expect(suitesRun(result)).toEqual(
      expect.arrayContaining(['src/lib/user.test.ts', 'src/lib/quoted.test.ts']),
    );
    expect(suitesRun(result)).not.toContain('src/lib/other.test.ts');
    expect(result.jestCalls.flat()).not.toContain('src/lib/gone.ts');
  });

  it('maps a deleted index module by the name of its folder', () => {
    const sandbox = createSandbox({
      files: {
        'src/feature/index.ts': 'export const feature = 1;\n',
        'src/screen/screen.test.ts': "import { feature } from '../feature';\n",
      },
    });

    rmSync(join(sandbox.root, 'src/feature/index.ts'));

    const result = runScript(sandbox);

    expect(suitesRun(result)).toContain('src/screen/screen.test.ts');
  });

  it('reads inventory entries trimmed, as the pin does', () => {
    const inventory = ['__tests__/inventory-one.test.ts', '__tests__/inventory-two.test.ts'];
    const sandbox = createSandbox({
      files: { [inventory[0]]: SUITE_BODY, [inventory[1]]: SUITE_BODY },
      inventory: [`  ${inventory[0]}  `, `${inventory[1]}\t`, '  # an indented comment'],
    });

    writeAll(sandbox, { 'src/lonely.ts': 'export const lonely = 1;\n' });

    const result = runScript(sandbox);

    expect(result.status).toBe(0);
    expect(suitesRun(result)).toEqual(expect.arrayContaining(inventory));
  });

  it('runs check:rules for a rules change', () => {
    const sandbox = createSandbox({ files: { 'rules/semgrep-prewrite.yml': 'rules: []\n' } });

    writeAll(sandbox, { 'rules/semgrep-prewrite.yml': 'rules: []\n# changed\n' });

    const result = runScript(sandbox);

    expect(result.npmCalls).toContainEqual(['run', 'check:rules']);
  });

  it('runs the listed real-semgrep suites in a second in-band call', () => {
    const sandbox = createSandbox({
      files: { 'src/a.test.ts': SUITE_BODY, [SEMGREP_SUITE]: SUITE_BODY },
    });

    writeAll(sandbox, { 'src/a.ts': 'export const a = 1;\n' });

    const result = runScript(sandbox, [], { related: ['src/a.test.ts', SEMGREP_SUITE] });
    const [firstCall, secondCall] = runCalls(result);

    expect(pathsOfRun(firstCall)).toContain('src/a.test.ts');
    expect(pathsOfRun(firstCall)).not.toContain(SEMGREP_SUITE);
    expect(secondCall).toEqual(['--runTestsByPath', SEMGREP_SUITE, '--runInBand']);
  });

  it('always adds the inventory suites', () => {
    const inventory = ['__tests__/inventory-one.test.ts', '__tests__/inventory-two.test.ts'];
    const sandbox = createSandbox({
      files: {
        'src/a.test.ts': SUITE_BODY,
        [inventory[0]]: SUITE_BODY,
        [inventory[1]]: SUITE_BODY,
      },
      inventory,
    });

    writeAll(sandbox, { 'src/a.ts': 'export const a = 1;\n' });

    const result = runScript(sandbox, [], { related: ['src/a.test.ts'] });

    expect(suitesRun(result)).toEqual(expect.arrayContaining(inventory));
  });

  it('adds the inventory suites when a change maps to no related suite', () => {
    const inventory = ['__tests__/inventory-one.test.ts'];
    const sandbox = createSandbox({ files: { [inventory[0]]: SUITE_BODY }, inventory });

    writeAll(sandbox, { 'src/lonely.ts': 'export const lonely = 1;\n' });

    expect(suitesRun(runScript(sandbox))).toContain(inventory[0]);
  });

  it('names a config change that affects every suite and never runs jest bare', () => {
    const sandbox = createSandbox({ files: { 'jest.config.js': 'module.exports = {};\n' } });

    writeAll(sandbox, { 'jest.config.js': 'module.exports = { bail: 1 };\n' });

    const result = runScript(sandbox);

    expect(result.stdout).toContain('AFFECTS EVERY SUITE: jest.config.js');
    expect(
      result.jestCalls.every(
        (call) =>
          (call.includes('--runTestsByPath') && pathsOfRun(call).length > 0) ||
          call.includes('--listTests'),
      ),
    ).toBe(true);
  });

  it.each([
    'jest.config.js',
    'package.json',
    'package-lock.json',
    'babel.config.js',
    'tsconfig.json',
    'tsconfig.build.json',
    'jest/setup.ts',
    '__mocks__/native.ts',
    'patches/library+1.0.0.patch',
    '.env.test',
  ])('exits 3 and names the queued verify for an every-suite change: %s', (path) => {
    const sandbox = createSandbox({ files: { [path]: 'old\n' } });

    writeAll(sandbox, { [path]: 'new\n' });

    const result = runScript(sandbox);

    expect(result.status).toBe(3);
    expect(result.stdout).toContain(`AFFECTS EVERY SUITE: ${path}`);
    expect(`${result.stdout}${result.stderr}`).toContain('job-queue.sh verify');
  });

  it('exits 3 for an every-suite change even when the related run is green', () => {
    const sandbox = createSandbox({
      files: { 'package.json': '{}\n', 'src/a.test.ts': SUITE_BODY },
    });

    writeAll(sandbox, { 'package.json': '{"a":1}\n', 'src/a.ts': 'export const a = 1;\n' });

    const result = runScript(sandbox, [], { related: ['src/a.test.ts'] });

    expect(result.status).toBe(3);
    expect(suitesRun(result)).toContain('src/a.test.ts');
  });

  it('exits with the first failing code of the jest calls', () => {
    const sandbox = createSandbox({ files: { 'src/a.test.ts': SUITE_BODY } });

    writeAll(sandbox, { 'src/a.ts': 'export const a = 1;\n' });

    const result = runScript(sandbox, [], { related: ['src/a.test.ts'], jestExit: 1 });

    expect(result.status).toBe(1);
  });

  it('exits with the code of a failing check:rules', () => {
    const sandbox = createSandbox({ files: { 'rules/semgrep-prewrite.yml': 'rules: []\n' } });

    writeAll(sandbox, { 'rules/semgrep-prewrite.yml': 'rules: []\n# changed\n' });

    expect(runScript(sandbox, [], { npmExit: 4 }).status).toBe(4);
  });

  it('refuses a base that does not resolve', () => {
    const sandbox = createSandbox({ files: { 'src/a.test.ts': SUITE_BODY } });

    writeAll(sandbox, { 'src/a.ts': 'export const a = 1;\n' });

    const result = runScript(sandbox, ['nope']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('nope');
    expect(result.jestCalls).toEqual([]);
  });

  it('uses the merge-base with main by default and names it in the plan line', () => {
    const sandbox = createSandbox({ files: { 'src/a.test.ts': SUITE_BODY } });
    const mergeBase = git(sandbox, 'rev-parse', 'HEAD');

    writeAll(sandbox, { 'src/a.ts': 'export const a = 1;\n' });
    commitAll(sandbox, 'feature work');
    git(sandbox, 'checkout', '--quiet', 'main');
    commitAll(sandbox, 'main moves on');
    git(sandbox, 'checkout', '--quiet', 'feature');

    const result = runScript(sandbox, [], { related: ['src/a.test.ts'] });

    expect(result.stdout).toContain(`base ${mergeBase.slice(0, 12)}`);
    expect(result.stdout).not.toContain(git(sandbox, 'rev-parse', 'main').slice(0, 12));
  });

  it('accepts an explicit base ref as its first argument', () => {
    const sandbox = createSandbox({ files: { 'src/a.test.ts': SUITE_BODY } });

    writeAll(sandbox, { 'src/a.ts': 'export const a = 1;\n' });
    commitAll(sandbox, 'first');
    writeAll(sandbox, { 'src/b.ts': 'export const b = 1;\n' });
    commitAll(sandbox, 'second');

    const result = runScript(sandbox, ['HEAD~1'], { related: ['src/a.test.ts'] });

    expect(relatedArguments(result)).toEqual(['src/b.ts']);
    expect(result.stdout).toContain('(HEAD~1)');
  });

  it('prints the suites with --list and runs none', () => {
    const sandbox = createSandbox({ files: { 'src/a.test.ts': SUITE_BODY } });

    writeAll(sandbox, { 'src/a.ts': 'export const a = 1;\n' });

    const result = runScript(sandbox, ['--list'], { related: ['src/a.test.ts'] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('src/a.test.ts');
    expect(runCalls(result)).toEqual([]);
  });
});

describe('scripts/checks/jest-inventory-suites.txt', () => {
  const NOT_INVENTORY = '# not inventory: ';

  const lines = (): string[] =>
    existsSync(join(REPOSITORY_ROOT, INVENTORY_LIST))
      ? readFileSync(join(REPOSITORY_ROOT, INVENTORY_LIST), 'utf8').split('\n')
      : [];

  const listed = (): string[] =>
    lines()
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));

  const excepted = (): string[] =>
    lines()
      .filter((line) => line.startsWith(NOT_INVENTORY))
      .map((line) => line.slice(NOT_INVENTORY.length).split(' ')[0]);

  // The quote character is built, not typed, so this file does not match its own search.
  const quote = String.fromCharCode(39);
  // `repositoryFiles` is the shared helper that runs `git ls-files`, so its importers walk the
  // tree without naming the git call themselves.
  const WALKING_LITERALS = [
    'readdirSync(',
    `${quote}ls-files${quote}`,
    'git ls-files',
    'repositoryFiles',
  ];
  const WALKING_PATTERN = WALKING_LITERALS.map((literal) => literal.replace('(', '\\(')).join('|');

  // git grep exits 1 for no match, so only a status above that means the search itself broke; an
  // empty list from a broken search would read as every suite being listed.
  const walkingSuites = (cwd: string = REPOSITORY_ROOT): string[] => {
    const result = spawnSync(
      'git',
      ['grep', '-lE', WALKING_PATTERN, '--', '*.test.ts', '*.test.tsx'],
      { cwd, encoding: 'utf8' },
    );

    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`git grep failed with status ${result.status}: ${result.stderr}`);
    }

    return result.stdout.split('\n').filter((line) => line !== '');
  };

  it('exists and lists at least one suite', () => {
    expect(listed().length).toBeGreaterThan(0);
  });

  it('lists only suites that exist', () => {
    expect(listed().filter((path) => !existsSync(join(REPOSITORY_ROOT, path)))).toEqual([]);
  });

  it('lists or excepts every suite that walks a tree', () => {
    const known = new Set([...listed(), ...excepted()]);

    expect(walkingSuites().filter((path) => !known.has(path))).toEqual([]);
  });

  it('fails instead of finding no suite when git grep itself fails', () => {
    const missingDirectory = join(createTemporaryDirectory('jest-affected-missing-'), 'nowhere');

    expect(() => walkingSuites(missingDirectory)).toThrow(/git grep failed/);
  });

  it('documents every part of the discovery pattern in its header', () => {
    const header = lines()
      .filter((line) => line.startsWith('#') && !line.startsWith(NOT_INVENTORY.trimEnd()))
      .join('\n')
      .replace(/\\/g, '');

    expect(WALKING_LITERALS.filter((literal) => !header.includes(literal))).toEqual([]);
  });

  it('names a reason for every exception', () => {
    expect(
      lines().filter(
        (line) =>
          line.startsWith(NOT_INVENTORY) && line.slice(NOT_INVENTORY.length).split(' ').length < 3,
      ),
    ).toEqual([]);
  });
});
