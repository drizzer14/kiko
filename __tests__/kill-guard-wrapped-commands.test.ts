import { join } from 'node:path';

import {
  createFakeRepository,
  decideInEachFolder,
} from './test-support/kill-guard-fake-repository';
import { decideAll } from './test-support/kill-guard-decide';
import { removeTemporaryDirectories } from './test-support/temporary-directory';

// Commands the guard must judge behind a wrapper (caffeinate, arch, sandbox-exec, script, screen,
// tmux, osascript) or inside the text an `orca` call types into a terminal. Every text is judged,
// never run.
const repository = createFakeRepository('guard-wrapped-commands-');
const REPOSITORY_ROOT = join(__dirname, '..');
afterAll(removeTemporaryDirectories);

const EVERY_FOLDER = (kind: string): string[] => [kind, kind, kind];

const CAFFEINATE_WRAPPERS = [
  'caffeinate',
  'caffeinate -i',
  'caffeinate -t 5',
  'caffeinate -t5',
  'caffeinate -it 5',
  'caffeinate -w 1',
  'caffeinate -i --',
  'caffeinate -dimsu',
];

const WRAPPED_KINDS: [command: string, kind: string][] = [
  ['pkill node', 'kill'],
  ['kill -9 -1', 'kill'],
  ['make verify', 'heavyJob'],
  ['npm run check:all', 'heavyJob'],
  ['npx jest', 'fullJest'],
  ['git stash', 'stash'],
  ['sed -i s/a/b/ src/x.ts', 'shellWrite'],
];

const inFakeMain = (command: string): string =>
  decideAll([[command, { cwd: repository.main, mainCheckoutPath: repository.main }]])[0];

