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
//
// And it denies a `git apply`, `git merge`, or `git rebase` whose target is
// the main checkout (the payload's cwd, a `cd` earlier in the command, or
// git's `-C`/`--git-dir`/`--work-tree`): the hooks' dispatcher runs from
// there, so a conflict marker in it once broke every hook in every session.

const path = require('node:path');

const MAIN_CHECKOUT_PATH = '/Users/drizzer14/Developer/Projects/pff-ios';

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

const MAIN_CHECKOUT_REASON_LINES = [
  'WHAT FAILED:    kill-guard denied a git apply, merge, or rebase on the main checkout.',
  `WHY IT MATTERS: the hooks of every session run from the main checkout (${MAIN_CHECKOUT_PATH}), ` +
    'so a conflict marker there breaks every hook in every session.',
  'HOW TO FIX:     do the apply, merge, or rebase in a worktree; the coordinator owns the main checkout.',
  'DO NOT:         reach the main checkout through a script file, an alias, or a variable to get past this guard.',
];

function blockReason(reasonLines, detail) {
  const [what, ...rest] = reasonLines;

  return [what, `DETAILS:        ${detail}`, ...rest].join('\n');
}

const REASON_BY_KIND = {
  kill: () => KILL_REASON,
  stash: (finding) => blockReason(STASH_REASON_LINES, finding.detail),
  heredoc: (finding) => blockReason(HEREDOC_REASON_LINES, finding.detail),
  mainCheckout: (finding) => blockReason(MAIN_CHECKOUT_REASON_LINES, finding.detail),
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

// ---- pieces both scanners share ----

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
const WORD_BOUNDARY = /[\s;&|()]/;

// A `#` inside `${…}` (`${x/ #/}`) is part of the expansion, never a comment.
function trackParameterBraces(state, c) {
  if (c === '$' && state.text[state.i + 1] === '{') state.braceDepth++;
  else if (c === '}' && state.braceDepth > 0) state.braceDepth--;
}

// ---- heredocs: a body is data for its command, not shell text ----

const HEREDOC_WORD = /^(?:'[^']*'|"(?:\\.|[^"\\])*"|\\.|[^\s;&|<>()'"\\])*/;
// bash and zsh end a `<<$'EOF'` or `<<$"EOF"` body at the line `EOF`, so a
// `$` before a quote goes with the quotes.
const QUOTED_PART = /\$?'([^']*)'|\$?"((?:\\.|[^"\\])*)"|\\(.)/g;
// Inside double quotes a backslash escapes only these; before any other
// character it stays.
const DOUBLE_QUOTED_ESCAPE = /\\(["\\$`])/g;

function removeQuote(_match, single, double, escaped) {
  if (double !== undefined) return double.replace(DOUBLE_QUOTED_ESCAPE, '$1');

  return single ?? escaped;
}

// The word after `<<`/`<<-`: its raw text, and the delimiter line that ends
// the body (the word with its quotes removed).
function readHeredocWord(text, start) {
  const leading = text.slice(start).match(/^[ \t]*/)[0].length;
  const raw = text.slice(start + leading).match(HEREDOC_WORD)[0];
  const delimiter = raw.replace(QUOTED_PART, removeQuote);

  return { raw, delimiter, end: start + leading + raw.length };
}

// Reads a `<<`, `<<-`, or `<<<` operator at `i` (a `<<<` here-string has no
// body), or returns null.
function readHeredocOperator(text, i) {
  if (!text.startsWith('<<', i)) return null;
  const symbol = ['<<<', '<<-', '<<'].find((candidate) => text.startsWith(candidate, i));
  if (symbol === '<<<') return { symbol, raw: '', delimiter: '', end: i + symbol.length };

  return { symbol, ...readHeredocWord(text, i + symbol.length) };
}

// A heredoc's body starts on the line after its operator's line.
function queueHeredoc(state, operator, segmentIndex) {
  if (operator.raw === '') return;
  state.pending.push({
    delimiter: operator.delimiter,
    stripTabs: operator.symbol === '<<-',
    segmentIndex,
  });
}

// One body starting at `start`: every line up to the one that equals the
// delimiter (after its leading tabs, for `<<-`). Null when no line does.
function readHeredocBody(text, start, heredoc) {
  let lineStart = start;
  while (lineStart <= text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd);
    if ((heredoc.stripTabs ? line.replace(/^\t+/, '') : line) === heredoc.delimiter) {
      return {
        body: text.slice(start, lineStart),
        end: newline === -1 ? text.length : newline + 1,
      };
    }
    lineStart = lineEnd + 1;
  }

  return null;
}

// Moves past the bodies queued on the line that just ended, handing each to
// `onBody`. A body with no delimiter line ends the skip and the rest is
// scanned as shell: bash would read it all as that body, so this only ever
// over-denies (fail closed).
function skipHeredocBodies(state, onBody) {
  for (const heredoc of state.pending) {
    const found = readHeredocBody(state.text, state.i, heredoc);
    if (found === null) break;
    onBody(heredoc, found.body);
    state.i = found.end;
  }
  state.pending = [];
}

// ---- matchDelimited: find the close matching an already-consumed open ----

function stepQuoteInDelimited(state) {
  const c = state.text[state.i];
  if (state.quote === '"' && c === '\\' && state.i + 1 < state.text.length) {
    state.i += 2;
    return;
  }
  if (c === state.quote) state.quote = null;
  state.i++;
}

// Takes a heredoc operator and, at the newline that ends its line, the body
// it queued, so body text never counts as a quote, a paren, or a comment.
// Returns false (consuming nothing) for anything else.
function skipHeredocInDelimited(state) {
  if (state.text[state.i] === '\n' && state.pending.length > 0) {
    state.i++;
    skipHeredocBodies(state, () => {});
    state.wordStart = true;
    return true;
  }
  const operator = readHeredocOperator(state.text, state.i);
  if (operator === null) return false;
  queueHeredoc(state, operator);
  state.i = operator.end;
  state.wordStart = false;

  return true;
}

function stepUnquotedInDelimited(state) {
  if (skipHeredocInDelimited(state)) return;
  const c = state.text[state.i];
  if (c === '#' && state.wordStart) {
    skipComment(state);
    return;
  }
  trackParameterBraces(state, c);
  state.wordStart = state.braceDepth === 0 && WORD_BOUNDARY.test(c);
  state.i++;
  if (c === "'" || c === '"') state.quote = c;
  else if (c === state.open) state.depth++;
  else if (c === state.close) state.depth--;
}

// Finds the character matching the `(` or `[` that opened at `start - 1`,
// honoring nested quotes, parens or brackets, comments, `${…}`, and heredoc
// bodies. Returns the text between the delimiters and the index of the
// closing delimiter.
function matchDelimited(text, start, open, close) {
  const state = {
    text,
    i: start,
    quote: null,
    open,
    close,
    depth: 1,
    wordStart: true,
    braceDepth: 0,
    pending: [],
  };
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

// bash ends a backtick span at the first backtick no backslash escapes;
// quotes inside do not hide it (`echo it's`).
function matchBacktick(text, start) {
  let i = start;
  while (i < text.length && text[i] !== '`') i += text[i] === '\\' ? 2 : 1;
  const end = Math.min(i, text.length);

  return { content: text.slice(start, end), end };
}

// ---- scanLevel: split one line into top-level simple commands ----

// Bash reads `$((…))` and `((…))` as arithmetic only when the paren that
// opens right after the first one closes right before the last one; else
// (`$((a) && (b))`) it is a subshell inside a command substitution. Its `<<`
// is a shift, not a heredoc, and only its own `$(...)`/backtick spans run.
function isArithmetic(content) {
  return content.startsWith('(') && matchDelimited(content, 1, '(', ')').end === content.length - 1;
}

// Each nested span records the segment it appears in, so it runs in that
// segment's directory.
function consumeSubshell(context, match, arithmetic) {
  const segmentIndex = context.segments.length;
  const texts = arithmetic
    ? scanLevel(match.content).nested.map((entry) => entry.text)
    : [match.content];
  context.nested.push(...texts.map((text) => ({ text, segmentIndex })));
  context.buf += ' __SUBSHELL__ ';
  context.i = match.end + 1;
}

// A `((…))` arithmetic command at the start of a word.
function consumeArithmeticCommand(context) {
  const { text, i } = context;
  if (!text.startsWith('((', i)) return false;
  const match = matchDelimited(text, i + 1, '(', ')');
  if (!isArithmetic(match.content)) return false;
  consumeSubshell(context, match, true);

  return true;
}

// A `$(...)`, `$[...]` (the old arithmetic form), or backtick span expands
// (and so is recursed into) both at top level and inside double quotes — the
// two callers that share this check.
function tryConsumeSubshell(context) {
  const { text, i } = context;
  if (text.startsWith('$(', i)) {
    const match = matchDelimited(text, i + 2, '(', ')');
    consumeSubshell(context, match, isArithmetic(match.content));
    return true;
  }
  if (text.startsWith('$[', i)) {
    consumeSubshell(context, matchDelimited(text, i + 2, '[', ']'), true);
    return true;
  }
  if (text[i] === '`') {
    consumeSubshell(context, matchBacktick(text, i + 1), false);
    return true;
  }
  return false;
}

// A `<(...)` / `>(...)` process substitution runs its command too.
function tryConsumeProcessSubstitution(context) {
  const { text, i } = context;
  if (!text.startsWith('<(', i) && !text.startsWith('>(', i)) return false;
  consumeSubshell(context, matchDelimited(text, i + 2, '(', ')'), false);

  return true;
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

function endSegment(context, length, closesSubshell = false) {
  context.segments.push(context.buf);
  context.opens.push(context.segmentOpens);
  context.closes.push(closesSubshell);
  context.buf = '';
  context.segmentOpens = 0;
  context.i += length;
  context.wordStart = true;
}

// What can stand before a subshell's `(`: nothing, a `(`/`{` group opener,
// `!`, or a reserved word. A `(` anywhere else (`ls (a|b)`, `=~ (a)`) is a
// glob or regex group, and a `#` after its `)` is not a comment.
const COMMAND_POSITION = /^(?:\s|[({!]|(?:if|then|elif|else|do|while|until)(?=\s))*$/;

function openParen(context, atWordStart) {
  const subshell = atWordStart && !context.inDoubleBracket && COMMAND_POSITION.test(context.buf);
  context.parens.push(subshell);
  if (subshell) context.segmentOpens++;
}

// Inside `[[ … ]]` a `(` is a pattern group, even after a `|` there splits
// the segment.
function trackDoubleBracket(context, atWordStart) {
  const { text, i } = context;
  if (!atWordStart) return;
  if (context.inDoubleBracket) {
    if (text.startsWith(']]', i)) context.inDoubleBracket = false;
  } else if (/^\[\[\s/.test(text.slice(i, i + 3)) && COMMAND_POSITION.test(context.buf)) {
    context.inDoubleBracket = true;
  }
}

// Consumes an unquoted `;`, `&&`, `||`, `|`, `&`, a `)`, or a newline — after
// which the bodies of the heredocs its line opened are taken aside — as a
// top-level segment separator. Returns false (and consumes nothing) for
// anything else.
function consumeSeparator(context) {
  const { text, i } = context;
  const c = text[i];
  if (text.startsWith('&&', i) || text.startsWith('||', i)) {
    endSegment(context, 2);
    return true;
  }
  if (c === '\n') {
    endSegment(context, 1);
    skipHeredocBodies(context, (heredoc, body) => {
      context.bodies.push({ segmentIndex: heredoc.segmentIndex, text: body });
    });
    return true;
  }
  if (c === ')' && context.braceDepth === 0) {
    const closesSubshell = context.parens.pop() === true;
    endSegment(context, 1, closesSubshell);
    context.wordStart = closesSubshell;
    return true;
  }
  if (';&|'.includes(c)) {
    endSegment(context, 1);
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

// Consumes a `<<`/`<<-` heredoc operator and its word, recording the first
// one whose delimiter word is unquoted and queueing its body, or a `<<<`
// here-string. Returns false (and consumes nothing) for anything else.
function consumeHeredocOperator(context) {
  const operator = readHeredocOperator(context.text, context.i);
  if (operator === null) return false;
  if (context.heredoc === null && UNQUOTED_HEREDOC_DELIMITER.test(operator.raw)) {
    context.heredoc = `${operator.symbol}${operator.raw}`;
  }
  queueHeredoc(context, operator, context.segments.length);
  context.buf += context.text.slice(context.i, operator.end);
  context.i = operator.end;

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
  const atWordStart = context.wordStart;
  if (consumeAtWordStart(context)) return;
  if (consumeSeparator(context)) return;
  trackDoubleBracket(context, atWordStart);
  trackParameterBraces(context, c);
  context.wordStart = context.braceDepth === 0 && WORD_BOUNDARY.test(c);
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
  if (tryConsumeSubshell(context) || tryConsumeProcessSubstitution(context)) return;
  if (consumeHeredocOperator(context)) return;
  if (c === '(' && context.braceDepth === 0) openParen(context, atWordStart);
  context.buf += c;
  context.i++;
}

// Splits one line of shell text into top-level simple-command segments at
// an unquoted `;`, `&&`, `||`, `|`, `&`, `)`, or newline, and collects the
// text of every `$(...)` / backtick span found — at top level or inside
// double quotes, where the shell still expands them (NOT inside single
// quotes, where it never does) — for the caller to recurse into. A `#`
// comment is dropped. A heredoc body is never part of a segment: `bodies`
// holds each one with the index of the segment that reads it. `heredoc` is
// the first top-level unquoted-delimiter heredoc operator, or null. Per
// segment, `opens` counts the subshells it opens and `closes` says whether
// its `)` closed one, so a `cd` inside a subshell stays inside it.
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
    braceDepth: 0,
    pending: [],
    bodies: [],
    parens: [],
    inDoubleBracket: false,
    segmentOpens: 0,
    opens: [],
    closes: [],
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
  endSegment(context, 0);
  return {
    segments: context.segments,
    nested: context.nested,
    heredoc: context.heredoc,
    bodies: context.bodies,
    opens: context.opens,
    closes: context.closes,
  };
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
  // A backslash-newline is a line continuation: the shell drops both, so
  // `a |\` then `pkill x` on the next line runs pkill.
  if (c === '\\' && context.segment[context.i + 1] === '\n') {
    context.i += 2;
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

const PLAIN_PREFIXES = new Set(['nohup', 'builtin']);

// Wrappers that run the command after their own options, each with the
// options that take their value as the NEXT word (`sudo -u me`, `nice -n 10`,
// `xargs -n 1`, `exec -a name`). `timeout` also takes a duration after its
// options.
const OPTION_WRAPPERS = new Map([
  ['exec', new Set(['-a'])],
  [
    'sudo',
    new Set(['-C', '-D', '-g', '-p', '-R', '-r', '-T', '-t', '-U', '-u', '--user', '--group']),
  ],
  ['nice', new Set(['-n', '--adjustment'])],
  ['time', new Set()],
  ['env', new Set(['-C', '-u', '--chdir', '--unset'])],
  ['timeout', new Set(['-k', '-s', '--kill-after', '--signal'])],
  ['xargs', new Set(['-a', '-d', '-E', '-I', '-J', '-L', '-n', '-P', '-R', '-S', '-s'])],
]);

// `env -S 'a b'` splits its one word into the command line.
const SPLIT_STRING_OPTIONS = new Set(['-S', '--split-string']);

// Words that can stand before a command in its own position.
const RESERVED_WORDS = new Set(['!', 'if', 'then', 'elif', 'else', 'do', 'while', 'until']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
const GROUP_OPENERS = /^[({]+/;

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
// `-c`, and any flag group that holds it (`-lc`, `-ec`, `-xc`).
const SHELL_COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

// Whether an option takes its value as the NEXT word: a listed option, or a
// flag group whose first value-taking letter comes last (`sudo -iu me`, as
// getopt reads it; in `-uroot` the value is glued on).
function takesNextWord(option, optionsWithValue) {
  if (optionsWithValue.has(option)) return true;
  if (!/^-[A-Za-z0-9]{2,}$/.test(option)) return false;
  const letters = [...option.slice(1)];

  return letters.findIndex((letter) => optionsWithValue.has(`-${letter}`)) === letters.length - 1;
}

// The tokens after a command word and its leading options.
function skipOptions(tokens, optionsWithValue) {
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    i += takesNextWord(tokens[i], optionsWithValue) ? 2 : 1;
  }

  return tokens.slice(i);
}

// Whether the word in command position only leads into the real command: a
// group opener, a reserved word, a `NAME=value` assignment, an end-of-options
// `--`, or a plain prefix.
const isLeadIn = (word) =>
  word === '' ||
  word === '--' ||
  RESERVED_WORDS.has(word) ||
  ASSIGNMENT.test(word) ||
  PLAIN_PREFIXES.has(basename(word));

// Wrappers whose next words need more than an options skip: `command -p`
// runs its command while `command -v`/`-V` only looks a name up, and
// `env -S` carries the whole command line in one word. Null for any other.
function unwrapSpecial(base, t) {
  if (base === 'command') return t.slice(t[1] === '-p' ? 2 : 1);
  if (base === 'env' && SPLIT_STRING_OPTIONS.has(t[1])) {
    return [...words(t[2] || ''), ...t.slice(3)];
  }

  return null;
}

// Strips every lead-in and wrapper command (`sudo -u me`, `env`, `nice -n 10`,
// `time -p`, `timeout N`, `xargs`, ...) so the checks below see the command
// actually being run. Returns the remaining tokens and whether an `xargs`
// wrapper was stripped: a `kill`/`pkill`/`killall` reached through `xargs`
// takes its targets from the piped-in input — from a pattern, by
// construction — so it is denied unconditionally regardless of any static
// args that follow it.
function unwrap(tokens) {
  let viaXargs = false;
  let t = tokens;
  while (t.length > 0) {
    const word = t[0].replace(GROUP_OPENERS, '');
    const base = basename(word);
    const special = unwrapSpecial(base, t);
    if (special !== null) {
      t = special;
      continue;
    }
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

// The options that say where git runs and what it writes. `-C` stacks, and a
// relative `--git-dir`/`--work-tree` resolves from the last `-C`, as git
// reads them.
const GIT_PATH_OPTIONS = new Map([
  ['-C', 'directory'],
  ['--git-dir', 'gitDirectory'],
  ['--work-tree', 'workTree'],
]);

const MAIN_CHECKOUT_SUBCOMMANDS = new Set(['apply', 'merge', 'rebase']);
const HELP_OPTIONS = new Set(['-h', '--help']);

// A path that needs the shell to expand it (`~`, `$X`, a glob, a `$(...)`)
// cannot be pinned down from the text.
const UNRESOLVED_PATH = /^~|[$`*?[]|__SUBSHELL__/;

// The normalized absolute path `target` names from `directory`, or null when
// the text alone cannot tell.
function resolveDirectory(directory, target) {
  if (UNRESOLVED_PATH.test(target)) return null;
  if (path.isAbsolute(target)) return path.resolve(target);
  if (directory === null) return null;

  return path.resolve(directory, target);
}

const isInsideMainCheckout = (directory) =>
  directory !== null &&
  (directory === MAIN_CHECKOUT_PATH || directory.startsWith(`${MAIN_CHECKOUT_PATH}/`));

function applyGitOption(invocation, option, next) {
  const equals = option.indexOf('=');
  const name = equals === -1 ? option : option.slice(0, equals);
  const value = equals === -1 ? next : option.slice(equals + 1);
  const field = GIT_PATH_OPTIONS.get(name);
  if (field === undefined || value === undefined) return;
  if (field === 'directory') invocation.directory = resolveDirectory(invocation.directory, value);
  else invocation[field] = value;
}

// The subcommand after git's global options, its arguments, and the two
// places it writes: its work tree and its git directory.
function gitInvocation(rest, directory) {
  const invocation = { directory };
  let i = 1;
  while (i < rest.length && rest[i].startsWith('-')) {
    const takesValue = takesNextWord(rest[i], GIT_OPTIONS_WITH_VALUE);
    applyGitOption(invocation, rest[i], takesValue ? rest[i + 1] : undefined);
    i += takesValue ? 2 : 1;
  }
  const locate = (raw) =>
    raw === undefined ? invocation.directory : resolveDirectory(invocation.directory, raw);

  return {
    subcommand: rest[i],
    arguments: rest.slice(i + 1),
    targets: [locate(invocation.workTree), locate(invocation.gitDirectory)],
  };
}

function gitFinding(segment, git) {
  if (git.subcommand === 'stash') return { kind: 'stash', detail: segment.trim() };
  if (!MAIN_CHECKOUT_SUBCOMMANDS.has(git.subcommand)) return null;
  if (git.arguments.some((argument) => HELP_OPTIONS.has(argument))) return null;
  const target = git.targets.find(isInsideMainCheckout);
  if (target === undefined) return null;

  return { kind: 'mainCheckout', detail: `${segment.trim()} (runs in ${target})` };
}

const DIRECTORY_CHANGERS = new Set(['cd', 'pushd']);

// Where the shell stands after one segment: `cd`/`pushd` moves it, `cd -`
// goes back, and a bare `cd` goes home, which is never the main checkout.
function moveDirectory(location, segment) {
  const { tokens } = unwrap(words(segment));
  if (tokens.length === 0 || !DIRECTORY_CHANGERS.has(basename(tokens[0]))) return;
  const target = tokens.slice(1).find((token) => token === '-' || !token.startsWith('-'));
  let next = null;
  if (target === '-') next = location.previous;
  else if (target !== undefined) next = resolveDirectory(location.directory, target);
  location.previous = location.directory;
  location.directory = next;
}

// A subshell's `cd` ends with the subshell.
function enterSubshells(location, count) {
  for (let open = 0; open < count; open++) {
    location.saved.push([location.directory, location.previous]);
  }
}

function leaveSubshell(location) {
  if (location.saved.length === 0) return;
  [location.directory, location.previous] = location.saved.pop();
}

// A shell runs its `-c` string or, without `-c`, the heredoc bodies it reads
// as its script.
function queueShellScript(rest, nested, stdinBodies) {
  const flagIndex = rest.findIndex((token, index) => index > 0 && SHELL_COMMAND_FLAG.test(token));
  if (flagIndex === -1) nested.push(...stdinBodies);
  else if (flagIndex + 1 < rest.length) nested.push(rest[flagIndex + 1]);
}

// Returns the finding for one simple command — `{ kind: 'kill' }`, or
// `{ kind: 'stash' | 'mainCheckout', detail }` — or null when it is safe. A
// shell's script and `eval`'s joined arguments go to `nested` as command
// text. `directory` is where the command runs, or null when unknown.
function segmentFinding(segment, nested, stdinBodies, directory) {
  const tokens = words(segment);
  if (tokens.length === 0) return null;

  const { tokens: rest, viaXargs } = unwrap(tokens);
  if (rest.length === 0) return null;
  const base = basename(rest[0]);

  if (SHELLS.has(base)) {
    queueShellScript(rest, nested, stdinBodies);
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

  if (base === 'git') return gitFinding(segment, gitInvocation(rest, directory));

  return null;
}

function firstFinding(lines, depth, checkHeredoc) {
  for (const line of lines) {
    const finding = findDanger(line.text, depth + 1, checkHeredoc, line.directory);
    if (finding !== null) return finding;
  }

  return null;
}

// Scans one full line of shell text (recursing into `$(...)`, backticks, a
// `-c` argument to `sh`/`bash`/`zsh`/`dash`, an `eval` string, and heredoc
// bodies) and returns the first finding anywhere in it, or null. A heredoc
// body is never part of the command line around it, but a body can still be
// run (`bash <<'EOF'`, `eval "$(cat <<'EOF' …)"`, `ssh host <<'EOF'`), so
// each body is checked on its own for a kill or a git stash. Only a body a
// shell reads as its script is also checked for an unquoted heredoc; any
// other body is text, so a `<<word` in it is not an operator. `directory` is
// where the line starts; every nested line runs where its segment does.
function findDanger(line, depth, checkHeredoc = true, directory = null) {
  if (depth > 8) return null; // guards against pathological nesting
  const { segments, nested, heredoc, bodies, opens, closes } = scanLevel(line);
  const location = { directory, previous: null, saved: [] };
  const directoryAt = [];
  const scripts = [];

  for (const [index, segment] of segments.entries()) {
    enterSubshells(location, opens[index]);
    directoryAt.push(location.directory);
    const stdinBodies = bodies
      .filter((body) => body.segmentIndex === index)
      .map((body) => body.text);
    const segmentScripts = [];
    const finding = segmentFinding(segment, segmentScripts, stdinBodies, location.directory);
    if (finding !== null) return finding;
    scripts.push(...segmentScripts.map((text) => ({ text, directory: location.directory })));
    moveDirectory(location, segment);
    if (closes[index]) leaveSubshell(location);
  }
  if (checkHeredoc && heredoc !== null) return { kind: 'heredoc', detail: heredoc };

  const inItsDirectory = (entry) => ({
    text: entry.text,
    directory: directoryAt[entry.segmentIndex],
  });

  return (
    firstFinding([...nested.map(inItsDirectory), ...scripts], depth, checkHeredoc) ??
    firstFinding(bodies.map(inItsDirectory), depth, false)
  );
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
  const startDirectory =
    typeof payload.cwd === 'string' ? resolveDirectory(null, payload.cwd) : null;

  const finding = findDanger(command, 0, true, startDirectory);
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
