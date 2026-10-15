import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// A heredoc body is judged by what reads it. A quoted body that no shell runs (`cat > f <<'EOF'`,
// `git commit -F - <<'EOF'`, a commit message through `$(cat <<'EOF' ...)`) is text, judged as it
// always was: for a kill, a git stash, a main-checkout merge, a hook skip by option,
// `core.hooksPath` config or a wait loop, and for nothing the guard learned since. A body a shell
// or `eval` runs (`bash <<'EOF'`, `sh -c "$(cat <<'EOF' ...)"`, `eval "$(cat <<'EOF' ...)"`,
// `source /dev/stdin`) is judged in full, like the same text typed as a command.
//
// Every text here is judged, never run: `decide` is called in node as a parser only.
const GUARD = join(__dirname, '../scripts/checks/kill-guard.js');
const MAIN_CHECKOUT = '/Users/drizzer14/Developer/Projects/pff-ios';

const DECIDE_MANY_SCRIPT = [
  'const { decide } = require(process.argv[1]);',
  'const options = JSON.parse(process.argv[2]);',
  'const finding = (text) => {',
  '  const found = decide(text, options);',
  '  return found === null ? "allow" : found.kind;',
  '};',
  'process.stdout.write(JSON.stringify(JSON.parse(process.argv[3]).map(finding)));',
].join('\n');

