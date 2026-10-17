import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, copyFileSync, mkdirSync, realpathSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { isolatedGitEnvironment } from './test-support/isolated-git';
import { writeFile, writeExecutable } from './test-support/mutation-repository';

// scripts/ff-main.sh moves the main checkout only to a commit a queued verify passed on. Each test
// runs a COPY of the script inside a throwaway repository (the script finds main as the first
// worktree of its own repository), with a linked worktree for the commit under test, a temporary
// queue directory and a temporary HOME: never the real queue and never the real main checkout.
const SCRIPT = join(__dirname, '../scripts/ff-main.sh');
const LIBRARY = join(__dirname, '../scripts/checks/_lib.sh');
const JOB_QUEUE = join(__dirname, '../scripts/job-queue.sh');

jest.setTimeout(120_000);

afterEach(removeTemporaryDirectories);

type Fixture = {
  main: string;
  work: string;
  queue: string;
  home: string;
  environment: NodeJS.ProcessEnv;
  baseCommit: string;
  tipCommit: string;
};

const runGit = (cwd: string, environment: NodeJS.ProcessEnv, ...gitArguments: string[]): string =>
  execFileSync('git', gitArguments, { cwd, env: environment, encoding: 'utf8' }).trim();

const commitFile = (fixture: Fixture, directory: string, name: string, body = `${name}\n`) => {
  writeFile(directory, name, body);
  runGit(directory, fixture.environment, 'add', '-A');
  runGit(directory, fixture.environment, 'commit', '-qm', `add ${name}`);

  return runGit(directory, fixture.environment, 'rev-parse', 'HEAD');
};

// The base commit tracks the script, so main and the linked worktree each hold a copy. `work` is a
// detached linked worktree one commit ahead of main, so the tip commit is a fast-forward of main.
const createFixture = (): Fixture => {
  const root = realpathSync(createTemporaryDirectory('kiko-ff-main-'));
  const home = join(root, 'home');
  const queue = join(root, 'queue');
  const main = join(root, 'main');
  const work = join(root, 'work');
  mkdirSync(home);
  mkdirSync(queue);
  mkdirSync(join(main, 'scripts/checks'), { recursive: true });
  copyFileSync(SCRIPT, join(main, 'scripts/ff-main.sh'));
  copyFileSync(LIBRARY, join(main, 'scripts/checks/_lib.sh'));
  const environment = isolatedGitEnvironment(home, {
    KIKO_QUEUE_DIR: queue,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  });
  runGit(main, environment, 'init', '-q', '-b', 'main');
  const fixture: Fixture = { main, work, queue, home, environment, baseCommit: '', tipCommit: '' };
  fixture.baseCommit = commitFile(fixture, main, 'base.txt');
  runGit(main, environment, 'worktree', 'add', '-q', '--detach', work);
  fixture.tipCommit = commitFile(fixture, work, 'change.txt');

  return fixture;
};

const doneLine = (head: string, kind = 'verify', exitCode = '0'): string =>
  `${kind} label ${exitCode} 2026-10-15T10:00:00Z 2026-10-15T10:05:00Z ${head}`;

const record = (fixture: Fixture, ...lines: string[]): void => {
  appendFileSync(join(fixture.queue, 'done.log'), `${lines.join('\n')}\n`);
};

const mainHead = (fixture: Fixture): string =>
  runGit(fixture.main, fixture.environment, 'rev-parse', 'HEAD');

const runScript = (fixture: Fixture, args: string[], directory = fixture.main) =>
  spawnSync('bash', [join(directory, 'scripts/ff-main.sh'), ...args], {
    cwd: fixture.work,
    env: fixture.environment,
    encoding: 'utf8',
  });

// Each arrangement prepares the fixture and returns the arguments of the run.
type Arrange = (fixture: Fixture) => string[];

const ofTip: Arrange = (fixture) => [fixture.tipCommit];

const greenTip: Arrange = (fixture) => {
  record(fixture, doneLine(fixture.tipCommit));

  return ofTip(fixture);
};

const divergeMain: Arrange = (fixture) => {
  commitFile(fixture, fixture.main, 'diverged.txt');

  return greenTip(fixture);
};

