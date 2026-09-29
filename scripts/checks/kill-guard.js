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
// And it denies a `git apply`, `merge`, `rebase`, `pull`, `cherry-pick`,
// `revert`, or `am` whose target is the main checkout (the payload's cwd, a
// `cd` earlier in the command, git's `-C`/`--git-dir`/`--work-tree`, or a
// `GIT_DIR=`/`GIT_WORK_TREE=` prefix): the hooks' dispatcher runs from
// there, so a conflict marker in it once broke every hook in every session.
// A fast-forward-only update and the recovery options stay allowed.
//
// And it denies a shell write into `src/`, `__tests__/`, or `rules/` at the
// root of any worktree of this repository — `sed -i`, `perl -i`, a `>`/`>>`
// (or `>|`, `&>`, `<>`) redirect, `tee`, a python `-c` or node `-e` one-liner
// (or one fed by a heredoc) that opens a file for writing, and `find -exec`
// or `xargs` running an in-place edit — because the pre-write guard sees only
// Edit/Write/MultiEdit, so such a write lands unchecked. A heredoc body that
// no shell or interpreter runs is text, never checked for writes.
//
// Known limits: this guard stops ACCIDENTAL commands by cooperative agents.
// It is a heuristic tokenizer, not a shell parser and not an adversarial
// boundary: an exotic, obfuscated, or run-time-built form is a known limit,
// not a bug. The one accepted-limits list lives in
// `.claude/skills/kiko-linter/SKILL.md` (kill-guard entry, "Known limits").

const fs = require('node:fs');
const os = require('node:os');
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
  'WHAT FAILED:    kill-guard denied a git apply, merge, rebase, pull, cherry-pick, revert, or am ' +
    'on the main checkout.',
  `WHY IT MATTERS: the hooks of every session run from the main checkout (${MAIN_CHECKOUT_PATH}), ` +
    'so a conflict marker there breaks every hook in every session.',
  'HOW TO FIX:     do the real merge in a separate detached worktree, verify it, then ' +
    `\`git -C ${MAIN_CHECKOUT_PATH} merge --ff-only <sha>\`. To recover a stuck operation there, ` +
    '--abort, --quit, --skip, and --continue stay allowed.',
  'DO NOT:         reach the main checkout through a script file, an alias, or a variable to get past this guard.',
];

