import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// The hook-skip denies of scripts/checks/kill-guard.js that are not an option of the git command
// itself: an `export` or bare assignment that sets core.hooksPath through GIT_CONFIG_*, an
// `include.path` entry, and `git commit-tree`, which makes a commit no hook sees.
//
// Every text here is judged, never run: `decide` is called in node as a parser only, and the hook
// rows only pipe JSON into kill-guard.sh.
const SCRIPT = join(__dirname, '../scripts/checks/kill-guard.sh');
const GUARD = join(__dirname, '../scripts/checks/kill-guard.js');

const DECIDE_SCRIPT = [
  'const { decide } = require(process.argv[1]);',
  'const finding = decide(process.argv[2], JSON.parse(process.argv[3]));',
  'process.stdout.write(finding === null ? "allow" : finding.kind);',
].join('\n');

const decide = (command: string, options: Record<string, unknown> = {}): string =>
  spawnSync('node', ['-e', DECIDE_SCRIPT, GUARD, command, JSON.stringify(options)], {
    encoding: 'utf8',
  }).stdout;

const run = (command: string): SpawnSyncReturns<string> =>
  spawnSync('bash', [SCRIPT], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
  });

const reasonOf = (command: string): string =>
  JSON.parse(run(command).stdout.trim()).hookSpecificOutput.permissionDecisionReason;

// An assignment that sets core.hooksPath (or an include) through the config environment denies by
// itself, whatever runs after it: an `export`, a `declare -x`, or a bare statement.
const DENIED_ENVIRONMENT_STATEMENTS: string[] = [
  'export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null',
  'export GIT_CONFIG_KEY_0=core.hooksPath',
  'export GIT_CONFIG_KEY_0=CORE.HOOKSPATH',
  "export GIT_CONFIG_KEY_0='core.hooksPath'",
  'export GIT_CONFIG_COUNT=1; export GIT_CONFIG_KEY_0=core.hooksPath; git commit -m x',
  'declare -x GIT_CONFIG_KEY_0=core.hooksPath',
  'typeset -x GIT_CONFIG_KEY_3=core.hookspath',
  'local GIT_CONFIG_KEY_0=core.hooksPath',
  'readonly GIT_CONFIG_KEY_0=core.hooksPath',
  'GIT_CONFIG_KEY_0=core.hooksPath',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath; git commit -m x',
  'export GIT_CONFIG_PARAMETERS="\'core.hooksPath=/dev/null\'"',
  "declare -x GIT_CONFIG_PARAMETERS=\"'user.name=x' 'core.hookspath=/dev/null'\"",
  'export GIT_CONFIG_KEY_0=include.path',
  'export GIT_CONFIG_KEY_1=includeIf.gitdir:/tmp/.path',
  'true && export GIT_CONFIG_KEY_0=core.hooksPath',
  'sh -c "export GIT_CONFIG_KEY_0=core.hooksPath"',
];

const ALLOWED_ENVIRONMENT_STATEMENTS: string[] = [
  'export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=cat',
  'export GIT_CONFIG_VALUE_0=core.hooksPath',
  'export PATH="$PATH:/tmp/bin"',
  'export GIT_CONFIG_NOSYSTEM=1',
  'GIT_CONFIG_KEY_0=core.pager git status',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git status',
  'echo export GIT_CONFIG_KEY_0=core.hooksPath',
  'unset GIT_CONFIG_KEY_0',
];

// GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM swap the global and system config files, which are not
// judged: scripts/ensure-git-hooks.sh writes core.hooksPath in the LOCAL scope, and the local
// scope outranks both of them and every file they include, so a swapped file cannot switch the
// hooks off. (GIT_CONFIG_COUNT/KEY_n/VALUE_n/PARAMETERS inject config at command scope, which does
// outrank it: those stay denied above.)
const CONFIG_FILE_COMMANDS: string[] = [
  'GIT_CONFIG_GLOBAL=/dev/null git commit -m x',
  'GIT_CONFIG_SYSTEM=/dev/null git merge --no-edit feature',
  'GIT_CONFIG_GLOBAL=/tmp/hooks.gitconfig git commit -m x',
  'GIT_CONFIG_SYSTEM=/tmp/include.gitconfig git pull',
  'GIT_CONFIG_GLOBAL=/tmp/missing.gitconfig GIT_CONFIG_SYSTEM=/dev/null git commit -m x',
  'GIT_CONFIG_GLOBAL="$HOME/.gitconfig-agent" git commit -m x',
  'GIT_CONFIG_GLOBAL= git commit -m x',
  'env GIT_CONFIG_GLOBAL=/tmp/hooks.gitconfig git commit -m x',
  'export GIT_CONFIG_GLOBAL=/tmp/hooks.gitconfig',
  'export GIT_CONFIG_SYSTEM=/tmp/missing.gitconfig; git commit -m x',
  'declare -x GIT_CONFIG_GLOBAL=/tmp/include.gitconfig',
  'GIT_CONFIG_GLOBAL=/tmp/hooks.gitconfig; git commit -m x',
  'bash -c "GIT_CONFIG_GLOBAL=/tmp/hooks.gitconfig git commit -m x"',
  'GIT_CONFIG_GLOBAL=/tmp/hooks.gitconfig git status',
];