describe('kill-guard wrapped commands (parser only, fake repository)', () => {
  const caffeinateRows = CAFFEINATE_WRAPPERS.flatMap((wrapper) =>
    WRAPPED_KINDS.map(([command, kind]): [string, string, string] => [wrapper, command, kind]),
  );

  it.each(caffeinateRows)(
    'denies a command behind caffeinate like the bare command: %s %s',
    (wrapper, command, kind) => {
      expect(decideInEachFolder(repository, `${wrapper} ${command}`)).toEqual(
        decideInEachFolder(repository, command),
      );
      expect(decideInEachFolder(repository, `${wrapper} ${command}`)).toContain(kind);
    },
  );

  it.each(CAFFEINATE_WRAPPERS)(
    'denies a git merge in the main checkout behind caffeinate: %s',
    (wrapper) => {
      expect(inFakeMain('git merge x')).toBe('mainCheckout');
      expect(inFakeMain(`${wrapper} git merge x`)).toBe('mainCheckout');
    },
  );

  it.each([
    ['orca terminal send --text "npm run check:all"', 'heavyJob'],
    ['orca terminal send --text=npm\\ run\\ check:all', 'heavyJob'],
    ["orca terminal send --terminal t1 --text 'make verify' --enter", 'heavyJob'],
    ["orca terminal send --text 'pkill node' --enter", 'kill'],
    ["orca terminal send --text 'kill -9 -1'", 'kill'],
    ["orca terminal send --text 'git stash'", 'stash'],
    ["orca terminal send --text 'cd /x && npx jest'", 'fullJest'],
    [
      "/Applications/Orca.app/Contents/Resources/bin/orca terminal send --text 'make verify'",
      'heavyJob',
    ],
    ["caffeinate -i orca terminal send --text 'make verify'", 'heavyJob'],
    ["orca computer type-text --text 'make verify'", 'heavyJob'],
  ])('judges the --text of an orca call as a typed command: %s', (command, kind) => {
    expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER(kind));
  });

  // A relative path outside the project is no guarded tree, so the bare command is allowed there:
  // the sent text gets the bare command's verdict in each folder, not shellWrite in all three.
  it('judges the --text of an orca call that writes into a tree like the bare command', () => {
    const bare = decideInEachFolder(repository, 'sed -i s/a/b/ src/x.ts');

    expect(bare).toEqual(['shellWrite', 'shellWrite', 'allow']);
    expect(
      decideInEachFolder(repository, "orca terminal send --text 'sed -i s/a/b/ src/x.ts'"),
    ).toEqual(bare);
  });

  it('judges the --command of orca terminal create', () => {
    expect(
      decideInEachFolder(
        repository,
        "orca terminal create --worktree active --command 'make verify; echo __ORCA_DONE_$?__'",
      ),
    ).toEqual(EVERY_FOLDER('heavyJob'));
  });

  // The value options were read from `man arch` (-arch, -d and -e take a value), `man
  // sandbox-exec` (-f, -n, -p and -D), `man script` (-t takes a value; the file operand comes
  // before the command) and `man screen` (-S, -c, -e, -h, -p, -s, -t and -T take a value). tmux is
  // not installed on this machine: its options (new-session -s -n -c -x -y -e -F -t, send-keys -t
  // -N, split-window -t -c -e -l -F, respawn-pane -t -c -e) are from tmux(1) as known, not probed.
  it.each([
    ['arch -arm64 pkill node', 'kill'],
    ['arch -arch arm64 pkill node', 'kill'],
    ['arch -e NAME=value pkill node', 'kill'],
    ['arch -d NAME pkill node', 'kill'],
    ['sandbox-exec -n no-network make verify', 'heavyJob'],
    ["sandbox-exec -p '(version 1)' make verify", 'heavyJob'],
    ['sandbox-exec -D key=value -f profile.sb make verify', 'heavyJob'],
    ['script -q /dev/null make verify', 'heavyJob'],
    ['script -q /dev/null pkill node', 'kill'],
    ['script -q -t 1 out.log make verify', 'heavyJob'],
    ['screen -dm make verify', 'heavyJob'],
    ['screen -S name -dm pkill node', 'kill'],
    ['screen -d -m -S name make verify', 'heavyJob'],
    ["tmux new-session -d 'make verify'", 'heavyJob'],
    ["tmux new -d -s name 'pkill node'", 'kill'],
    ["tmux split-window -h 'make verify'", 'heavyJob'],
    ["tmux respawn-pane -k -t x 'make verify'", 'heavyJob'],
    ["tmux send-keys -t x 'npm run check:all' Enter", 'heavyJob'],
    ["tmux send-keys -t x 'pkill node' Enter", 'kill'],
  ])('denies a command behind a wrapper like the bare one: %s', (command, kind) => {
    expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER(kind));
  });

  // osascript runs an arbitrary shell through `do shell script`; the finding kind is its own,
  // osascriptShell, whatever the shell text says.
  it.each([
    `osascript -e 'do shell script "echo hi"'`,
    `osascript -e 'tell application "Finder"' -e 'do shell script "make verify"'`,
    `osascript -e 'do shell script "pkill node"'`,
  ])('denies an osascript script text with do shell script: %s', (command) => {
    expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER('osascriptShell'));
  });

  // The tmux alias names (neww, run) are from memory of tmux(1): tmux is not installed here.
  it.each([
    ["tmux new-window 'make verify'", 'make verify'],
    ["tmux neww 'pkill node'", 'pkill node'],
    ["tmux run-shell 'make verify'", 'make verify'],
    ["tmux run 'npm run check:all'", 'npm run check:all'],
    ["tmux if-shell true 'make verify'", 'make verify'],
    ["tmux if-shell 'make verify' 'true'", 'make verify'],
    ["screen -S s -X stuff 'make verify^M'", 'make verify'],
  ])('judges the command text of %s like the bare command', (command, bareCommand) => {
    const bare = decideInEachFolder(repository, bareCommand);

    expect(bare).not.toEqual(EVERY_FOLDER('allow'));
    expect(decideInEachFolder(repository, command)).toEqual(bare);
  });

  // Review 1 (round 3). The tmux rows are unmeasured: tmux is not installed here, so its alias
  // names (respawnw, sp) and the `\;` command separator are from memory of tmux(1).
  it.each([
    ['screen -S s -X screen make verify', 'make verify'],
    ['screen -X exec make verify', 'make verify'],
    [`screen -X eval 'stuff "make verify^M"'`, 'make verify'],
    ["screen -r s -X stuff 'make verify\\n'", 'make verify'],
    ["screen -x s -X stuff 'make verify\\n'", 'make verify'],
    ["$'make' verify", 'make verify'],
    ["npm run $'check:all'", 'npm run check:all'],
    ["orca terminal send --text $'make verify\\n'", 'make verify'],
    ["screen -X stuff $'make verify\\n'", 'make verify'],
    ["tmux -c 'make verify'", 'make verify'],
    ["tmux new -d \\; send-keys 'make verify' Enter", 'make verify'],
    ["tmux respawnw -k 'make verify'", 'make verify'],
    ["tmux popup -E 'make verify'", 'make verify'],
    ["tmux pipe-pane 'make verify'", 'make verify'],
    ["tmux sp 'make verify'", 'make verify'],
    ["tmux new -d bash -c 'make verify'", 'make verify'],
    ["tmux send-keys -t x 'make' ' verify' Enter", 'make verify'],
  ])('judges %s like the bare command (review 1)', (command, bareCommand) => {
    const bare = decideInEachFolder(repository, bareCommand);

    expect(bare).toEqual(EVERY_FOLDER('heavyJob'));
    expect(decideInEachFolder(repository, command)).toEqual(bare);
  });

  // An escaped quote inside an ANSI-C string must not close it early and hide the rest of the line.
  it.each([
    ["git commit -m $'Fix: don\\'t\\nbody' && make verify", 'make verify'],
    ["echo $'it\\'s' ; pkill node", 'pkill node'],
    ["echo $'it\\'s' && git stash", 'git stash'],
  ])('judges the command after an escaped quote in an ANSI-C string: %s', (command, second) => {
    const bare = decideInEachFolder(repository, second);

    expect(bare).not.toEqual(EVERY_FOLDER('allow'));
    expect(decideInEachFolder(repository, command)).toEqual(bare);
  });

  // Measured on /bin/bash 3.2.57: `$$` is the pid, so the quote after it is a plain single quote
  // (`'a\'` ends at the second quote and the command after `&&` runs); `$` opens `$'` only after an
  // odd run of unescaped `$`; an escaped `\$` is a literal `$` before a plain single quote.
  it.each([
    ["echo $$'a\\' && pkill node # '", 'pkill node'],
    ["echo $$'a\\' && make verify # '", 'make verify'],
    ["echo $$$'a\\'' && pkill node", 'pkill node'],
    ["echo \\$'a\\' && pkill node", 'pkill node'],
  ])('reads a dollar run before a quote like bash: %s', (command, second) => {
    const bare = decideInEachFolder(repository, second);

    expect(bare).not.toEqual(EVERY_FOLDER('allow'));
    expect(decideInEachFolder(repository, command)).toEqual(bare);
  });

  it.each(["git commit -m $'Fix: don\\'t\\nbody'", "echo $'a\\'b' 'c'"])(
    'allows an ANSI-C string with an escaped quote: %s',
    (command) => {
      expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER('allow'));
    },
  );

  it('denies a Terminal doScript call in a JavaScript osascript text', () => {
    expect(
      decideInEachFolder(
        repository,
        `osascript -l JavaScript -e 'Application("Terminal").doScript("make verify")'`,
      ),
    ).toEqual(EVERY_FOLDER('osascriptShell'));
  });

  it.each([`osascript -e 'display dialog "Do scripts run?"'`, "echo $'a\\tb'"])(
    'allows a harmless text that only looks close: %s',
    (command) => {
      expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER('allow'));
    },
  );

  it('denies (accepted false positive, R3) prose that quotes a heavy command in backticks', () => {
    expect(
      decideInEachFolder(repository, "orca terminal send --text 'Do not run `make verify`; wait.'"),
    ).toEqual(EVERY_FOLDER('heavyJob'));
  });

  it.each([
    `osascript -e 'tell application "Terminal" to do script "make verify"'`,
    `osascript -l JavaScript -e 'app.doShellScript("pkill node")'`,
  ])('denies an osascript script text with do script or doShellScript: %s', (command) => {
    expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER('osascriptShell'));
  });

  it('allows caffeinate -ti: caffeinate refuses -ti, so the command never runs', () => {
    expect(decideInEachFolder(repository, 'caffeinate -ti 5 make verify')).toEqual(
      EVERY_FOLDER('allow'),
    );
  });

  it.each([
    'tmux new-window',
    "tmux run-shell 'echo hi'",
    'screen -S s -X quit',
    `osascript -e 'tell application "Terminal" to activate'`,
  ])('allows a harmless tmux, screen or osascript command: %s', (command) => {
    expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER('allow'));
  });

  it.each([
    'osascript script.scpt',
    'osascript < script.scpt',
    'orca terminal send --text "$X" --enter',
  ])('allows (known limit) a script text the guard cannot read: %s', (command) => {
    expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER('allow'));
  });

  it.each([
    'caffeinate -i npm run check:lint',
    'arch -arm64 true',
    'sandbox-exec -n no-network true',
    'script -q /dev/null true',
    'screen -ls',
    'tmux ls',
    "tmux send-keys -t x 'echo hi' Enter",
    'osascript -e \'display notification "x"\'',
  ])('allows a harmless command behind a wrapper: %s', (command) => {
    expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER('allow'));
  });

  // Known limits: measured ALLOW today and expected to stay so, listed in kiko-linter.
  it.each(['ssh host pkill node', "echo 'make verify' | at now"])(
    'allows (known limit) a command the guard cannot reach: %s',
    (command) => {
      expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER('allow'));
    },
  );

  it.each([
    "orca terminal send --text 'Status: verify green. Next: merge.' --enter",
    "orca terminal send --text '/reload-plugins' --enter",
    "orca terminal send --text 'Read memory/refs/brief-h11.md and start.' --enter",
    "orca terminal send --text 'npm run deploy:device' --enter",
    'orca terminal send --text --enter',
    'orca terminal send --text "$X" --enter',
  ])('allows prose and a non-heavy command sent to a terminal: %s', (command) => {
    expect(decideInEachFolder(repository, command)).toEqual(EVERY_FOLDER('allow'));
  });

  it('allows the real log-event script, which sends a STATUS PUSH text', () => {
    expect(decideAll([['bash scripts/log-event.sh x', { projectRoot: REPOSITORY_ROOT }]])).toEqual([
      'allow',
    ]);
  });

  it.each([
    (worktree: string) => `caffeinate -i bash scripts/job-queue.sh verify ${worktree} label`,
    () => 'caffeinate -i make mutable',
    () => 'caffeinate -i make -n verify',
  ])('still allows a queued job behind caffeinate: row %#', (build) => {
    expect(decideInEachFolder(repository, () => build(repository.worktree))).toEqual(
      EVERY_FOLDER('allow'),
    );
  });

  it('reads the -t value of caffeinate as a value: the next word is no command', () => {
    expect(decideInEachFolder(repository, 'caffeinate -t 5 true')).toEqual(EVERY_FOLDER('allow'));
  });

  it('reads the -w value of caffeinate as a value: the word after it is the command', () => {
    expect(decideInEachFolder(repository, 'caffeinate -w 1 pkill node')).toEqual(
      EVERY_FOLDER('kill'),
    );
  });
});