const mainOnBranch: Arrange = (fixture) => {
  runGit(fixture.main, fixture.environment, 'checkout', '-q', '-b', 'other');

  return greenTip(fixture);
};

const recordOnly =
  (...lines: ((fixture: Fixture) => string)[]): Arrange =>
  (fixture) => {
    record(fixture, ...lines.map((line) => line(fixture)));

    return ofTip(fixture);
  };

// Runs the real `job-queue.sh verify` on the linked worktree with a stub `make` of `makeBody`.
const runQueuedVerify = (fixture: Fixture, makeBody: string) => {
  const bin = join(fixture.home, 'bin');
  mkdirSync(bin);
  writeExecutable(join(bin, 'make'), makeBody);

  return spawnSync('bash', [JOB_QUEUE, 'verify', fixture.work, 'end-to-end'], {
    env: {
      ...fixture.environment,
      PATH: `${bin}:${process.env.PATH}`,
      KIKO_QUEUE_PMSET: join(bin, 'no-such-pmset'),
      KIKO_QUEUE_POLL_SECONDS: '0.1',
    },
    encoding: 'utf8',
  });
};

describe('scripts/ff-main.sh moves main', () => {
  it.each<[string, Arrange, boolean]>([
    ['a verify exit 0 line at the full commit', greenTip, true],
    [
      'a short commit that resolves uniquely',
      (fixture) => [greenTip(fixture)[0].slice(0, 9)],
      true,
    ],
    [
      'a red verify followed by a green one (the last line decides)',
      recordOnly(
        (fixture) => doneLine(fixture.tipCommit, 'verify', '1'),
        (fixture) => doneLine(fixture.tipCommit),
      ),
      true,
    ],
    [
      'a green verify among lines for other commits and kinds',
      recordOnly(
        (fixture) => doneLine(fixture.baseCommit, 'verify', '1'),
        (fixture) => doneLine(fixture.tipCommit, 'check-all', '1'),
        (fixture) => doneLine(fixture.tipCommit),
        (fixture) => doneLine(fixture.baseCommit, 'gate', '1'),
      ),
      true,
    ],
    [
      'an untracked file in main',
      (fixture) => {
        writeFile(fixture.main, 'untracked.txt', 'x\n');

        return greenTip(fixture);
      },
      true,
    ],
    [
      'a tracked change in main that the fast-forward does not touch',
      (fixture) => {
        writeFile(fixture.main, 'base.txt', 'edited\n');

        return greenTip(fixture);
      },
      true,
    ],
    [
      'main already at the commit',
      (fixture) => {
        record(fixture, doneLine(fixture.baseCommit));

        return [fixture.baseCommit];
      },
      false,
    ],
  ])('exit 0 for %s', (_title, arrange, moves) => {
    const fixture = createFixture();
    const args = arrange(fixture);

    const result = runScript(fixture, args);

    expect(result.status).toBe(0);
    expect(mainHead(fixture)).toBe(moves ? fixture.tipCommit : fixture.baseCommit);
    expect(result.stdout.trim().split('\n').slice(-1)[0]).toBe(
      `${mainHead(fixture).slice(0, 7)} add ${moves ? 'change' : 'base'}.txt`,
    );
    expect(result.stderr).not.toContain('CHECK FAILED');
  });

  it('runs the copy a linked worktree holds and still finds the main checkout', () => {
    const fixture = createFixture();
    const args = greenTip(fixture);

    const result = runScript(fixture, args, fixture.work);

    expect(result.status).toBe(0);
    expect(mainHead(fixture)).toBe(fixture.tipCommit);
  });

  it('reads the queue under HOME when KIKO_QUEUE_DIR is not set', () => {
    const fixture = createFixture();
    delete fixture.environment.KIKO_QUEUE_DIR;
    mkdirSync(join(fixture.home, '.claude/kiko-queue'), { recursive: true });
    appendFileSync(
      join(fixture.home, '.claude/kiko-queue/done.log'),
      `${doneLine(fixture.tipCommit)}\n`,
    );

    const result = runScript(fixture, [fixture.tipCommit]);

    expect(result.status).toBe(0);
    expect(mainHead(fixture)).toBe(fixture.tipCommit);
  });

  it('accepts the done.log line a real `job-queue.sh verify` writes', () => {
    const fixture = createFixture();
    const queued = runQueuedVerify(fixture, '#!/usr/bin/env bash\nexit 0\n');

    const result = runScript(fixture, [fixture.tipCommit]);

    expect(queued.status).toBe(0);
    expect(result.status).toBe(0);
    expect(mainHead(fixture)).toBe(fixture.tipCommit);
  });
});

