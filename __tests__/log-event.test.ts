import {
  existsSync,
  readFileSync,
  copyFileSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { isolatedGitEnvironment } from './test-support/isolated-git';
import { writeFile, writeExecutable } from './test-support/mutation-repository';

// scripts/log-event.sh appends one stamped line to the event log of the MAIN checkout and pushes it
// to the Status terminal. Each test runs a COPY of the script inside a throwaway repository (the
// script finds main as the first worktree of its own repository), with `date` and `orca` replaced
// by PATH stubs: never the real memory folder and never the real Status terminal.
const SCRIPT = join(__dirname, '../scripts/log-event.sh');
const LIBRARY = join(__dirname, '../scripts/checks/_lib.sh');
const LOG_NAME = 'night-summary-2026-10-17.md';
const HANDLE_NAME = 'status-terminal.txt';
const STUB_TIME = '12:34';
const TERMINAL_HANDLE = 'term_status_1';

afterEach(removeTemporaryDirectories);

type Fixture = {
  main: string;
  work: string;
  orcaCalls: string;
  environment: NodeJS.ProcessEnv;
};

const runGit = (cwd: string, environment: NodeJS.ProcessEnv, ...gitArguments: string[]) =>
  execFileSync('git', gitArguments, { cwd, env: environment, encoding: 'utf8' });

const createFixture = (): Fixture => {
  const root = realpathSync(createTemporaryDirectory('kiko-log-event-'));
  const home = join(root, 'home');
  const stubs = join(root, 'stubs');
  const main = join(root, 'main');
  const work = join(root, 'work');
  const orcaCalls = join(root, 'orca-calls.txt');
  mkdirSync(home);
  mkdirSync(stubs);
  mkdirSync(join(main, 'scripts/checks'), { recursive: true });
  mkdirSync(join(main, 'memory/refs'), { recursive: true });
  copyFileSync(SCRIPT, join(main, 'scripts/log-event.sh'));
  copyFileSync(LIBRARY, join(main, 'scripts/checks/_lib.sh'));
  writeFileSync(join(main, 'memory/refs', HANDLE_NAME), `${TERMINAL_HANDLE}\n`);
  writeExecutable(join(stubs, 'date'), `#!/bin/bash\necho ${STUB_TIME}\n`);
  writeExecutable(
    join(stubs, 'orca'),
    `#!/bin/bash\nprintf '%s\\n' "$@" > "${orcaCalls}"\nexit "\${ORCA_EXIT:-0}"\n`,
  );
  const environment = isolatedGitEnvironment(home, {
    PATH: `${stubs}:${process.env.PATH}`,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  });
  runGit(main, environment, 'init', '-q', '-b', 'main');
  writeFile(main, '.gitignore', '/memory/\n');
  runGit(main, environment, 'add', '-A');
  runGit(main, environment, 'commit', '-qm', 'base');
  runGit(main, environment, 'worktree', 'add', '-q', '--detach', work);

  return { main, work, orcaCalls, environment };
};

const runScript = (
  fixture: Fixture,
  args: string[],
  { directory = fixture.main, extraEnvironment = {} } = {},
) =>
  spawnSync('bash', [join(directory, 'scripts/log-event.sh'), ...args], {
    cwd: directory,
    env: { ...fixture.environment, ...extraEnvironment },
    encoding: 'utf8',
  });

const logOf = (fixture: Fixture): string => {
  const path = join(fixture.main, 'memory/refs', LOG_NAME);

  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

const orcaArguments = (fixture: Fixture): string[] =>
  existsSync(fixture.orcaCalls)
    ? readFileSync(fixture.orcaCalls, 'utf8').trimEnd().split('\n')
    : [];

const pushedArguments = (line: string): string[] => [
  'terminal',
  'send',
  '--terminal',
  TERMINAL_HANDLE,
  '--enter',
  '--text',
  `STATUS PUSH: ${line}`,
  '--json',
];

describe('scripts/log-event.sh', () => {
  it('stamps a plain event with the current time, appends it and pushes the same line', () => {
    const fixture = createFixture();

    const result = runScript(fixture, ['text']);

    expect(result.status).toBe(0);
    expect(logOf(fixture)).toBe(`- ${STUB_TIME} text\n`);
    expect(orcaArguments(fixture)).toEqual(pushedArguments(`- ${STUB_TIME} text`));
  });

  it('replaces a caller-passed time with the current time and names the replaced time on stderr', () => {
    const fixture = createFixture();

    const result = runScript(fixture, ['- 09:15 text']);

    expect(result.status).toBe(0);
    expect(logOf(fixture)).toBe(`- ${STUB_TIME} text\n`);
    expect(orcaArguments(fixture)).toEqual(pushedArguments(`- ${STUB_TIME} text`));
    expect(result.stderr).toContain('09:15');
    expect(result.stderr).toContain(STUB_TIME);
  });

  it.each([
    ['a dash and a one-digit hour', '- 9:05 text', '9:05'],
    ['a time with no dash', '14:00 text', '14:00'],
  ])('replaces a caller-passed time written as %s and names it on stderr', (_title, line, time) => {
    const fixture = createFixture();

    const result = runScript(fixture, [line]);

    expect(result.status).toBe(0);
    expect(logOf(fixture)).toBe(`- ${STUB_TIME} text\n`);
    expect(result.stderr).toContain(time);
    expect(result.stderr).toContain(STUB_TIME);
  });

  it('keeps a time that does not lead the event as text, without a stderr note', () => {
    const fixture = createFixture();

    const result = runScript(fixture, ['- text 14:00']);

    expect(result.status).toBe(0);
    expect(logOf(fixture)).toBe(`- ${STUB_TIME} text 14:00\n`);
    expect(result.stderr).toBe('');
  });

  it('stamps a dash-led event that has no time without a stderr note', () => {
    const fixture = createFixture();

    const result = runScript(fixture, ['- text']);

    expect(result.status).toBe(0);
    expect(logOf(fixture)).toBe(`- ${STUB_TIME} text\n`);
    expect(result.stderr).toBe('');
  });

  it.each([
    ['no argument', []],
    ['an empty argument', ['']],
    ['a newline inside the line', ['first\nsecond']],
  ])('refuses %s with the usage block, appending and pushing nothing', (_title, args) => {
    const fixture = createFixture();

    const result = runScript(fixture, args);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CHECK FAILED: log-event.sh');
    expect(result.stderr).toContain('WHAT FAILED:');
    expect(logOf(fixture)).toBe('');
    expect(orcaArguments(fixture)).toEqual([]);
  });

  it('logs the line and exits 1 when no Status handle file exists', () => {
    const fixture = createFixture();
    execFileSync('rm', [join(fixture.main, 'memory/refs', HANDLE_NAME)]);

    const result = runScript(fixture, ['text']);

    expect(result.status).toBe(1);
    expect(logOf(fixture)).toBe(`- ${STUB_TIME} text\n`);
    expect(orcaArguments(fixture)).toEqual([]);
    expect(result.stderr).toContain(HANDLE_NAME);
  });

  it('exits 1 with could not append and pushes nothing when memory/refs is missing', () => {
    const fixture = createFixture();
    execFileSync('rm', ['-r', join(fixture.main, 'memory/refs')]);

    const result = runScript(fixture, ['text']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not append');
    expect(existsSync(join(fixture.main, 'memory/refs'))).toBe(false);
    expect(orcaArguments(fixture)).toEqual([]);
  });

  it('logs the line and exits 1 when the push fails', () => {
    const fixture = createFixture();

    const result = runScript(fixture, ['text'], { extraEnvironment: { ORCA_EXIT: '1' } });

    expect(result.status).toBe(1);
    expect(logOf(fixture)).toBe(`- ${STUB_TIME} text\n`);
    expect(orcaArguments(fixture)).toEqual(pushedArguments(`- ${STUB_TIME} text`));
    expect(result.stderr).toContain(TERMINAL_HANDLE);
  });

  it('run from a linked worktree writes into the main checkout log, not the worktree', () => {
    const fixture = createFixture();

    const result = runScript(fixture, ['text'], { directory: fixture.work });

    expect(result.status).toBe(0);
    expect(logOf(fixture)).toBe(`- ${STUB_TIME} text\n`);
    expect(existsSync(join(fixture.work, 'memory'))).toBe(false);
    expect(orcaArguments(fixture)).toEqual(pushedArguments(`- ${STUB_TIME} text`));
  });
});
