#!/usr/bin/env node

// PreToolUse guard for the Bash tool: denies pkill/killall, a kill/pkill/
// killall reached through a pattern (xargs, $(...), a `-c` string), and a
// process-group/broadcast kill (a negative pid, pid 0, or a bare `-1`
// signal-as-target). See CLAUDE.md's "Automatic wiring" note and
// `.claude/skills/kiko-linter/SKILL.md` for the check-wrapper contract this
// hook does NOT follow: it must ALWAYS exit 0, even on a crash or malformed
// payload, so it can never break the Bash tool itself. Wired from
// harness/kiko/hooks/hooks.json via scripts/checks/kill-guard.sh.
//
// Incident this guards against: a reviewer subagent ran
// `pkill -f "cat" -U <user>` to stop its own hung `cat`. The pattern matched
// every process with "cat" in its command line and restarted Orca helpers
// and the iOS Simulator.
//
// It also denies (user-approved, and it binds the user's own sessions too):
// any `git stash` subcommand in any directory, scratch clones included —
// after a scratch-clone stash slip — and a heredoc whose delimiter is not
// quoted (`<<EOF`, `<<-EOF`), after an unquoted heredoc ran backticked text
// in its body as commands and left a stuck process.

const KILL_REASON =
  'Blocked: pkill, killall, and pattern or process-group kills are banned in this repo ' +
  '(a pattern kill once restarted Orca and the iOS Simulator). Stop only a process ID you ' +
  'started yourself (kill <pid>), or let the tool timeout end a hung command.';

// The stash and heredoc denies use the WHAT/DETAILS/WHY/HOW/DO-NOT shape of
// `_lib.sh`'s `print_block`, as plain text inside the one JSON reason field.
const STASH_REASON_LINES = [
  'WHAT FAILED:    kill-guard denied a git stash command.',
  'WHY IT MATTERS: git stash is banned in every directory, scratch clones included, after a ' +
    "scratch-clone stash slip: a repository's stash stack is shared by every worktree and " +
    'session, so an entry is easy to pop, apply, or lose in the wrong place.',
  'HOW TO FIX:     commit a WIP commit on your own branch, or copy the files aside to your scratchpad.',
  'DO NOT:         route the stash through an alias, a script file, or a variable to get past this guard.',
];

const HEREDOC_REASON_LINES = [
  'WHAT FAILED:    kill-guard denied an unquoted heredoc delimiter.',
  'WHY IT MATTERS: an unquoted heredoc expands its body, so backticked text in it once ran as ' +
    'commands and left a stuck process.',
  "HOW TO FIX:     quote the delimiter — <<'EOF' (or <<\"EOF\", <<\\EOF, <<-'EOF') — so the body " +
    'stays literal text.',
  'DO NOT:         leave the delimiter unquoted to expand a variable in the body; build that text ' +
    'with printf, or write it to a scratchpad file with the Write tool.',
];

function blockReason(reasonLines, detail) {
  const [what, ...rest] = reasonLines;

  return [what, `DETAILS:        ${detail}`, ...rest].join('\n');
}

const REASON_BY_KIND = {
  kill: () => KILL_REASON,
  stash: (finding) => blockReason(STASH_REASON_LINES, finding.detail),
  heredoc: (finding) => blockReason(HEREDOC_REASON_LINES, finding.detail),
};

const reasonFor = (finding) => REASON_BY_KIND[finding.kind](finding);

const denyJson = (reason) =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });

// ---- matchDelimited: find the close matching an already-consumed open ----

// An unquoted `#` that starts a word comments out the rest of its line —
// quotes in it included, so an apostrophe there must not open a string that
// hides every later line. Skips to (not past) the newline, which still ends
// the command.
function skipComment(state) {
  const newline = state.text.indexOf('\n', state.i);
  state.i = newline === -1 ? state.text.length : newline;
}