// `include.path` and `includeIf.<condition>.path` pull another file into the config, so they can
// carry a hooksPath. On a hook-running subcommand a `-c` or `--config-env` entry denies, and so
// does a `git config` that writes the key.
const DENIED_INCLUDE_COMMANDS: string[] = [
  'git -c include.path=/tmp/hooks.gitconfig commit -m x',
  'git -c INCLUDE.PATH=/tmp/hooks.gitconfig merge feature',
  'git -c includeIf.gitdir:/tmp/.path=/tmp/hooks.gitconfig commit -m x',
  'git -c includeif.onbranch:main.path=/tmp/h pull',
  'git -c user.name=x -c include.path=/tmp/hooks.gitconfig commit',
  'git --config-env=include.path=HOOKS commit -m x',
  'git --config-env include.path=HOOKS commit',
  'git --config-env=includeIf.gitdir:/tmp/.path=HOOKS merge feature',
  'sh -c "git -c include.path=/tmp/h commit -m x"',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=include.path GIT_CONFIG_VALUE_0=/tmp/h git commit -m x',
  'GIT_CONFIG_PARAMETERS="\'include.path=/tmp/h\'" git commit -m x',
  'git config include.path /tmp/hooks.gitconfig',
  'git config --add include.path /tmp/hooks.gitconfig',
  'git config --global include.path /tmp/hooks.gitconfig',
  'git config includeIf.gitdir:/tmp/.path /tmp/hooks.gitconfig',
  'git config --unset include.path',
  'git config --unset-a include.path',
  'git config set include.path /tmp/hooks.gitconfig',
];

const ALLOWED_INCLUDE_COMMANDS: string[] = [
  'git -c include.path=/tmp/hooks.gitconfig status',
  'git -c include.pathfoo=x commit -m x',
  'git -c core.pager=cat commit -m x',
  'git config --get include.path',
  'git config --get-all includeIf.gitdir:/tmp/.path',
  'git config --list',
  'git config user.name x',
  'git config include.pathfoo x',
];

// `git commit-tree` writes a commit object without running any hook; it is denied in every form.
// `git update-ref` stays allowed (scripts/checks/guard-replay.sh uses it inside a script).
const DENIED_COMMIT_TREE_COMMANDS: string[] = [
  'git commit-tree HEAD^{tree} -m x',
  'git commit-tree -p HEAD HEAD^{tree} -m x',
  'git -C /tmp/scratch commit-tree HEAD^{tree} -m x',
  'git -c user.name=x commit-tree HEAD^{tree}',
  'sha=$(git commit-tree HEAD^{tree} -m x) && git update-ref refs/heads/x "$sha"',
  'echo x | git commit-tree HEAD^{tree}',
  'sh -c "git commit-tree HEAD^{tree} -m x"',
  'env GIT_AUTHOR_NAME=x git commit-tree HEAD^{tree}',
  'sudo git commit-tree HEAD^{tree}',
];

const ALLOWED_COMMIT_TREE_COMMANDS: string[] = [
  'git update-ref refs/heads/x HEAD',
  'git update-ref -d refs/heads/x',
  'git commit -m "commit-tree is banned"',
  'echo git commit-tree',
  'git log --oneline -3',
  'git write-tree',
];

describe('kill-guard hook skips beyond the git command line (parser only)', () => {
  it.each(DENIED_ENVIRONMENT_STATEMENTS)('denies an environment statement: %s', (command) => {
    expect(decide(command)).toBe('hooksConfig');
  });

  it.each(ALLOWED_ENVIRONMENT_STATEMENTS)('allows an environment statement: %s', (command) => {
    expect(decide(command)).toBe('allow');
  });

  it.each(CONFIG_FILE_COMMANDS)('allows a global or system config file swap: %s', (command) => {
    expect(decide(command)).toBe('allow');
  });

  it.each(DENIED_INCLUDE_COMMANDS)('denies an include entry: %s', (command) => {
    expect(decide(command)).toBe('hooksConfig');
  });

  it.each(ALLOWED_INCLUDE_COMMANDS)('allows: %s', (command) => {
    expect(decide(command)).toBe('allow');
  });

  it.each(DENIED_COMMIT_TREE_COMMANDS)('denies git commit-tree: %s', (command) => {
    expect(decide(command)).toBe('noVerify');
  });

  it.each(ALLOWED_COMMIT_TREE_COMMANDS)('allows: %s', (command) => {
    expect(decide(command)).toBe('allow');
  });
});

describe('kill-guard hook skips (hook entry)', () => {
  it('names scripts/ensure-git-hooks.sh when an export sets core.hooksPath', () => {
    const reason = reasonOf('export GIT_CONFIG_KEY_0=core.hooksPath');

    expect(reason).toContain('leave core.hooksPath as scripts/ensure-git-hooks.sh sets it');
    expect(reason).toContain('bash scripts/ensure-git-hooks.sh');
  });

  it('tells a commit-tree caller to use git commit, so the hook runs', () => {
    const reason = reasonOf('git commit-tree HEAD^{tree} -m x');

    expect(reason).toContain('git commit-tree');
    expect(reason).toContain('git commit');
    expect(reason).toContain('pre-commit');
  });

  it('allows a plain commit with a swapped global config file', () => {
    const result = run('GIT_CONFIG_GLOBAL=/tmp/safe.gitconfig git commit -m x');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});