const SHELL_WRITE_REASON_LINES = [
  'WHAT FAILED:    kill-guard denied a shell write into src/, __tests__/, or rules/ of a worktree ' +
    'of this repository.',
  'WHY IT MATTERS: the pre-write guard (scripts/checks/pre-write-guard.sh) sees only the Edit, ' +
    'Write, and MultiEdit tools, so a file written by sed -i, perl -i, a > or >> redirect, tee, ' +
    'or a python or node one-liner lands unchecked; guard-replay only catches it at Stop, after ' +
    'the fact.',
  'HOW TO FIX:     use the Edit or Write tool for that file. Reading it, a redirect to /dev/null ' +
    'or to a path outside those trees (your scratchpad, /tmp), git, and a formatter or fixer ' +
    "writing on its own (npx biome check --write, the harness's import-order --write) stay allowed.",
  'DO NOT:         route the write through a variable, a script file, a shell fed by a pipe, or ' +
    'another tool (cp, mv, dd) to get past this guard.',
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
  shellWrite: (finding) => blockReason(SHELL_WRITE_REASON_LINES, finding.detail),
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
// A `$` before a single quote goes with the quotes in bash and zsh
// (`<<$'EOF'` ends at `EOF`). Before a double quote it does in bash only:
// zsh has no `$"…"` quoting, so there `<<$"EOF"` ends at `$EOF`.
const QUOTED_PART = /\$?'([^']*)'|\$?"((?:\\.|[^"\\])*)"|\\(.)/g;
// Inside double quotes a backslash escapes only these; before any other
// character it stays.
const DOUBLE_QUOTED_ESCAPE = /\\(["\\$`])/g;

function removeQuote(_match, single, double, escaped) {
  if (double !== undefined) return double.replace(DOUBLE_QUOTED_ESCAPE, '$1');

  return single ?? escaped;
}

const removeQuoteAsZsh = (match, ...parts) =>
  (match.startsWith('$"') ? '$' : '') + removeQuote(match, ...parts);

const QUOTE_REMOVAL_BY_READING = { bash: removeQuote, zsh: removeQuoteAsZsh };

// Which shell the current scan reads the text as, where bash and zsh differ:
// a `$"…"` delimiter, a redirect's descriptor, and zsh's `>!` operator.
// `decide` scans a command once per reading, because the same text runs
// different commands in each (a heredoc body in one is code in the other).
// A module-level setting, not a parameter, since every scanner below reads
// heredocs or redirects and none of them should carry it;
// `withShellReading` always restores it.
let shellReading = 'bash';

function withShellReading(reading, scan) {
  const outer = shellReading;
  shellReading = reading;
  try {
    return scan();
  } finally {
    shellReading = outer;
  }
}

// The word after `<<`/`<<-`: its raw text, and the delimiter line that ends
// the body (the word with its quotes removed, as the current reading does).
function readHeredocWord(text, start) {
  const leading = text.slice(start).match(/^[ \t]*/)[0].length;
  const raw = text.slice(start + leading).match(HEREDOC_WORD)[0];
  const delimiter = raw.replace(QUOTED_PART, QUOTE_REMOVAL_BY_READING[shellReading]);

  return { raw, delimiters: [delimiter], end: start + leading + raw.length };
}

// Reads a `<<`, `<<-`, or `<<<` operator at `i` (a `<<<` here-string has no
// body), or returns null.
function readHeredocOperator(text, i) {
  if (!text.startsWith('<<', i)) return null;
  const symbol = ['<<<', '<<-', '<<'].find((candidate) => text.startsWith(candidate, i));
  if (symbol === '<<<') return { symbol, raw: '', delimiters: [], end: i + symbol.length };

  return { symbol, ...readHeredocWord(text, i + symbol.length) };
}

// A heredoc's body starts on the line after its operator's line.
function queueHeredoc(state, operator, segmentIndex) {
  if (operator.raw === '') return;
  state.pending.push({
    delimiters: operator.delimiters,
    stripTabs: operator.symbol === '<<-',
    segmentIndex,
  });
}

// One body starting at `start`: every line up to the first one that equals
// the delimiter (after its leading tabs, for `<<-`). Null when no line does.
function readHeredocBody(text, start, heredoc) {
  let lineStart = start;
  while (lineStart <= text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd);
    if (heredoc.delimiters.includes(heredoc.stripTabs ? line.replace(/^\t+/, '') : line)) {
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

// Stands in a segment for a span's output.
const SUBSHELL_PLACEHOLDER = '__SUBSHELL__';

// Each nested span records the segment it appears in, so it runs in that
// segment's directory. The placeholder is a word of its own, except as the
// value of an assignment or option (`X=$(…)`), which it stays part of.
function consumeSubshell(context, match, arithmetic) {
  const segmentIndex = context.segments.length;
  const texts = arithmetic
    ? scanLevel(match.content).nested.map((entry) => entry.text)
    : [match.content];
  context.nested.push(...texts.map((text) => ({ text, segmentIndex })));
  context.buf += `${context.buf.endsWith('=') ? '' : ' '}${SUBSHELL_PLACEHOLDER} `;
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
  context.separators.push(context.text.slice(context.i, context.i + length));
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

// The `&` of a redirect (`2>&1`, `>&-`, `<&3`, `&>file`, `&>>file`) and the
// `|` of a clobbering one (`>|`, `2>|`, zsh's `>&|`) belong to the operator;
// they never end the command, send it to the background, or pipe it. Only an
// unquoted, unescaped `<` or `>` starts an operator (`redirectEnd`): after
// `\>`, a `|` still pipes and a `&` still backgrounds.
function isRedirectPart(context) {
  const { text, i } = context;
  if (text[i] === '|') return context.redirectEnd === i && text[i - 1] !== '<';

  return context.redirectEnd === i || text[i + 1] === '>';
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
  if (c === ';' || ('|&'.includes(c) && !isRedirectPart(context))) {
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
  if (c === '<' || c === '>' || (c === '&' && context.redirectEnd === i)) {
    context.redirectEnd = i + 1;
  }
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
    redirectEnd: -1,
    segmentOpens: 0,
    opens: [],
    closes: [],
    separators: [],
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
    separators: context.separators,
  };
}

// ---- words: word-split one simple command respecting quotes ----

// Ends the current word. The target of a redirect (`>/dev/null`,
// `2> log`, `<<'EOF'`) is not a word of the command, so it is kept aside
// with its operator (the shell-write check reads where it writes); a `<<<`
// here-string's target is kept apart, since a shell runs it as its script
// (`bash <<< "…"`).
function pushWord(context) {
  if (context.started || context.cur !== '') {
    if (context.redirectOperator === null) context.out.push(context.cur);
    else if (context.redirectOperator === '<<<') context.hereStrings.push(context.cur);
    else context.redirects.push({ operator: context.redirectOperator, target: context.cur });
    context.redirectOperator = null;
  }
  context.cur = '';
  context.started = false;
  context.literal = false;
}

// `>`, `>>`, `>|`, `>&`, `<`, `<<`, `<<<`, `<>`, `<&`, `&>`, `&>>`, and in zsh
// also the clobbering `>!`, `>>!`, `>&!`, `&>!` (`>!` in bash is `>` then a
// word `!`); the word after it (glued or not) is its target. `-` is never
// part of the operator, so `>&-` and `<<-EOF` read their target right.
const REDIRECT_OPERATOR_BY_READING = {
  bash: /&>>?|[<>][<>&|]*/y,
  zsh: /&>>?[|!]?|>>?&?[|!]|[<>][<>&|]*/y,
};

// The descriptor a redirect names: bash reads any number before the
// operator as one (`12>/dev/null`), zsh only a single digit (`kill 00>x`
// runs `kill 00`).
const DESCRIPTOR_BY_READING = { bash: /^\d+$/, zsh: /^\d$/ };

// An unquoted `<`, `>`, or `&>` starts a redirect: a descriptor just before
// it (after any `(`/`{` group opener) is part of the redirect (`2>&1`), any
// other text is a word of its own (`cd dir>/dev/null`, zsh's `kill 00>x`).
function tryStartRedirect(context) {
  const { segment, i } = context;
  if (segment[i] !== '<' && segment[i] !== '>' && segment[i] !== '&') return false;
  const pattern = REDIRECT_OPERATOR_BY_READING[shellReading];
  pattern.lastIndex = i;
  const operator = pattern.exec(segment);
  if (operator === null) return false;
  const opener = context.literal ? '' : (context.cur.match(GROUP_OPENERS)?.[0] ?? '');
  const descriptor = context.cur.slice(opener.length);
  if (!context.literal && DESCRIPTOR_BY_READING[shellReading].test(descriptor)) {
    context.cur = opener;
    context.started = false;
  }
  pushWord(context);
  context.i += operator[0].length;
  context.redirectOperator = operator[0];

  return true;
}

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
    context.literal = true;
    context.i++;
    return;
  }
  if (/\s/.test(c)) {
    pushWord(context);
    context.i++;
    return;
  }
  if (tryStartRedirect(context)) return;
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
    context.literal = true;
    return;
  }
  context.cur += c;
  context.started = true;
  context.i++;
}

// Word-splits one simple-command segment respecting quotes (quotes group a
// word; they do not survive into the token's value). Redirects and their
// targets are dropped, wherever they stand: `2>/dev/null pkill x` runs
// pkill, and `kill 1234 &>/dev/null` has one target. `hereStrings` holds
// the targets of its `<<<` redirects, `redirects` every other redirect's
// operator and target.
function tokenize(segment) {
  const context = {
    segment,
    i: 0,
    cur: '',
    quote: null,
    started: false,
    literal: false,
    redirectOperator: null,
    out: [],
    hereStrings: [],
    redirects: [],
  };
  while (context.i < context.segment.length) {
    if (context.quote) {
      stepWordQuoted(context);
      continue;
    }
    stepWordUnquoted(context);
  }
  pushWord(context);
  return { words: context.out, hereStrings: context.hereStrings, redirects: context.redirects };
}

const words = (segment) => tokenize(segment).words;

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
// args that follow it. `environment` holds the `NAME=value` prefixes it
// stripped (`GIT_DIR=…` changes where git writes).
function unwrap(tokens) {
  let viaXargs = false;
  const environment = {};
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
      recordAssignment(environment, word);
      t = t.slice(1);
      continue;
    }
    if (!OPTION_WRAPPERS.has(base)) {
      return { tokens: [word, ...t.slice(1)], viaXargs, environment };
    }
    viaXargs = viaXargs || base === 'xargs';
    t = skipOptions(t, OPTION_WRAPPERS.get(base));
    if (base === 'timeout') t = t.slice(1);
  }

  return { tokens: t, viaXargs, environment };
}