describe('scripts/ff-main.sh short done.log lines', () => {
  const shortLine = 'verify label 0 2026-10-15T10:00:00Z 2026-10-15T10:05:00Z';

  it('warns about a line with fewer than 6 fields and still moves main on a green line', () => {
    const fixture = createFixture();
    record(fixture, shortLine, doneLine(fixture.tipCommit));

    const result = runScript(fixture, [fixture.tipCommit]);
    const warnings = result.stderr.split('\n').filter((line) => line.includes('WARNING'));

    expect(result.status).toBe(0);
    expect(mainHead(fixture)).toBe(fixture.tipCommit);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(shortLine);
  });

  it('warns and still ignores the short line, so the refusal stands', () => {
    const fixture = createFixture();
    record(fixture, shortLine);

    const result = runScript(fixture, [fixture.tipCommit]);

    expect(result.status).toBe(2);
    expect(mainHead(fixture)).toBe(fixture.baseCommit);
    expect(result.stderr.split('\n').filter((line) => line.includes('WARNING'))).toHaveLength(1);
  });
});

const BLOCK_LABELS = [
  'CHECK FAILED: ff-main.sh',
  'WHAT FAILED:',
  'DETAILS:',
  'WHY IT MATTERS:',
  'HOW TO FIX:',
  'DO NOT:',
];

const DO_NOT =
  'DO NOT:         edit done.log, merge main by hand, or add a bypass; an override goes to the user plus a run-log note';

