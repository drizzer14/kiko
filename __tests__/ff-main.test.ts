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

  describe('a done.log whose old 5-field block predates the head field', () => {
    const shortAt = (index: number) =>
      `verify old-${String(index).padStart(3, '0')} 0 2026-10-15T10:00:00Z 2026-10-15T10:05:00Z`;
    const leading = Array.from({ length: 60 }, (_, index) => shortAt(index + 1));
    const warningsOf = (stderr: string) =>
      stderr.split('\n').filter((line) => line.includes('WARNING'));

    it('summarizes the leading short lines in one WARNING and still moves main', () => {
      const lateOne = 'verify late-one 1 2026-10-16T22:33:18Z 2026-10-16T22:44:16Z';
      const lateTwo = 'verify torn';
      const fixture = createFixture();
      record(fixture, ...leading, doneLine(fixture.tipCommit), lateOne, lateTwo);

      const result = runScript(fixture, [fixture.tipCommit]);
      const warnings = warningsOf(result.stderr);

      expect(result.status).toBe(0);
      expect(mainHead(fixture)).toBe(fixture.tipCommit);
      expect(warnings).toHaveLength(3);
      expect(warnings[0]).toContain('WARNING: 60 done.log');
      expect(warnings[0]).toContain(shortAt(60));
      expect(warnings[1]).toContain(lateOne);
      expect(warnings[1]).toContain('62');
      expect(warnings[2]).toContain(lateTwo);
      expect(warnings[2]).toContain('63');
    });

    it('gives a file of only short lines one summary WARNING and the refusal stands', () => {
      const fixture = createFixture();
      record(fixture, ...leading.slice(0, 5));

      const result = runScript(fixture, [fixture.tipCommit]);
      const warnings = warningsOf(result.stderr);

      expect(result.status).toBe(2);
      expect(mainHead(fixture)).toBe(fixture.baseCommit);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('WARNING: 5 done.log');
      expect(warnings[0]).toContain(shortAt(5));
    });
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
const withMainManifest = (fixture: Fixture, manifest: string): void => {
  const head = commitFile(fixture, fixture.work, PLUGIN_MANIFEST, manifest);
  runGit(fixture.main, fixture.environment, 'merge', '--ff-only', head);
};

type ChangeKind = 'harness' | 'other' | 'manifest-only' | 'other-with-manifest';

const CHANGE: Record<ChangeKind, { files: string[]; touchesManifest: boolean }> = {
  harness: { files: ['harness/kiko/skills/example/SKILL.md'], touchesManifest: true },
  other: { files: ['unrelated.txt'], touchesManifest: false },
  'manifest-only': { files: [], touchesManifest: true },
  'other-with-manifest': { files: ['unrelated.txt'], touchesManifest: true },
};

// A null manifest deletes the file from the commit under test.
const commitPluginChange = (
  fixture: Fixture,
  kind: ChangeKind,
  manifest: string | null,
): string => {
  for (const file of CHANGE[kind].files) {
    writeFile(fixture.work, file, 'changed\n');
  }

  if (CHANGE[kind].touchesManifest) {
    if (manifest === null) {
      runGit(fixture.work, fixture.environment, 'rm', '-q', PLUGIN_MANIFEST);
    } else {
      writeFile(fixture.work, PLUGIN_MANIFEST, manifest);
    }
  }

  runGit(fixture.work, fixture.environment, 'add', '-A');
  runGit(fixture.work, fixture.environment, 'commit', '-qm', 'plugin change');

  return runGit(fixture.work, fixture.environment, 'rev-parse', 'HEAD');
};

describe('scripts/ff-main.sh plugin version rule', () => {
  const tabbed = '{\n\t"version"\t:\t"0.4.22"\n}\n';

  // A null main manifest leaves main without one; a null commit manifest deletes it in the commit.
  it.each<[string, string | null, string | null, ChangeKind, boolean]>([
    ['at main version', pluginManifest('0.4.21'), pluginManifest('0.4.21'), 'harness', false],
    ['above main', pluginManifest('0.4.21'), pluginManifest('0.4.22'), 'harness', true],
    ['below main', pluginManifest('0.4.21'), pluginManifest('0.4.20'), 'harness', false],
    [
      '0.4.9 to 0.4.10, the last field',
      pluginManifest('0.4.9'),
      pluginManifest('0.4.10'),
      'harness',
      true,
    ],
    [
      '0.4.10 to 0.4.9, the last field',
      pluginManifest('0.4.10'),
      pluginManifest('0.4.9'),
      'harness',
      false,
    ],
    [
      '0.4.21 to 0.5.0, an earlier field',
      pluginManifest('0.4.21'),
      pluginManifest('0.5.0'),
      'harness',
      true,
    ],
    [
      '0.5.0 to 0.4.21, an earlier field',
      pluginManifest('0.5.0'),
      pluginManifest('0.4.21'),
      'harness',
      false,
    ],
    [
      '0.99.99 to 1.0.0, the first field',
      pluginManifest('0.99.99'),
      pluginManifest('1.0.0'),
      'harness',
      true,
    ],
    [
      '0.4.0 to 0.4, fewer fields',
      pluginManifest('0.4.0'),
      pluginManifest('0.4'),
      'harness',
      false,
    ],
    [
      '0.4.21 to 0.4.21.1, more fields',
      pluginManifest('0.4.21'),
      pluginManifest('0.4.21.1'),
      'harness',
      true,
    ],
    [
      '0.4.9 to 0.4.09, a leading zero',
      pluginManifest('0.4.9'),
      pluginManifest('0.4.09'),
      'harness',
      false,
    ],
    ['a missing main manifest', null, pluginManifest('0.4.22'), 'harness', false],
    [
      'an unparseable main version',
      pluginManifest('0.4.21-rc'),
      pluginManifest('0.4.22'),
      'harness',
      false,
    ],
    ['a missing commit manifest', pluginManifest('0.4.21'), null, 'harness', false],
    [
      'an unparseable commit version',
      pluginManifest('0.4.21'),
      pluginManifest('0.4.22-rc'),
      'harness',
      false,
    ],
    [
      'a compact one-line manifest',
      pluginManifest('0.4.21'),
      '{"name":"kiko","version":"0.4.22"}',
      'harness',
      true,
    ],
    ['tabs around the colon', pluginManifest('0.4.21'), tabbed, 'harness', true],
    [
      'no harness change at main version',
      pluginManifest('0.4.21'),
      pluginManifest('0.4.21'),
      'other',
      true,
    ],
    [
      'a pure manifest bump above main',
      pluginManifest('0.4.21'),
      pluginManifest('0.4.22'),
      'manifest-only',
      true,
    ],
  ])('a version change: %s', (_title, mainManifest, commitManifest, kind, moves) => {
    const fixture = createFixture();

    if (mainManifest !== null) {
      withMainManifest(fixture, mainManifest);
    }

    const before = mainHead(fixture);
    const head = commitPluginChange(fixture, kind, commitManifest);
    record(fixture, doneLine(head));

    const result = runScript(fixture, [head]);

    expect(mainHead(fixture)).toBe(moves ? head : before);
    expect(result.status).toBe(moves ? 0 : 2);

    if (!moves) {
      expect(result.stderr).toContain('plugin.json');
    }
  });

  it.each<[string, string | null, ChangeKind]>([
    [
      'a plugin.json-only commit that lowers the version',
      pluginManifest('0.4.21'),
      'manifest-only',
    ],
    [
      'a commit outside harness/kiko that lowers the version',
      pluginManifest('0.4.21'),
      'other-with-manifest',
    ],
    ['a plugin.json-only commit that deletes the manifest', null, 'manifest-only'],
    [
      'a plugin.json-only commit with a non-numeric version',
      pluginManifest('0.5.0-rc.1'),
      'manifest-only',
    ],
  ])('refuses any version decrease: %s', (_title, commitManifest, kind) => {
    const fixture = createFixture();
    withMainManifest(fixture, pluginManifest('0.4.22'));
    const before = mainHead(fixture);
    const head = commitPluginChange(fixture, kind, commitManifest);
    record(fixture, doneLine(head));

    const result = runScript(fixture, [head]);
    const lines = result.stderr.split('\n');

    expect(mainHead(fixture)).toBe(before);
    expect(result.status).toBe(2);
    expect(lines).toContain("WHAT FAILED:    A plugin.json version below main's is refused");
    expect(lines.find((line) => line.startsWith('DETAILS:'))).toContain('0.4.22');
  });

  it.each<[string, string | null, string | null, ChangeKind]>([
    [
      'no harness change at an equal version',
      pluginManifest('0.4.22'),
      pluginManifest('0.4.22'),
      'other-with-manifest',
    ],
    [
      'a plugin.json-only commit that raises the version',
      pluginManifest('0.4.22'),
      pluginManifest('0.4.23'),
      'manifest-only',
    ],
    ['no manifest at main or in the commit and no harness change', null, null, 'other'],
    [
      'no manifest at main and a plugin.json-only commit that adds one',
      null,
      pluginManifest('0.1.0'),
      'manifest-only',
    ],
  ])('moves main without a decrease: %s', (_title, mainManifest, commitManifest, kind) => {
    const fixture = createFixture();

    if (mainManifest !== null) {
      withMainManifest(fixture, mainManifest);
    }

    const head = commitPluginChange(fixture, kind, commitManifest);
    record(fixture, doneLine(head));

    const result = runScript(fixture, [head]);

    expect(mainHead(fixture)).toBe(head);
    expect(result.status).toBe(0);
  });

  it('refuses a harness change after a merge brought main ahead to the same version', () => {
    const fixture = createFixture();
    withMainManifest(fixture, pluginManifest('0.4.21'));
    commitPluginChange(fixture, 'harness', pluginManifest('0.4.22'));
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

    expect(result.status).toBe(2);
    expect(mainHead(fixture)).toBe(before);
    expect(result.stderr).toContain('plugin.json');
    expect(result.stderr).toContain('0.4.22');
  });

  it('ships a manifest with one "version" key at any depth, so the first match is the top one', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', PLUGIN_MANIFEST), 'utf8'));
    const versionKeysIn = (value: unknown): number =>
      typeof value !== 'object' || value === null
        ? 0
        : Object.entries(value).reduce(
            (count, [key, child]) => count + (key === 'version' ? 1 : 0) + versionKeysIn(child),
            0,
          );

    expect(versionKeysIn(manifest)).toBe(1);
    expect(typeof manifest.version).toBe('string');
  });
});

type PatchStub = { log: string };

// The stub records argv, cwd and the HEAD it sees, one line per call, then exits as told. It
// lives untracked in main, as the real node_modules does.
const installPatchStub = (
  fixture: Fixture,
  { exitCode = 0, withBinary = true, withPatches = true } = {},
): PatchStub => {
  const log = join(fixture.home, 'patch-package.log');
  writeFile(fixture.home, 'patch-package.log', '');

  if (withPatches) {
    writeFile(fixture.main, 'patches/x.patch', 'patch\n');
  }

  if (withBinary) {
    const binaryDirectory = join(fixture.main, 'node_modules/.bin');
    mkdirSync(binaryDirectory, { recursive: true });
    writeExecutable(
      join(binaryDirectory, 'patch-package'),
      `#!/usr/bin/env bash\nprintf '%s|%s|%s\\n' "$*" "$(pwd -P)" "$(git rev-parse HEAD)" >> '${log}'\nexit ${exitCode}\n`,
    );
  }

  return { log };
};

const stubCalls = ({ log }: PatchStub): string[] =>
  readFileSync(log, 'utf8').split('\n').filter(Boolean);

const withLockfileChange = (fixture: Fixture): string => {
  const head = commitFile(fixture, fixture.work, 'package-lock.json', '{"lockfileVersion":3}\n');
  record(fixture, doneLine(head));

  return head;
};

describe('scripts/ff-main.sh runs main patch-package after the fast-forward', () => {
  const warningsOf = (stderr: string) =>
    stderr.split('\n').filter((line) => line.includes('WARNING'));

  it('runs the stub once with --error-on-fail, in the main checkout, at the new tip', () => {
    const fixture = createFixture();
    const stub = installPatchStub(fixture);
    const args = greenTip(fixture);

    const result = runScript(fixture, args);

    expect(result.status).toBe(0);
    expect(stubCalls(stub)).toEqual([`--error-on-fail|${fixture.main}|${fixture.tipCommit}`]);
  });

  it('does not run the stub when main has no patches folder', () => {
    const fixture = createFixture();
    const stub = installPatchStub(fixture, { withPatches: false });
    const args = greenTip(fixture);

    const result = runScript(fixture, args);

    expect(result.status).toBe(0);
    expect(mainHead(fixture)).toBe(fixture.tipCommit);
    expect(stubCalls(stub)).toEqual([]);
  });

  it.each<[string, { exitCode?: number; withBinary?: boolean }]>([
    ['the stub exits 1', { exitCode: 1 }],
    ['the stub is missing', { withBinary: false }],
  ])('exits 2 saying main moved, with main at the tip, when %s', (_title, options) => {
    const fixture = createFixture();
    installPatchStub(fixture, options);
    const args = greenTip(fixture);

    const result = runScript(fixture, args);
    const what = result.stderr.split('\n').find((line) => line.startsWith('WHAT FAILED:'));

    expect(result.status).toBe(2);
    expect(mainHead(fixture)).toBe(fixture.tipCommit);
    expect(what).toContain(`main moved to ${fixture.tipCommit}`);
  });

  it('warns naming npm ci when package-lock.json changed, and still runs the stub', () => {
    const fixture = createFixture();
    const stub = installPatchStub(fixture);
    const head = withLockfileChange(fixture);

    const result = runScript(fixture, [head]);
    const warnings = warningsOf(result.stderr);

    expect(result.status).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('npm ci');
    expect(stubCalls(stub)).toHaveLength(1);
  });

  it('warns naming npm ci when only a file under patches/ changed, and still runs the stub', () => {
    const fixture = createFixture();
    const stub = installPatchStub(fixture);
    const head = commitFile(fixture, fixture.work, 'patches/added.patch', 'added patch\n');
    record(fixture, doneLine(head));

    const result = runScript(fixture, [head]);
    const warnings = warningsOf(result.stderr);

    expect(result.status).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('npm ci');
    expect(stubCalls(stub)).toHaveLength(1);
  });

  it('prints no WARNING when package-lock.json is unchanged', () => {
    const fixture = createFixture();
    installPatchStub(fixture);
    const args = greenTip(fixture);

    const result = runScript(fixture, args);

    expect(result.status).toBe(0);
    expect(warningsOf(result.stderr)).toEqual([]);
  });

  it.each<[string, Arrange]>([
    ['no done.log', ofTip],
    ['a red verify', recordOnly((fixture) => doneLine(fixture.tipCommit, 'verify', '1'))],
    ['a main that is not an ancestor of the commit', divergeMain],
    ['a main checkout on another branch', mainOnBranch],
    ['an unusable argument', () => ['--force']],
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
      'a plugin version below main',
      (fixture) => {
        withMainManifest(fixture, pluginManifest('0.4.22'));
        const head = commitPluginChange(fixture, 'harness', pluginManifest('0.4.21'));
        record(fixture, doneLine(head));

        return [head];
      },
    ],
  ])('runs no stub when the refusal is %s', (_title, arrange) => {
    const fixture = createFixture();
    const stub = installPatchStub(fixture);
    const args = arrange(fixture);

    const result = runScript(fixture, args);

    expect(result.status).toBe(2);
    expect(stubCalls(stub)).toEqual([]);
  });
});