// One node process judges a whole list, so a long table costs one start-up.
const decideMany = (commands: string[]): string[] =>
  JSON.parse(
    spawnSync(
      'node',
      [
        '-e',
        DECIDE_MANY_SCRIPT,
        GUARD,
        JSON.stringify({ mainCheckoutPath: MAIN_CHECKOUT }),
        JSON.stringify(commands),
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ).stdout,
  );

const decide = (command: string): string => decideMany([command])[0];

type Template = [name: string, wrap: (line: string) => string];

// The ways a body reaches a command that only stores it: a file, a commit message, a remote shell's
// or an interpreter's stdin, and the same text inside backticks in a list item of a note.
const DATA_TEMPLATES: Template[] = [
  ['cat to a file', (line) => `cat > f.md <<'EOF'\n${line}\nEOF`],
  ['commit -F -', (line) => `git commit -F - <<'EOF'\n${line}\nEOF`],
  ['commit -m through cat', (line) => `git commit -m "$(cat <<'EOF'\n${line}\nEOF\n)"`],
  ['ssh', (line) => `ssh host <<'EOF'\n${line}\nEOF`],
  ['python', (line) => `python3 - <<'EOF'\n${line}\nEOF`],
  ['tee', (line) => `tee notes.md <<'EOF'\n${line}\nEOF`],
  ['backticks in a note', (line) => `cat > f.md <<'EOF'\n- \`${line}\` denies\nEOF`],
];

// The ways a body is run as shell text.
const RUN_TEMPLATES: Template[] = [
  ['bash', (line) => `bash <<'EOF'\n${line}\nEOF`],
  ['eval of cat', (line) => `eval "$(cat <<'EOF'\n${line}\nEOF\n)"`],
  ['sh -c of cat', (line) => `sh -c "$(cat <<'EOF'\n${line}\nEOF\n)"`],
  ['source /dev/stdin', (line) => `source /dev/stdin <<'EOF'\n${line}\nEOF`],
  ['dot /dev/stdin', (line) => `. /dev/stdin <<'EOF'\n${line}\nEOF`],
  ['span in command position', (line) => `$(cat <<'EOF'\n${line}\nEOF\n)`],
  ['bash process substitution', (line) => `bash <(cat <<'EOF'\n${line}\nEOF\n)`],
  ['source process substitution', (line) => `source <(cat <<'EOF'\n${line}\nEOF\n)`],
  ['eval with stdin', (line) => `eval "$(cat)" <<'EOF'\n${line}\nEOF`],
  ['sudo bash -c of cat', (line) => `sudo bash -c "$(cat <<'EOF'\n${line}\nEOF\n)"`],
];

// The kinds the guard reported for a data body before this set, and the finding kind that
// replaced `noVerify` for the config texts.
const BASE_DATA_KINDS = ['kill', 'stash', 'noVerify', 'hooksConfig', 'mainCheckout', 'waitLoop'];

// Pinned from the base (30dfecf4): every one of these, as a line of any data body above, was
// denied there. No kind may leave this list.
const BASE_DENIED_LINES: string[] = [
  'pkill node',
  'kill -9 -1',
  'git stash',
  'git commit --no-verify -m x',
  'git commit -n -m x',
  'git merge --no-verify x',
  'git pull --no-verify',
  'git -c core.hooksPath=/dev/null commit -m x',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
  'git config --unset core.hooksPath',
  'git config core.hooksPath /dev/null',
  `git -C ${MAIN_CHECKOUT} merge x`,
  `cd ${MAIN_CHECKOUT} && git pull origin x`,
  'while ps | grep jest; do sleep 1; done',
];

// What this set added: a body that no shell runs does not judge these (the scribe incidents:
// documents that name them), and a body that is run does, like any command.
const ADDED_LINES: string[] = [
  'git commit-tree HEAD^{tree}',
  'export GIT_CONFIG_KEY_0=core.hooksPath',
  'git -c include.path=/tmp/x commit -m x',
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=include.path GIT_CONFIG_VALUE_0=/tmp/x git commit -m x',
  'git config --unset-a core.hooksPath',
  'git config --remove-section core',
  'sed -i "" s/a/b/ src/x.ts',
  'echo x > src/x.ts',
  'cat <<INNER\nx\nINNER',
];

// Allowed alone, so allowed in any body too: neither is judged as a command.
const NEVER_JUDGED_LINES: string[] = ['export GIT_CONFIG_GLOBAL=/tmp/x', 'pid=-1; kill -9 $pid'];

describe('kill-guard: a heredoc body that no shell runs', () => {
  it('is judged for every kind the base judged, as before', () => {
    const texts = DATA_TEMPLATES.flatMap(([, wrap]) => BASE_DENIED_LINES.map(wrap));
    const kinds = decideMany(texts);

    expect(texts.filter((_text, index) => kinds[index] === 'allow')).toEqual([]);
    expect(kinds.filter((kind) => !BASE_DATA_KINDS.includes(kind))).toEqual([]);
  });

  it('is not judged for what this set added, and no variable the command assigns reaches it', () => {
    const lines = [...ADDED_LINES, ...NEVER_JUDGED_LINES];
    const texts = DATA_TEMPLATES.flatMap(([, wrap]) => lines.map(wrap));
    const kinds = decideMany(texts);

    expect(texts.filter((_text, index) => kinds[index] !== 'allow')).toEqual([]);
  });

  // The incident texts (documents that name a bypass), as the scribe wrote them.
  it.each([
    "cat > f.md <<'EOF'\n- `pid=-1; kill -9 $pid` denies\nEOF",
    "git commit -F - <<'EOF'\ndocs: the guard reads `pid=-1; kill -9 $pid` as a group kill\nEOF",
    'git commit -m "$(cat <<\'EOF\'\ndocs: `pid=-1; kill -9 $pid` now denies\nEOF\n)"',
    "pid=-1; cat > notes.md <<'EOF'\nkill -9 $pid\nEOF",
    "cat > f.md <<'EOF'\nthe guard denies `git commit-tree` in every form\nEOF",
    "cat > f.md <<'EOF'\n- `export GIT_CONFIG_KEY_0=core.hooksPath` denies\nEOF",
    "cat > f.md <<'EOF'\n- `export GIT_CONFIG_GLOBAL=/tmp/x` denies\nEOF",
    "cat > f.md <<'EOF'\n- `git -c include.path=/tmp/x commit` denies\nEOF",
  ])('allows an incident text: %s', (text) => {
    expect(decide(text)).toBe('allow');
  });

  // The base denied each of these, so a note that shows one in backticks still denies.
  it.each([
    "cat > f.md <<'EOF'\n- `git config --unset core.hooksPath` denies\nEOF",
    "cat > f.md <<'EOF'\n- `git commit --no-verify` denies\nEOF",
    `cat > f.md <<'EOF'\n- \`git -C ${MAIN_CHECKOUT} merge x\` denies\nEOF`,
    "cat > f.md <<'EOF'\n- `while ps | grep jest; do sleep 1; done` denies\nEOF",
    "cat > f.md <<'EOF'\n- `git stash` denies\nEOF",
    "cat > f.md <<'EOF'\n- `pkill node` denies\nEOF",
  ])('still denies a base kind: %s', (text) => {
    expect(BASE_DATA_KINDS).toContain(decide(text));
  });
});

describe('kill-guard: a heredoc body that a shell or eval runs', () => {
  const lines = [...BASE_DENIED_LINES, ...ADDED_LINES, ...NEVER_JUDGED_LINES];

  it.each(RUN_TEMPLATES)('is judged like the same line typed as a command: %s', (_name, wrap) => {
    const alone = decideMany(lines);
    const inBody = decideMany(lines.map(wrap));

    expect(inBody.map((kind) => kind === 'allow')).toEqual(alone.map((kind) => kind === 'allow'));
  });

  it('is denied for the loosening probes', () => {
    const kinds = decideMany([
      'eval "$(cat <<\'EOF\'\ngit commit --no-verify -m x\nEOF\n)"',
      `eval "$(cat <<'EOF'\ngit -C ${MAIN_CHECKOUT} merge x\nEOF\n)"`,
      'eval "$(cat <<\'EOF\'\ngit commit-tree HEAD^{tree}\nEOF\n)"',
      'eval "$(cat <<\'EOF\'\nexport GIT_CONFIG_KEY_0=core.hooksPath\nEOF\n)"',
      'sh -c "$(cat <<\'EOF\'\ngit -c include.path=/tmp/x commit\nEOF\n)"',
    ]);

    expect(kinds.filter((kind) => kind === 'allow')).toEqual([]);
  });
});

describe('kill-guard: a variable the command assigns', () => {
  // The command a developer agent ran past the guard on 2026-10-14 (help-flows).
  it('still denies a write through it', () => {
    expect(
      decide(
        `f=src/navigation/title-measurer/title-measurer.component.test.tsx && sed -i '' "s/a/b/g" $f`,
      ),
    ).toBe('shellWrite');
  });
});