// A `NAME=value` prefix sets NAME for the command it leads into.
function recordAssignment(environment, word) {
  const assignment = word.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s);
  if (assignment !== null) environment[assignment[1]] = assignment[2];
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

const MAIN_CHECKOUT_SUBCOMMANDS = new Set([
  'apply',
  'merge',
  'rebase',
  'pull',
  'cherry-pick',
  'revert',
  'am',
]);
const HELP_OPTIONS = new Set(['-h', '--help']);
const RECOVERY_SUBCOMMANDS = new Set(['merge', 'rebase', 'cherry-pick', 'revert', 'am']);
const RECOVERY_OPTIONS = new Set([
  '--abort',
  '--quit',
  '--skip',
  '--continue',
  '--resolved',
  '--edit-todo',
  '--show-current-patch',
]);
const FAST_FORWARD_SUBCOMMANDS = new Set(['merge', 'pull']);
const APPLY_READ_ONLY_OPTIONS = new Set(['--check', '--stat', '--numstat', '--summary']);

// What the main checkout may still run: help, recovery from a stuck
// operation, an `apply` that only inspects, and the one update that cannot
// conflict — a fast-forward with no option but `--ff-only`, since a later
// `--no-ff` or `--rebase` would override it.
function leavesMainCheckoutSafe(git) {
  const { subcommand, arguments: parameters } = git;
  const has = (options) => parameters.some((parameter) => options.has(parameter));
  if (has(HELP_OPTIONS)) return true;
  if (RECOVERY_SUBCOMMANDS.has(subcommand) && has(RECOVERY_OPTIONS)) return true;
  if (subcommand === 'apply') {
    return has(APPLY_READ_ONLY_OPTIONS) && !parameters.includes('--apply');
  }

  return (
    FAST_FORWARD_SUBCOMMANDS.has(subcommand) &&
    parameters.includes('--ff-only') &&
    parameters.every((parameter) => parameter === '--ff-only' || !parameter.startsWith('-'))
  );
}

// `~`, `$HOME`, and `${HOME}` at the start of a path, as the shell expands them.
const HOME_PREFIX = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/;