// A `#` after one of these starts a word (`a#b`, `${#x}`, and `$#` are not
// comments).
const WORD_BOUNDARY = /[\s;&|(]/;

function stepQuoteInDelimited(state) {
  const c = state.text[state.i];
  if (state.quote === '"' && c === '\\' && state.i + 1 < state.text.length) {
    state.i += 2;
    return;
  }
  if (c === state.quote) state.quote = null;
  state.i++;
}

// Only a `(` span honors a comment: bash finds a backtick's close before it
// parses the text inside.
function stepUnquotedInDelimited(state) {
  const c = state.text[state.i];
  if (state.open === '(' && c === '#' && state.wordStart) {
    skipComment(state);
    return;
  }
  state.wordStart = WORD_BOUNDARY.test(c);
  state.i++;
  if (c === "'" || c === '"') state.quote = c;
  else if (state.open && c === state.open) state.depth++;
  else if (c === state.close) state.depth--;
}

// Finds the character matching the one that opened at `start - 1` (a `(` or
// `[` after `$`, or a backtick), honoring nested quotes and nested
// parens or brackets. Returns the text between the delimiters and the index of the
// closing delimiter.
function matchDelimited(text, start, open, close) {
  const state = { text, i: start, quote: null, open, close, depth: 1, wordStart: true };
  while (state.i < text.length) {
    if (state.quote) {
      stepQuoteInDelimited(state);
      continue;
    }
    stepUnquotedInDelimited(state);
    if (state.depth === 0) return { content: text.slice(start, state.i - 1), end: state.i - 1 };
  }
  return { content: text.slice(start), end: text.length };
}

// ---- scanLevel: split one line into top-level simple commands ----

// Bash reads `$((…))` and `((…))` as arithmetic only when the paren that
// opens right after the first one closes right before the last one; else
// (`$((a) && (b))`) it is a subshell inside a command substitution. Its `<<`
// is a shift, not a heredoc, and only its own `$(...)`/backtick spans run.
function isArithmetic(content) {
  return content.startsWith('(') && matchDelimited(content, 1, '(', ')').end === content.length - 1;
}

function consumeSubshell(context, start, open, close) {
  const { content, end } = matchDelimited(context.text, start, open, close);
  if (open === '[' || (open === '(' && isArithmetic(content))) {
    context.nested.push(...scanLevel(content).nested);
  } else {
    context.nested.push(content);
  }
  context.buf += ' __SUBSHELL__ ';
  context.i = end + 1;
}

// A `((…))` arithmetic command at the start of a word.
function consumeArithmeticCommand(context) {
  const { text, i } = context;
  if (!text.startsWith('((', i)) return false;
  const { content, end } = matchDelimited(text, i + 1, '(', ')');
  if (!isArithmetic(content)) return false;
  context.nested.push(...scanLevel(content).nested);
  context.buf += ' __SUBSHELL__ ';
  context.i = end + 1;

  return true;
}

// A `$(...)`, `$[...]` (the old arithmetic form), or backtick span expands
// (and so is recursed into) both at top level and inside double quotes — the
// two callers that share this check.
function tryConsumeSubshell(context) {
  const { text, i } = context;
  const c = text[i];
  if (c === '$' && text[i + 1] === '(') {
    consumeSubshell(context, i + 2, '(', ')');
    return true;
  }
  if (c === '$' && text[i + 1] === '[') {
    consumeSubshell(context, i + 2, '[', ']');
    return true;
  }
  if (c === '`') {
    consumeSubshell(context, i + 1, null, '`');
    return true;
  }
  return false;
}

function stepSingleQuote(context) {
  const c = context.text[context.i];
  if (c === "'") context.quote = null;
  context.buf += c;
  context.i++;
}

function stepDoubleQuote(context) {
  const { text, i, n } = context;
  const c = text[i];
  if (c === '\\' && i + 1 < n) {
    context.buf += c + text[i + 1];
    context.i += 2;
    return;
  }
  if (c === '"') {
    context.quote = null;
    context.buf += c;
    context.i++;
    return;
  }
  if (tryConsumeSubshell(context)) return;
  context.buf += c;
  context.i++;
}

// Consumes an unquoted `;`, `&&`, `||`, `|`, `&`, or newline as a top-level
// segment separator. Returns false (and consumes nothing) for anything else.
function consumeSeparator(context) {
  const { text, i } = context;
  const c = text[i];
  const isAndAnd = c === '&' && text[i + 1] === '&';
  const isOrOr = c === '|' && text[i + 1] === '|';
  if (isAndAnd || isOrOr) {
    context.segments.push(context.buf);
    context.buf = '';
    context.i += 2;
    return true;
  }
  if (c === ';' || c === '\n' || c === '&' || c === '|') {
    context.segments.push(context.buf);
    context.buf = '';
    context.i += 1;
    return true;
  }
  return false;
}

// A delimiter word with a quote or backslash ANYWHERE in it (`'EOF'`,
// `"EOF"`, `\EOF`, `E"OF"`) keeps bash from expanding the body; any other
// word (`EOF`, `$X`, `1`, `.`) does not. An arithmetic shift never reaches
// here: `consumeSubshell` and `consumeArithmeticCommand` take `$((…))`,
// `$[…]`, and `((…))` whole.
const UNQUOTED_HEREDOC_DELIMITER = /^[^'"\\]+$/;

// Consumes a `<<`/`<<-` heredoc operator, recording the first one whose
// delimiter word is unquoted, or a `<<<` here-string (not a heredoc).
// Returns false (and consumes nothing) for anything else.
function consumeHeredocOperator(context) {
  const { text, i } = context;
  if (text[i] !== '<' || text[i + 1] !== '<') return false;
  const operator = ['<<<', '<<-', '<<'].find((candidate) => text.startsWith(candidate, i));
  if (operator !== '<<<' && context.heredoc === null) {
    const afterOperator = text.slice(i + operator.length).replace(/^[ \t]*/, '');
    const delimiter = afterOperator.match(/^[^\s;&|<>()]*/)[0];
    if (UNQUOTED_HEREDOC_DELIMITER.test(delimiter)) context.heredoc = `${operator}${delimiter}`;
  }
  context.buf += operator;
  context.i += operator.length;

  return true;
}

// Consumes what can only start a word: a `#` comment or a `((…))`
// arithmetic command. Returns false (and consumes nothing) otherwise.
function consumeAtWordStart(context) {
  if (!context.wordStart) return false;
  if (context.text[context.i] === '#') {
    skipComment(context);
    return true;
  }

  return consumeArithmeticCommand(context);
}

function stepTopLevel(context) {
  const { text, i, n } = context;
  const c = text[i];
  if (consumeAtWordStart(context)) return;
  if (consumeSeparator(context)) {
    context.wordStart = true;
    return;
  }
  context.wordStart = WORD_BOUNDARY.test(c);
  if (c === '\\' && i + 1 < n) {
    context.wordStart = false;
    context.buf += c + text[i + 1];
    context.i += 2;
    return;
  }
  if (c === "'" || c === '"') {
    context.quote = c;
    context.buf += c;
    context.i++;
    return;
  }
  if (tryConsumeSubshell(context)) return;
  if (consumeHeredocOperator(context)) return;
  context.buf += c;
  context.i++;
}

// Splits one line of shell text into top-level simple-command segments at
// an unquoted `;`, `&&`, `||`, `|`, `&`, or newline, and collects the text
// of every `$(...)` / backtick span found — at top level or inside double
// quotes, where the shell still expands them (NOT inside single quotes,
// where it never does) — for the caller to recurse into. A `#` comment is
// dropped. `heredoc` is the first top-level unquoted-delimiter heredoc
// operator, or null.
function scanLevel(text) {
  const context = {
    text,
    i: 0,
    n: text.length,
    buf: '',
    quote: null,
    segments: [],
    nested: [],
    heredoc: null,
    wordStart: true,
  };
  while (context.i < context.n) {
    if (context.quote === "'") {
      stepSingleQuote(context);
      continue;
    }
    if (context.quote === '"') {
      stepDoubleQuote(context);
      continue;
    }
    stepTopLevel(context);
  }
  context.segments.push(context.buf);
  return { segments: context.segments, nested: context.nested, heredoc: context.heredoc };
}

// ---- words: word-split one simple command respecting quotes ----

function stepWordQuoted(context) {
  const c = context.segment[context.i];
  if (c === context.quote) {
    context.quote = null;
    context.i++;
    return;
  }
  if (context.quote === '"' && c === '\\' && context.i + 1 < context.segment.length) {
    context.cur += context.segment[context.i + 1];
    context.i += 2;
    return;
  }
  context.cur += c;
  context.i++;
}

function stepWordUnquoted(context) {
  const c = context.segment[context.i];
  if (c === "'" || c === '"') {
    context.quote = c;
    context.started = true;
    context.i++;
    return;
  }
  if (/\s/.test(c)) {
    if (context.started || context.cur !== '') context.out.push(context.cur);
    context.cur = '';
    context.started = false;
    context.i++;
    return;
  }
  if (c === '\\' && context.i + 1 < context.segment.length) {
    context.cur += context.segment[context.i + 1];
    context.i += 2;
    context.started = true;
    return;
  }
  context.cur += c;
  context.started = true;
  context.i++;
}

// Word-splits one simple-command segment respecting quotes (quotes group a
// word; they do not survive into the token's value).
function words(segment) {
  const context = { segment, i: 0, cur: '', quote: null, started: false, out: [] };
  while (context.i < context.segment.length) {
    if (context.quote) {
      stepWordQuoted(context);
      continue;
    }
    stepWordUnquoted(context);
  }
  if (context.started || context.cur !== '') context.out.push(context.cur);
  return context.out;
}

// ---- command-shape checks ----

const basename = (token) => (token || '').split('/').pop();

// `command -v pkill` only looks a name up, so these take no options here.
const PLAIN_PREFIXES = new Set(['nohup', 'command', 'exec']);

// Wrappers that run the command after their own options, each with the
// options that take their value as the NEXT word (`sudo -u me`, `nice -n 10`,
// `xargs -n 1`). `timeout` also takes a duration after its options.
const OPTION_WRAPPERS = new Map([
  [
    'sudo',
    new Set(['-C', '-D', '-g', '-p', '-R', '-r', '-T', '-t', '-U', '-u', '--user', '--group']),
  ],
  ['nice', new Set(['-n', '--adjustment'])],
  ['time', new Set()],
  ['env', new Set(['-C', '-u', '--chdir', '--unset'])],
  ['timeout', new Set(['-k', '-s', '--kill-after', '--signal'])],
  ['xargs', new Set(['-a', '-d', '-E', '-I', '-L', '-n', '-P', '-s'])],
]);

// Words that can stand before a command in its own position.
const RESERVED_WORDS = new Set(['!', 'if', 'then', 'elif', 'else', 'do', 'while', 'until']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
const GROUP_OPENERS = /^[({]+/;
const GROUP_CLOSERS = /[)}]+$/;

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
// `-c`, and any flag group that holds it (`-lc`, `-ec`, `-xc`).
const SHELL_COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

// The tokens after a command word and its leading options.
function skipOptions(tokens, optionsWithValue) {
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    i += optionsWithValue.has(tokens[i]) ? 2 : 1;
  }

  return tokens.slice(i);
}

// A group's `)` / `}` closes glued to (or after) the last word: `(pkill x)`
// splits into `(pkill` and `x)`.
function stripGroupClosers(tokens) {
  const t = [...tokens];
  while (t.length > 0 && GROUP_CLOSERS.test(t[t.length - 1])) {
    const last = t.pop().replace(GROUP_CLOSERS, '');
    if (last !== '') return [...t, last];
  }

  return t;
}

// Whether the word in command position only leads into the real command: a
// group opener, a reserved word, a `NAME=value` assignment, or a plain prefix.
const isLeadIn = (word) =>
  word === '' ||
  RESERVED_WORDS.has(word) ||
  ASSIGNMENT.test(word) ||
  PLAIN_PREFIXES.has(basename(word));

// Strips every lead-in and wrapper command (`sudo -u me`, `env`, `nice -n 10`,
// `time -p`, `timeout N`, `xargs`, ...) so the checks below see the command
// actually being run. Returns the remaining tokens and whether an `xargs`
// wrapper was stripped: a `kill`/`pkill`/`killall` reached through `xargs`
// takes its targets from the piped-in input — from a pattern, by
// construction — so it is denied unconditionally regardless of any static
// args that follow it.
function unwrap(tokens) {
  let viaXargs = false;
  let t = stripGroupClosers(tokens);
  while (t.length > 0) {
    const word = t[0].replace(GROUP_OPENERS, '');
    const base = basename(word);
    if (isLeadIn(word)) {
      t = t.slice(1);
      continue;
    }
    if (!OPTION_WRAPPERS.has(base)) return { tokens: [word, ...t.slice(1)], viaXargs };
    viaXargs = viaXargs || base === 'xargs';
    t = skipOptions(t, OPTION_WRAPPERS.get(base));
    if (base === 'timeout') t = t.slice(1);
  }

  return { tokens: t, viaXargs };
}

// `kill` parses at most one leading signal specifier — `-s SIG`, `-N`,
// `-SIGNAME`, or the `--` end-of-options marker — and every token after that
// is a target, even one that starts with `-` (a negative pid / process
// group). This mirrors how kill(1) itself only ever accepts one signal spec,
// before the pid list.
function killTargets(tokens) {
  let i = 0;
  if (tokens[0] === '--') {
    i = 1;
  } else if (tokens[0] === '-s' || tokens[0] === '-signal') {
    i = 2;
  } else if (/^-[A-Za-z0-9]+$/.test(tokens[0] || '')) {
    i = 1;
  }
  return tokens.slice(i);
}

// A target is safe only when it is a plain positive pid, a shell variable
// the agent's own script set (`$PID`, `"$pid"`, `${pid}` — the agent is
// presumably stopping a process it started itself), or a job-control spec
// (`%1` — the caller's own shell job, not a pattern match on other
// processes). Everything else — a name, a glob, 0, a negative pid, or the
// `__SUBSHELL__` placeholder standing in for a `$(...)`/backtick whose
// targets come from a live pattern match — is dangerous.
function isDangerousKillTarget(target) {
  if (/^\$[A-Za-z_{]/.test(target)) return false;
  if (/^%/.test(target)) return false;
  if (/^-?\d+$/.test(target)) return Number(target) <= 0;
  return true;
}

// Global options that take their value as the NEXT word (`-C <dir>`,
// `--git-dir <dir>`); the `--git-dir=<dir>` spelling is one word and needs
// no entry here.
const GIT_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--super-prefix',
]);

// Returns the finding for one simple command — `{ kind: 'kill' }` or
// `{ kind: 'stash', detail }` — or null when it is safe. A shell's `-c`
// string and `eval`'s joined arguments go to `nested` as command text.
function segmentFinding(segment, nested) {
  const tokens = words(segment);
  if (tokens.length === 0) return null;

  const { tokens: rest, viaXargs } = unwrap(tokens);
  if (rest.length === 0) return null;
  const base = basename(rest[0]);

  if (SHELLS.has(base)) {
    const flagIndex = rest.findIndex((token, index) => index > 0 && SHELL_COMMAND_FLAG.test(token));
    if (flagIndex !== -1 && flagIndex + 1 < rest.length) nested.push(rest[flagIndex + 1]);
    return null;
  }

  if (base === 'eval') {
    nested.push(rest.slice(1).join(' '));
    return null;
  }

  if (base === 'pkill' || base === 'killall') return { kind: 'kill' };

  if (base === 'kill') {
    const isPatternKill = viaXargs || killTargets(rest.slice(1)).some(isDangerousKillTarget);

    return isPatternKill ? { kind: 'kill' } : null;
  }

  if (base === 'git' && skipOptions(rest, GIT_OPTIONS_WITH_VALUE)[0] === 'stash') {
    return { kind: 'stash', detail: segment.trim() };
  }

  return null;
}

// Scans one full line of shell text (recursing into `$(...)`, backticks, a
// `-c` argument to `sh`/`bash`/`zsh`/`dash`, and an `eval` string) and
// returns the first finding anywhere in it, or null.
function findDanger(line, depth) {
  if (depth > 8) return null; // guards against pathological nesting
  const { segments, nested, heredoc } = scanLevel(line);

  for (const segment of segments) {
    const finding = segmentFinding(segment, nested);
    if (finding !== null) return finding;
  }
  if (heredoc !== null) return { kind: 'heredoc', detail: heredoc };
  for (const nestedLine of nested) {
    const finding = findDanger(nestedLine, depth + 1);
    if (finding !== null) return finding;
  }

  return null;
}

// ---- hook entry point ----

function main(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed input: allow, silently
  }
  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || command.trim() === '') return;

  const finding = findDanger(command, 0);
  if (finding !== null) process.stdout.write(denyJson(reasonFor(finding)));
}

try {
  const raw = require('node:fs').readFileSync(0, 'utf8');
  main(raw);
} catch {
  // Never break the Bash tool: any unexpected failure here falls through to
  // the unconditional exit 0 below with no output, i.e. allow.
}
process.exit(0);