describe('scripts/ff-main.sh refuses', () => {
  it.each<[string, Arrange]>([
    ['no done.log', ofTip],
    [
      'a done.log without a line for the commit',
      recordOnly((fixture) => doneLine(fixture.baseCommit)),
    ],
    [
      'a verify line with exit 1',
      recordOnly((fixture) => doneLine(fixture.tipCommit, 'verify', '1')),
    ],
    [
      'a green verify followed by a red one (the last line decides)',
      recordOnly(
        (fixture) => doneLine(fixture.tipCommit),
        (fixture) => doneLine(fixture.tipCommit, 'verify', '1'),
      ),
    ],
    ['a verify line whose HEAD field is unknown', recordOnly(() => doneLine('unknown'))],
    [
      'an old 5-field verify line',
      recordOnly(() => 'verify label 0 2026-10-15T10:00:00Z 2026-10-15T10:05:00Z'),
    ],
    ['a verify at the parent commit', recordOnly((fixture) => doneLine(fixture.baseCommit))],
    [
      'a verify at a child commit',
      (fixture) => {
        const child = commitFile(fixture, fixture.work, 'child.txt');
        record(fixture, doneLine(child));

        return ofTip(fixture);
      },
    ],
    [
      'a label equal to the commit while the HEAD field names another',
      (fixture) => {
        record(fixture, `verify ${fixture.tipCommit} 0 start end ${fixture.baseCommit}`);

        return ofTip(fixture);
      },
    ],
    [
      'a check-all line with exit 0',
      recordOnly((fixture) => doneLine(fixture.tipCommit, 'check-all')),
    ],
    ['a gate line with exit 0', recordOnly((fixture) => doneLine(fixture.tipCommit, 'gate'))],
    ['a main that is not an ancestor of the commit', divergeMain],
    ['a main checkout on another branch', mainOnBranch],
    [
      'a main checkout with a detached HEAD',
      (fixture) => {
        runGit(fixture.main, fixture.environment, 'checkout', '-q', '--detach');

        return greenTip(fixture);
      },
    ],
    [
      'a tracked change in main that the fast-forward would overwrite',
      (fixture) => {
        const head = commitFile(fixture, fixture.work, 'base.txt', 'changed in work\n');
        writeFile(fixture.main, 'base.txt', 'edited in main\n');
        record(fixture, doneLine(head));

        return [head];
      },
    ],
    [
      'a commit that is not in the repository',
      (fixture) => {
        record(fixture, doneLine('deadbeef'.repeat(5)));

        return ['deadbeefdeadbeef'];
      },
    ],
    [
      'a short branch name that is hex and points to another commit',
      (fixture) => {
        runGit(fixture.main, fixture.environment, 'branch', 'abcdef1', fixture.baseCommit);
        record(fixture, doneLine(fixture.baseCommit), doneLine(fixture.tipCommit));

        return ['abcdef1'];
      },
    ],
  ])('exit 2 and no move for %s', (_title, arrange) => {
    const fixture = createFixture();
    const args = arrange(fixture);
    const before = mainHead(fixture);

    const result = runScript(fixture, args);

    expect(result.status).toBe(2);
    expect(mainHead(fixture)).toBe(before);

    for (const label of BLOCK_LABELS) {
      expect(result.stderr).toContain(label);
    }

    expect(result.stderr).toContain(DO_NOT);
  });

  it.each([
    ['a tracked edit', 'echo edited >> change.txt'],
    ['an untracked file', 'echo new > made-by-job.txt'],
  ])('exit 2 for a queued verify whose job left %s uncommitted', (_title, change) => {
    const fixture = createFixture();
    const queued = runQueuedVerify(fixture, `#!/usr/bin/env bash\ncd "$2" && ${change}\nexit 0\n`);

    const result = runScript(fixture, [fixture.tipCommit]);

    expect(queued.status).toBe(0);
    expect(result.status).toBe(2);
    expect(result.stderr.split('\n')).toContain(
      'WHAT FAILED:    No successful queued verify at this commit',
    );
    expect(mainHead(fixture)).toBe(fixture.baseCommit);
  });

  it.each<[string, string[]]>([
    ['no argument', []],
    ['two arguments', ['abc1234', 'abc1234']],
    ['an option', ['--force']],
    ['--help', ['--help']],
    ['a non-hex argument', ['main']],
    ['an upper-case commit', ['ABCDEF1']],
    ['a commit of 6 characters', ['abcdef']],
    ['a commit of 41 characters', ['a'.repeat(41)]],
    ['an empty argument', ['']],
  ])('shows the usage block and exits 2 for %s', (_title, args) => {
    const fixture = createFixture();
    record(fixture, doneLine(fixture.tipCommit));

    const result = runScript(fixture, args);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('WHAT FAILED:    ff-main.sh takes exactly one argument');
    expect(result.stderr).toContain('bash scripts/ff-main.sh <sha>');
    expect(mainHead(fixture)).toBe(fixture.baseCommit);
  });

  it.each<[string, Arrange, string, string]>([
    [
      'no done.log line',
      ofTip,
      'No successful queued verify at this commit',
      'last verify line for it: none',
    ],
    [
      'a red last line',
      recordOnly((fixture) => doneLine(fixture.tipCommit, 'verify', '1')),
      'No successful queued verify at this commit',
      'last verify line for it: verify label 1 ',
    ],
    [
      'a diverged main',
      divergeMain,
      'The main checkout is not an ancestor of this commit',
      ' is at ',
    ],
    [
      'main on another branch',
      mainOnBranch,
      'The main checkout is not on branch main',
      'on branch other',
    ],
    [
      'a commit that does not resolve',
      () => ['deadbeefdeadbeef'],
      'The argument does not name a commit',
      'deadbeefdeadbeef',
    ],
  ])('names the case in the block for %s', (_title, arrange, what, details) => {
    const fixture = createFixture();
    const args = arrange(fixture);

    const result = runScript(fixture, args);
    const lines = result.stderr.split('\n');

    expect(lines).toContain(`WHAT FAILED:    ${what}`);
    expect(lines.find((line) => line.startsWith('DETAILS:'))).toContain(details);
  });
});

const PLUGIN_MANIFEST = 'harness/kiko/.claude-plugin/plugin.json';

const pluginManifest = (version: string): string =>
  `${JSON.stringify({ name: 'kiko', version })}\n`;

// main gets the plugin manifest first, so a commit above it changes harness/kiko against main's
// own HEAD, which is what the rule compares.
const withMainVersion = (fixture: Fixture, version: string): void => {
  const head = commitFile(fixture, fixture.work, PLUGIN_MANIFEST, pluginManifest(version));
  runGit(fixture.main, fixture.environment, 'merge', '--ff-only', head);
};