describe('package.json postinstall', () => {
  it('is exactly the patch, environment and hooks steps joined by spaced &&', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

    expect(manifest.scripts.postinstall).toBe(
      'patch-package --error-on-fail && node scripts/ensure-env.js && bash scripts/ensure-git-hooks.sh',
    );
  });

  it('starts with patch-package --error-on-fail', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

    expect(manifest.scripts.postinstall.startsWith('patch-package --error-on-fail')).toBe(true);
  });
});

describe('scripts/ff-main.sh text', () => {
  const text = readFileSync(SCRIPT, 'utf8');

  it('names no npx and no npm install', () => {
    expect(text).not.toMatch(/\bnpx\b/);
    expect(text).not.toMatch(/\bnpm install\b/);
  });

  it('never runs npm ci (a WARNING may name it)', () => {
    expect(text).not.toMatch(/(^|&&|\|\||;|\$\(|`)\s*npm ci\b/m);
  });

  it('names no KIKO_ variable other than KIKO_QUEUE_DIR', () => {
    expect([...new Set(text.match(/KIKO_[A-Z_]+/g))]).toEqual(['KIKO_QUEUE_DIR']);
  });

  it('parses no option', () => {
    expect(text).not.toMatch(/getopts|-\*\)/);
  });
});

// A queued verify waits (it cannot be stopped from a spawnSync) while the machine's load is high,
// so a stopped run leaves its waiter at ppid 1: no case may depend on the load it runs under.
const fixtureProcesses = (): string[] =>
  spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter((line) => line.includes('kiko-ff-main-'));

describe('children of the queued-verify cases', () => {
  const PATH_BEFORE = process.env.PATH;

  afterEach(() => {
    process.env.PATH = PATH_BEFORE;
  });

  it('starts a queued verify at once although the machine reports a high load', () => {
    const fixture = createFixture();
    const stubs = createTemporaryDirectory('kiko-load-stub-');
    writeExecutable(join(stubs, 'sysctl'), '#!/usr/bin/env bash\necho "{ 99.00 99.00 99.00 }"\n');
    process.env.PATH = `${stubs}:${PATH_BEFORE}`;
    fixture.environment.KIKO_QUEUE_GATE_LOAD_WAIT_SECONDS = '2';

    const queued = runQueuedVerify(fixture, '#!/usr/bin/env bash\nexit 0\n');

    expect(queued.stdout).not.toContain('WAITING');
  });

  it('leaves no process of any fixture alive once the cases have run', () => {
    expect(fixtureProcesses()).toEqual([]);
  });
});