// A path that needs the shell to expand anything else (`~user`, `$X`, a
// glob, a `$(...)`) cannot be pinned down from the text.
const UNRESOLVED_PATH = /^~|[$`*?[]|__SUBSHELL__/;

// The normalized absolute path `target` names from `directory`, or null when
// the text alone cannot tell.
function resolveDirectory(directory, target) {
  const expanded = target.replace(HOME_PREFIX, () => os.homedir());
  if (UNRESOLVED_PATH.test(expanded)) return null;
  if (path.isAbsolute(expanded)) return path.resolve(expanded);
  if (directory === null) return null;

  return path.resolve(directory, expanded);
}

// A Claude Code worktree nested at `<main>/.claude/worktrees/<name>` is a
// separate worktree, the very place a merge belongs — but only when
// `<name>/.git` exists; any other folder there is part of the main
// checkout's own repository.
function isNestedWorktree(directory, mainCheckoutPath) {
  const prefix = `${mainCheckoutPath}/.claude/worktrees/`;
  if (!directory.toLowerCase().startsWith(prefix.toLowerCase())) return false;
  const name = directory.slice(prefix.length).split('/')[0];

  return name !== '' && fs.existsSync(path.join(prefix, name, '.git'));
}

// APFS is case-insensitive, so `/users/…/PFF-IOS` is the same folder.
function isInsideMainCheckout(directory, mainCheckoutPath) {
  if (directory === null) return false;
  const folded = directory.toLowerCase();
  const main = mainCheckoutPath.toLowerCase();
  if (folded !== main && !folded.startsWith(`${main}/`)) return false;

  return !isNestedWorktree(directory, mainCheckoutPath);
}

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
// places it writes: its work tree and its git directory. A `GIT_DIR=` or
// `GIT_WORK_TREE=` prefix counts until an option overrides it, as in git.
function gitInvocation(rest, directory, environment) {
  const invocation = {
    directory,
    gitDirectory: environment.GIT_DIR,
    workTree: environment.GIT_WORK_TREE,
  };
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

// One invocation per directory the command may run in; the subcommand is
// the same in each.
function gitFinding(segment, invocations, rules) {
  const [git] = invocations;
  if (git.subcommand === 'stash') return { kind: 'stash', detail: segment.trim() };
  if (!MAIN_CHECKOUT_SUBCOMMANDS.has(git.subcommand) || leavesMainCheckoutSafe(git)) return null;
  const target = invocations
    .flatMap((invocation) => invocation.targets)
    .find((directory) => isInsideMainCheckout(directory, rules.mainCheckoutPath));
  if (target === undefined) return null;

  return { kind: 'mainCheckout', detail: `${segment.trim()} (runs in ${target})` };
}

// ---- shell writes into src/, __tests__/, and rules/ ----

// The folders, at the root of any worktree of this repository, that only
// Edit/Write may change: the pre-write guard sees no other tool.
const WRITE_GUARDED_TREES = new Set(['src', '__tests__', 'rules']);

// The repository whose worktrees count: the one this file lives in.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// The git directory every worktree of a repository shares: `<root>/.git`
// itself, or, for a linked worktree, what its `.git` file's `gitdir` names
// through `commondir`. Case-folded, since APFS folds case. Null when it
// cannot be read.
function gitCommonDirectory(root) {
  try {
    const entry = path.join(root, '.git');
    if (fs.statSync(entry).isDirectory()) return fs.realpathSync.native(entry).toLowerCase();
    const pointer = fs
      .readFileSync(entry, 'utf8')
      .match(/^gitdir:\s*(.+)$/m)[1]
      .trim();
    const gitDirectory = path.resolve(root, pointer);
    const commonFile = path.join(gitDirectory, 'commondir');
    const common = fs.existsSync(commonFile)
      ? path.resolve(gitDirectory, fs.readFileSync(commonFile, 'utf8').trim())
      : gitDirectory;

    return fs.realpathSync.native(common).toLowerCase();
  } catch {
    return null;
  }
}

// Whether `directory` is the root of a worktree of this repository. A `.git`
// whose repository cannot be read counts (fail closed).
function isProjectWorktree(directory, rules) {
  if (!fs.existsSync(path.join(directory, '.git'))) return false;
  const common = gitCommonDirectory(directory);

  return (
    common === null ||
    rules.projectCommonDirectory === null ||
    common === rules.projectCommonDirectory
  );
}

// Whether the absolute `target` lies inside a tree at the root of a worktree
// of this repository. APFS folds case, so `SRC/x` is `src/x`.
function isInsideGuardedTree(target, rules) {
  const segments = target.split('/');

  return segments.some(
    (segment, index) =>
      index > 0 &&
      index < segments.length - 1 &&
      WRITE_GUARDED_TREES.has(segment.toLowerCase()) &&
      isProjectWorktree(segments.slice(0, index).join('/') || '/', rules),
  );
}

// A path the text cannot pin down (a variable, a glob, a span, a relative
// path from an unknown directory) counts when any folder in it is named
// like a tree (fail closed).
function namesGuardedTree(target) {
  const segments = target.split('/');

  return segments.some(
    (segment, index) =>
      index < segments.length - 1 && WRITE_GUARDED_TREES.has(segment.toLowerCase()),
  );
}

// The first of `targets` that lands inside a tree from any directory the
// command may run in (resolved when the text allows), or null.
function firstGuardedPath(targets, directories, rules) {
  for (const target of targets) {
    for (const directory of directories) {
      const resolved = resolveDirectory(directory, target);
      if (resolved === null && namesGuardedTree(target)) return target;
      if (resolved !== null && isInsideGuardedTree(resolved, rules)) return resolved;
    }
  }

  return null;
}

// A redirect that opens its target for writing: any operator with a `>` in
// it (`>`, `>>`, `>|`, `&>`, `<>`, zsh's `>!`), except a `>&` that
// duplicates a descriptor (`2>&1`, `>&-`).
const isWritingRedirect = ({ operator, target }) =>
  operator.includes('>') && !(operator.endsWith('&') && /^(?:\d+|-)$/.test(target));

const isOptionWord = (word) => word.length > 1 && word.startsWith('-');

// Splits a command's words into its options (each read by `readOption`,
// which says how many following words it takes as `skip`) and its
// operands. `--` ends the options, and so does the first operand when
// `operandEndsOptions` (perl, where the rest is the script's).
function splitOptions(parameters, readOption, operandEndsOptions = false) {
  const options = [];
  const operands = [];
  let index = 0;
  while (index < parameters.length) {
    const word = parameters[index];
    if (word === '--' || (operandEndsOptions && !isOptionWord(word))) {
      operands.push(...parameters.slice(word === '--' ? index + 1 : index));
      break;
    }
    if (!isOptionWord(word)) {
      operands.push(word);
      index++;
      continue;
    }
    const option = readOption(word, parameters[index + 1]);
    options.push(option);
    index += 1 + (option.skip ?? 0);
  }

  return { options, operands };
}

// A BSD backup extension after a bare `-i`: empty (`-i ''`) or dotted.
const isBackupExtension = (word) => word === '' || (word ?? '').startsWith('.');

// One sed option word: whether it edits in place (`-i`, `-i.bak`, `-Ei`,
// `--in-place[=.bak]`) or supplies the script (`-e`, `-f`, `--expression`,
// `--file`), and how many next words it takes — the script's value, or
// BSD's backup extension after a bare `-i` (`-i ''`).
function readSedOption(word, next) {
  if (word.startsWith('--')) {
    const script = /^--(?:expression|file)(=)?/.exec(word);

    return {
      inPlace: word.startsWith('--in-place'),
      script: script !== null,
      skip: script !== null && script[1] === undefined ? 1 : 0,
    };
  }
  const letters = word.slice(1);
  const inPlaceAt = letters.indexOf('i');
  const scriptAt = (inPlaceAt === -1 ? letters : letters.slice(0, inPlaceAt)).search(/[ef]/);
  const scriptValueNext = scriptAt !== -1 && scriptAt === letters.length - 1;
  const extensionNext =
    scriptAt === -1 && inPlaceAt === letters.length - 1 && isBackupExtension(next);

  return {
    inPlace: inPlaceAt !== -1 && scriptAt === -1,
    script: scriptAt !== -1,
    skip: scriptValueNext || extensionNext ? 1 : 0,
  };
}

// Perl switches whose value is glued on (`-MFoo`, `-I dir`): nothing after
// them in the word is another switch.
const PERL_GLUED_VALUE = new Set([...'MmIxdDCFV']);

// One perl switch word: `-i` (any group holding it, `-pi.bak`) edits in
// place; `-e`/`-E` supplies the code, from the next word when it ends the
// group. Digits (`-0777`, `-l015`) belong to the switch before them.
function readPerlSwitches(word) {
  const letters = word.slice(1).replace(/\d+/g, '');
  for (const [at, letter] of [...letters].entries()) {
    if (letter === 'i') return { inPlace: true };
    if (letter === 'e' || letter === 'E') {
      return { code: true, skip: at === letters.length - 1 ? 1 : 0 };
    }
    if (PERL_GLUED_VALUE.has(letter)) return {};
  }

  return {};
}

// The files an in-place edit writes: every operand but the script, which
// is the first operand when no option supplied it.
function inPlaceFiles({ options, operands }, suppliesScript) {
  if (!options.some((option) => option.inPlace)) return null;

  return options.some(suppliesScript) ? operands : operands.slice(1);
}

const SED_COMMANDS = new Set(['sed', 'gsed']);

// The files a command writes (`sed -i`, `perl -i`, `tee`), or null when it
// is none of them or does not edit in place.
function writtenFiles(base, parameters) {
  if (SED_COMMANDS.has(base)) {
    return inPlaceFiles(splitOptions(parameters, readSedOption), (option) => option.script);
  }
  if (base === 'perl') {
    return inPlaceFiles(splitOptions(parameters, readPerlSwitches, true), (option) => option.code);
  }
  if (base === 'tee') return splitOptions(parameters, () => ({})).operands;

  return null;
}

const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);

// The commands `find … -exec <command> {} +` (or `\;`) runs on each file.
function findExecCommands(parameters) {
  const commands = [];
  let current = null;
  for (const word of parameters) {
    if (current === null) {
      if (FIND_EXEC.has(word)) current = [];
    } else if (word === ';' || word === '+') {
      commands.push(current);
      current = null;
    } else {
      current.push(word);
    }
  }

  return current === null ? commands : [...commands, current];
}

// The folders find starts from: the words before its first expression,
// after its `-H`/`-L`/`-P` options; `.` when there are none.
function findStartPaths(parameters) {
  const rest = parameters.slice(parameters.findIndex((word) => !/^-[HLP]$/.test(word)));
  const end = rest.findIndex((word) => word.startsWith('-') || word === '(' || word === '!');
  const paths = end === -1 ? rest : rest.slice(0, end);

  return paths.length === 0 ? ['.'] : paths;
}

// A start folder that is the root of a worktree of this repository, where
// find reaches every tree in it.
function worktreeRootAt(start, directories, rules) {
  const roots = directories
    .map((directory) => resolveDirectory(directory, start))
    .filter((resolved) => resolved !== null && isProjectWorktree(resolved, rules));

  return roots[0] ?? null;
}

// Where `find … -exec` edits: a start folder inside a tree, or a worktree
// root, when one of its commands edits in place. Null otherwise.
function findWritePath(parameters, directories, rules) {
  const edits = findExecCommands(parameters).some(
    (command) =>
      command.length > 0 && writtenFiles(basename(command[0]), command.slice(1)) !== null,
  );
  if (!edits) return null;
  for (const start of findStartPaths(parameters)) {
    const where =
      firstGuardedPath([`${start}/{}`], directories, rules) ??
      worktreeRootAt(start, directories, rules);
    if (where !== null) return where;
  }

  return null;
}

// Reads the options of a python or node command up to its code: the `-c` /
// `-e` word, or, with no script file (or `-`), its stdin — a heredoc body
// or here-string. `readOption` names each option's kind: `code`, `module`
// (runs a module, not examined), `value` (takes the next word unless
// glued), or `flag`. Returns the code and the words after it (`sys.argv`,
// `process.argv`), or null for a script file or a module.
function interpreterProgram(parameters, stdinScripts, readOption) {
  let index = 0;
  while (index < parameters.length && isOptionWord(parameters[index])) {
    const option = readOption(parameters[index]);
    const valueWords = option.glued === undefined ? 1 : 0;
    if (option.kind === 'code') {
      return {
        code: option.glued ?? parameters[index + 1] ?? '',
        argv: parameters.slice(index + 1 + valueWords),
      };
    }
    if (option.kind === 'module') return null;
    index += 1 + (option.kind === 'value' ? valueWords : 0);
  }
  const script = parameters[index];
  if (script !== undefined && script !== '-') return null;

  return { code: stdinScripts.join('\n'), argv: parameters.slice(index + 1) };
}

const PYTHON_OPTION_KINDS = { c: 'code', m: 'module', W: 'value', X: 'value' };

function readPythonOption(word) {
  if (word.startsWith('--')) return { kind: 'flag' };
  const letters = word.slice(1);
  const at = letters.search(/[cmWX]/);
  if (at === -1) return { kind: 'flag' };

  return { kind: PYTHON_OPTION_KINDS[letters[at]], glued: letters.slice(at + 1) || undefined };
}

const NODE_CODE_OPTIONS = new Set(['--eval', '--print']);
const NODE_VALUE_OPTIONS = new Set([
  '-r',
  '--require',
  '--import',
  '-C',
  '--conditions',
  '--loader',
  '--experimental-loader',
  '--input-type',
  '--env-file',
  '--title',
]);

function readNodeOption(word) {
  const equals = word.indexOf('=');
  const name = equals === -1 ? word : word.slice(0, equals);
  const glued = equals === -1 ? undefined : word.slice(equals + 1);
  if (NODE_CODE_OPTIONS.has(name) || /^-[ep]+$/.test(word)) return { kind: 'code', glued };

  return { kind: NODE_VALUE_OPTIONS.has(name) ? 'value' : 'flag', glued };
}

const PYTHON_COMMAND = /^python[\d.]*$/;
const NODE_COMMANDS = new Set(['node', 'nodejs']);

function interpreterProgramOf(base, parameters, stdinScripts) {
  if (PYTHON_COMMAND.test(base)) {
    return interpreterProgram(parameters, stdinScripts, readPythonOption);
  }
  if (NODE_COMMANDS.has(base)) return interpreterProgram(parameters, stdinScripts, readNodeOption);

  return null;
}

// A python or node call that writes the file its first argument names;
// `open`/`openSync` only with a writing mode.
const WRITE_CALL =
  /\b(openSync|open|writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\s*\(/g;
const OPEN_CALL = /^open(?:Sync)?$/;
// A mode string that opens for writing: `'w'`, `'a'`, `'x'`, `'r+'`, `'wb'`.
const WRITING_MODE = /(['"])[rbt]*[wax+][rbtwax+]*\1/;
// pathlib's `.write_text(`/`.write_bytes(` names its file in the receiver.
const PATHLIB_WRITE = /\.write_(?:text|bytes)\s*\(/g;
const PATHLIB_RECEIVER = /\bPath\s*\(([^()]*)\)\s*$/;
// A string literal, with python's r/b/f/u prefixes, or a JS template.
const STRING_LITERAL = /(?:\b[rRbBuUfF]{1,2})?(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const WHOLE_STRING_LITERAL = /^\s*(?:[rRbBuUfF]{1,2})?(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*$/s;

// The text of a call's first argument and of the rest, split at the first
// comma outside quotes and brackets.
function splitFirstArgument(content) {
  const state = { depth: 0, quote: null };
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (state.quote === null) {
      if (endsFirstArgument(state, character)) {
        return [content.slice(0, index), content.slice(index + 1)];
      }
    } else if (character === '\\') index++;
    else if (character === state.quote) state.quote = null;
  }

  return [content, ''];
}

// One character outside quotes: it opens a quote, moves the bracket depth,
// or, as a comma at depth 0, ends the first argument.
function endsFirstArgument(state, character) {
  if ('\'"`'.includes(character)) state.quote = character;
  else if ('([{'.includes(character)) state.depth++;
  else if (')]}'.includes(character)) state.depth--;

  return character === ',' && state.depth === 0;
}

// The first argument of each write call in `code` (for pathlib, the
// receiver's), as text.
function writeCallTargets(code) {
  const targets = [];
  for (const match of code.matchAll(WRITE_CALL)) {
    const { content } = matchDelimited(code, match.index + match[0].length, '(', ')');
    const [first, rest] = splitFirstArgument(content);
    if (!OPEN_CALL.test(match[1]) || WRITING_MODE.test(rest)) targets.push(first);
  }
  for (const match of code.matchAll(PATHLIB_WRITE)) {
    targets.push(PATHLIB_RECEIVER.exec(code.slice(0, match.index))?.[1] ?? '');
  }

  return targets;
}

const literalsOf = (text) => [...text.matchAll(STRING_LITERAL)].map((match) => match[2]);

// The paths one write call may write: its literal first argument; or, when
// it names its file through a variable or an expression, every string
// literal in the code, the expression's own literals joined by `/`
// (`os.path.join('src', 'x.ts')`), and every argument word.
function writeCallPaths(target, program) {
  const literal = WHOLE_STRING_LITERAL.exec(target);
  if (literal !== null) return [literal[2]];

  return [...literalsOf(program.code), literalsOf(target).join('/'), ...program.argv];
}

function interpreterWritePath(program, directories, rules) {
  for (const target of writeCallTargets(program.code)) {
    const where = firstGuardedPath(writeCallPaths(target, program), directories, rules);
    if (where !== null) return where;
  }

  return null;
}

// What `xargs` hands an in-place edit comes from its input, so it may be
// any file.
const XARGS_TARGET = 'the files xargs reads from its input';

// Where one unwrapped command writes inside a tree, or null.
function commandWritePath({ tokens, viaXargs }, { directories, rules, stdinScripts }) {
  const base = basename(tokens[0]);
  const parameters = tokens.slice(1);
  const files = writtenFiles(base, parameters);
  if (files !== null) return viaXargs ? XARGS_TARGET : firstGuardedPath(files, directories, rules);
  if (base === 'find') return findWritePath(parameters, directories, rules);
  const program = interpreterProgramOf(base, parameters, stdinScripts);
  if (program === null) return null;

  return interpreterWritePath(program, directories, rules);
}

const shellWriteFinding = (segment, where) => ({
  kind: 'shellWrite',
  detail: `${segment.trim()} (writes ${where})`,
});

const isWriteCommand = (base) =>
  SED_COMMANDS.has(base) ||
  ['perl', 'tee', 'find'].includes(base) ||
  PYTHON_COMMAND.test(base) ||
  NODE_COMMANDS.has(base);

const DIRECTORY_CHANGERS = new Set(['cd', 'pushd', 'popd']);
// `cd x || exit` ends the shell when the `cd` fails.
const LEAVES_THE_SHELL = /^\s*(?:exit|return)(?:\s|$)/;

const union = (first, second) => [...new Set([...first, ...second])];

const resolveEach = (directories, target) =>
  directories.map((directory) => resolveDirectory(directory, target));

// `pushd dir` saves the current place; a bare `pushd` swaps with the saved
// top; `+N`/`-N` rotations leave any saved place possible.
function pushDirectory(location, target) {
  const { directories, stack } = location;
  if (target === undefined) {
    if (stack.length === 0) return { directories, stack };
    return { directories: stack.at(-1), stack: [...stack.slice(0, -1), directories] };
  }
  if (/^[+-]\d/.test(target)) return { directories: union(directories, stack.flat()), stack };

  return { directories: resolveEach(directories, target), stack: [...stack, directories] };
}

function popDirectory(location, target) {
  const { directories, stack } = location;
  if (target !== undefined) return { directories: union(directories, stack.flat()), stack };
  if (stack.length === 0) return { directories, stack };

  return { directories: stack.at(-1), stack: stack.slice(0, -1) };
}

// Where a `cd`/`pushd`/`popd` leads: `cd -` goes back and a bare `cd` goes
// home. Options are skipped (`words` already dropped any redirect).
function changedDirectories(location, tokens) {
  const command = basename(tokens[0]);
  const target = tokens
    .slice(1)
    .find((token) => token === '-' || !token.startsWith('-') || /^[+-]\d/.test(token));
  if (command === 'pushd') return pushDirectory(location, target);
  if (command === 'popd') return popDirectory(location, target);
  if (target === '-') return { directories: location.previous, stack: location.stack };

  return { directories: resolveEach(location.directories, target ?? '~'), stack: location.stack };
}

// A span in command position that prints nothing leaves the next word as
// the command (`$(true)cd dir`).
function afterEmptySpans(tokens) {
  let rest = tokens;
  while (rest.length > 0 && rest[0].includes(SUBSHELL_PLACEHOLDER)) {
    rest = unwrap(rest.slice(1)).tokens;
  }

  return rest;
}

// Where the shell may stand after one directory change, from the separators
// around it:
//   - before `&` or `|` it runs in a subshell and moves nothing;
//   - after `||` or `|` it may not run (and after `|`, bash runs it in a
//     subshell while zsh does not), so both places stay possible;
//   - before `|| exit`/`|| return` only a successful change goes on;
//   - before any other `||` the next command runs only if it failed;
//   - after `&&` it runs only if the command before succeeded; the commands
//     joined to it by `&&` share that fate, so the old place comes back into
//     play at the next other separator (`fallback`).
function moveDirectory(location, move) {
  const tokens = afterEmptySpans(unwrap(words(move.segment)).tokens);
  if (tokens.length === 0 || !DIRECTORY_CHANGERS.has(basename(tokens[0]))) return;
  if (move.after === '&' || move.after === '|') return;
  const change = changedDirectories(location, tokens);
  const current = location.directories;
  location.previous = current;
  location.stack = change.stack;
  if (move.before === '||' || move.before === '|') {
    location.directories = union(current, change.directories);
  } else if (move.after === '||' && !LEAVES_THE_SHELL.test(move.next)) {
    location.directories = union(current, change.directories);
  } else {
    location.directories = change.directories;
    // A second change in the same `&&` chain keeps every earlier place.
    if (move.before === '&&') location.fallback = union(location.fallback ?? [], current);
  }
}

// `a &&` at the end of a line continues on the next one: the blank segment
// between the operator and the newline is not a command, so it neither
// passes a separator nor hides the one before it.
const CONTINUED_ON_NEXT_LINE = new Set(['&&', '||', '|']);

// The old place of a change made after `&&` is possible again once a
// separator other than `&&` passes.
function settleFallback(location, separator) {
  if (location.fallback === null || separator === '&&') return;
  location.directories = union(location.directories, location.fallback);
  location.fallback = null;
}

// A subshell's directory changes end with the subshell.
function enterSubshells(location, count) {
  const { directories, previous, stack, fallback } = location;
  for (let open = 0; open < count; open++) {
    location.saved.push({ directories, previous, stack, fallback });
  }
}

function leaveSubshell(location) {
  if (location.saved.length === 0) return;
  Object.assign(location, location.saved.pop());
}

// A shell runs its `-c` string or, without `-c`, the heredoc bodies and
// here-strings it reads as its script.
function queueShellScript(rest, nested, stdinScripts) {
  const flagIndex = rest.findIndex((token, index) => index > 0 && SHELL_COMMAND_FLAG.test(token));
  if (flagIndex === -1) nested.push(...stdinScripts);
  else if (flagIndex + 1 < rest.length) nested.push(rest[flagIndex + 1]);
}

// The command names the checks below read.
const GUARDED_COMMANDS = new Set(['kill', 'git', 'eval', ...SHELLS]);

const isGuardedCommand = (base, rules) =>
  rules.killCommands.has(base) || GUARDED_COMMANDS.has(base) || isWriteCommand(base);

// Every word a span's text shows, its own nested spans included.
function spanWords(text, depth = 0) {
  if (depth > 8) return [];
  const { segments, nested } = scanLevel(text);

  return [
    ...segments.flatMap(words),
    ...nested.flatMap((entry) => spanWords(entry.text, depth + 1)),
  ];
}

// A `$(...)` or backtick span in command position runs what it prints, glued
// to the text after it. The command is either a name the span's text shows
// (`$(which pkill) x`), or, when it prints nothing, the next word
// (`$(true)git stash`).
function substitutedCommandFinding(command, context) {
  const { tokens } = command;
  const names = new Set(
    context.spans
      .flatMap((text) => spanWords(text))
      .map(basename)
      .filter((base) => isGuardedCommand(base, context.rules)),
  );
  for (const name of names) {
    const finding = commandFinding({ ...command, tokens: [name, ...tokens.slice(1)] }, context);
    if (finding !== null) return finding;
  }
  const after = unwrap(tokens.slice(1));

  return commandFinding(
    {
      tokens: after.tokens,
      viaXargs: command.viaXargs || after.viaXargs,
      environment: { ...command.environment, ...after.environment },
    },
    context,
  );
}

// The finding for one unwrapped command (see `segmentFinding`).
function commandFinding(command, context) {
  const { tokens: rest, viaXargs, environment } = command;
  if (rest.length === 0) return null;
  if (rest[0].includes(SUBSHELL_PLACEHOLDER)) return substitutedCommandFinding(command, context);
  const base = basename(rest[0]);

  if (SHELLS.has(base)) {
    queueShellScript(rest, context.scripts, context.stdinScripts);
    return null;
  }

  if (base === 'eval') {
    context.scripts.push(rest.slice(1).join(' '));
    return null;
  }

  if (context.rules.killCommands.has(base)) return { kind: 'kill' };

  if (base === 'kill') {
    const isPatternKill = viaXargs || killTargets(rest.slice(1)).some(isDangerousKillTarget);

    return isPatternKill ? { kind: 'kill' } : null;
  }

  if (base === 'git') {
    const invocations = context.directories.map((directory) =>
      gitInvocation(rest, directory, environment),
    );

    return gitFinding(context.segment, invocations, context.rules);
  }

  if (!context.rules.checkWrites) return null;
  const where = commandWritePath(command, context);
  if (where === null) return null;

  return shellWriteFinding(context.segment, where);
}

// Where a segment's redirects write inside a tree, or null.
function redirectWritePath(redirects, directories, rules) {
  if (!rules.checkWrites) return null;
  const targets = redirects.filter(isWritingRedirect).map((redirect) => redirect.target);

  return firstGuardedPath(targets, directories, rules);
}

// Returns the finding for one simple command — `{ kind: 'kill' }`, or
// `{ kind: 'stash' | 'mainCheckout' | 'shellWrite', detail }` — or null
// when it is safe. A shell's script and `eval`'s joined arguments go to
// `scripts` as command text. `stdinBodies` are the heredoc bodies it reads,
// `spans` the text of its `$(...)`/backtick spans, and `directories` the
// places it may run in (null for one the text cannot pin down).
function segmentFinding({ segment, scripts, stdinBodies, spans, directories, rules }) {
  const { words: tokens, hereStrings, redirects } = tokenize(segment);
  const stdinScripts = [...stdinBodies, ...hereStrings];
  const finding = commandFinding(unwrap(tokens), {
    segment,
    scripts,
    stdinScripts,
    spans,
    directories,
    rules,
  });
  if (finding !== null) return finding;
  const where = redirectWritePath(redirects, directories, rules);
  if (where === null) return null;

  return shellWriteFinding(segment, where);
}

function firstFinding(lines, depth, checkHeredoc, rules) {
  for (const line of lines) {
    const finding = findDanger(line.text, depth + 1, checkHeredoc, line.directories, rules);
    if (finding !== null) return finding;
  }

  return null;
}

// The texts of `entries` (heredoc bodies or nested spans) that belong to a
// segment, by its index. Grouped once per line, since a line can hold
// thousands of segments.
function textsBySegment(entries) {
  const groups = new Map();
  for (const { segmentIndex, text } of entries) {
    if (!groups.has(segmentIndex)) groups.set(segmentIndex, []);
    groups.get(segmentIndex).push(text);
  }

  return (index) => groups.get(index) ?? [];
}

// For each segment, the first non-blank segment after it ('' at the end).
function followingCommands(segments) {
  const following = [];
  let next = '';
  for (let index = segments.length - 1; index >= 0; index--) {
    following[index] = next;
    if (segments[index].trim() !== '') next = segments[index];
  }

  return following;
}

// Scans one full line of shell text (recursing into `$(...)`, backticks, a
// `-c` argument to `sh`/`bash`/`zsh`/`dash`, an `eval` string, and heredoc
// bodies) and returns the first finding anywhere in it, or null. A heredoc
// body is never part of the command line around it, but a body can still be
// run (`bash <<'EOF'`, `eval "$(cat <<'EOF' …)"`, `ssh host <<'EOF'`), so
// each body is checked on its own for a kill or a git stash. Only a body a
// shell reads as its script is also checked for an unquoted heredoc; any
// other body is text, so a `<<word` in it is not an operator, and it is not
// checked for shell writes either (a commit message or a notes file that
// shows `sed -i` or `> src/…` writes nothing). `directories` are the places
// the line may start in; every nested line runs where its segment does.
function findDanger(line, depth, checkHeredoc, directories, rules) {
  if (depth > 8) return null; // guards against pathological nesting
  const { segments, nested, heredoc, bodies, opens, closes, separators } = scanLevel(line);
  const location = { directories, previous: [null], stack: [], fallback: null, saved: [] };
  const directoriesAt = [];
  const scripts = [];
  const bodiesAt = textsBySegment(bodies);
  const spansAt = textsBySegment(nested);
  const nextCommands = followingCommands(segments);
  let before = '';

  for (const [index, segment] of segments.entries()) {
    enterSubshells(location, opens[index]);
    const here = location.directories;
    directoriesAt.push(here);
    const segmentScripts = [];
    const finding = segmentFinding({
      segment,
      scripts: segmentScripts,
      stdinBodies: bodiesAt(index),
      spans: spansAt(index),
      directories: here,
      rules,
    });
    if (finding !== null) return finding;
    scripts.push(...segmentScripts.map((text) => ({ text, directories: here })));
    const after = separators[index];
    const blank = segment.trim() === '';
    if (!blank) {
      moveDirectory(location, { segment, before, after, next: nextCommands[index] });
      settleFallback(location, after);
    }
    if (closes[index]) leaveSubshell(location);
    before = blank && CONTINUED_ON_NEXT_LINE.has(before) ? before : after;
  }
  if (checkHeredoc && heredoc !== null) return { kind: 'heredoc', detail: heredoc };

  const inItsDirectory = (entry) => ({
    text: entry.text,
    directories: directoriesAt[entry.segmentIndex],
  });

  return (
    firstFinding([...nested.map(inItsDirectory), ...scripts], depth, checkHeredoc, rules) ??
    firstFinding(bodies.map(inItsDirectory), depth, false, { ...rules, checkWrites: false })
  );
}

// ---- the decision ----

const KILL_COMMANDS = ['pkill', 'killall'];

// The hook's decision for one command: the first finding, or null.
//
// `options.cwd` is where the command starts. `options.sentinelKillCommands`
// and `options.mainCheckoutPath` exist only for the tests and the sentinel
// probe runner (scripts/checks/kill-guard-probe.sh): a probe that really runs
// uses a harmless sentinel name in place of every kill word and a scratch
// folder in place of the main checkout, and the guard judges it with those.
// `options.projectRoot` is test-only too: a fake repository in a scratch
// folder stands in for this one, so the shell-write tests never name a real
// file. The hook entry point below never passes any of them.
//
// A `$"…"` heredoc delimiter ends at `EOF` in bash and at `$EOF` in zsh, so
// every command is judged once per reading, and either finding counts. The
// outer text cannot tell whether such a delimiter hides in a nested `-c` or
// `eval` string (`\$\"EOF\"`), so both readings always run.
function decide(command, options = {}) {
  const rules = {
    killCommands: new Set([...KILL_COMMANDS, ...(options.sentinelKillCommands ?? [])]),
    mainCheckoutPath: options.mainCheckoutPath ?? MAIN_CHECKOUT_PATH,
    projectCommonDirectory: gitCommonDirectory(options.projectRoot ?? PROJECT_ROOT),
    checkWrites: true,
  };
  const start = typeof options.cwd === 'string' ? resolveDirectory(null, options.cwd) : null;
  for (const reading of ['bash', 'zsh']) {
    const finding = withShellReading(reading, () => findDanger(command, 0, true, [start], rules));
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

  const finding = decide(command, { cwd: payload.cwd });
  if (finding !== null) process.stdout.write(denyJson(reasonFor(finding)));
}

if (require.main === module) {
  try {
    main(fs.readFileSync(0, 'utf8'));
  } catch {
    // Never break the Bash tool: any unexpected failure here falls through to
    // the unconditional exit 0 below with no output, i.e. allow.
  }
  process.exit(0);
}

module.exports = { decide };