const commitPluginChange = (
  fixture: Fixture,
  kind: 'harness' | 'other' | 'manifest-only',
  version: string,
): string => {
  if (kind === 'harness') {
    writeFile(fixture.work, 'harness/kiko/skills/example/SKILL.md', 'changed\n');
  }

  if (kind === 'other') {
    writeFile(fixture.work, 'unrelated.txt', 'changed\n');
  }

  if (kind !== 'other') {
    writeFile(fixture.work, PLUGIN_MANIFEST, pluginManifest(version));
  }

  runGit(fixture.work, fixture.environment, 'add', '-A');
  runGit(fixture.work, fixture.environment, 'commit', '-qm', 'plugin change');

  return runGit(fixture.work, fixture.environment, 'rev-parse', 'HEAD');
};

describe('scripts/ff-main.sh plugin version rule', () => {
  it.each<[string, string, string, 'harness' | 'other' | 'manifest-only', boolean]>([
    ['a harness change at main version', '0.4.21', '0.4.21', 'harness', false],
    ['a harness change with a higher version', '0.4.21', '0.4.22', 'harness', true],
    ['a harness change with a lower version', '0.4.21', '0.4.20', 'harness', false],
    ['no harness change at main version', '0.4.21', '0.4.21', 'other', true],
    ['a harness change from 0.4.9 to 0.4.10 (numeric compare)', '0.4.9', '0.4.10', 'harness', true],
    [
      'a harness change from 0.4.10 to 0.4.9 (numeric compare)',
      '0.4.10',
      '0.4.9',
      'harness',
      false,
    ],
    ['a pure plugin.json bump above main', '0.4.21', '0.4.22', 'manifest-only', true],
  ])('for %s', (_title, mainVersion, commitVersion, kind, moves) => {
    const fixture = createFixture();
    withMainVersion(fixture, mainVersion);
    const before = mainHead(fixture);
    const head = commitPluginChange(fixture, kind, commitVersion);
    record(fixture, doneLine(head));

    const result = runScript(fixture, [head]);

    expect(mainHead(fixture)).toBe(moves ? head : before);
    expect(result.status).toBe(moves ? 0 : 2);

    if (!moves) {
      expect(result.stderr).toContain('plugin.json');
      expect(result.stderr).toContain(mainVersion);
    }
  });

  it('refuses a harness change after a merge brought main ahead to the same version', () => {
    const fixture = createFixture();
    withMainVersion(fixture, '0.4.21');
    const branchPoint = mainHead(fixture);
    const ownChange = commitPluginChange(fixture, 'harness', '0.4.22');
    runGit(fixture.main, fixture.environment, 'checkout', '-q', '-b', 'other-track');
    writeFile(fixture.main, PLUGIN_MANIFEST, pluginManifest('0.4.22'));
    runGit(fixture.main, fixture.environment, 'commit', '-qam', 'other track bump');
    runGit(fixture.main, fixture.environment, 'checkout', '-q', 'main');
    runGit(fixture.main, fixture.environment, 'merge', '--ff-only', 'other-track');
    runGit(fixture.work, fixture.environment, 'merge', '-q', '--no-edit', 'main');
    const head = runGit(fixture.work, fixture.environment, 'rev-parse', 'HEAD');
    record(fixture, doneLine(head));
    const before = mainHead(fixture);

    const result = runScript(fixture, [head]);

    expect(ownChange).not.toBe(branchPoint);
    expect(result.status).toBe(2);
    expect(mainHead(fixture)).toBe(before);
    expect(result.stderr).toContain('plugin.json');
    expect(result.stderr).toContain('0.4.22');
  });
});

describe('scripts/ff-main.sh text', () => {
  const text = readFileSync(SCRIPT, 'utf8');

  it('names no KIKO_ variable other than KIKO_QUEUE_DIR', () => {
    expect([...new Set(text.match(/KIKO_[A-Z_]+/g))]).toEqual(['KIKO_QUEUE_DIR']);
  });

  it('parses no option', () => {
    expect(text).not.toMatch(/getopts|-\*\)/);
  });
});
