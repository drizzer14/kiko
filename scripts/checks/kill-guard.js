#!/usr/bin/env node

// PreToolUse guard for the Bash tool: denies pkill/killall, a kill/pkill/
// killall reached through a pattern (xargs, $(...), a `-c` string), and a
// process-group/broadcast kill (a negative pid, pid 0, or a bare `-1`
// signal-as-target). See docs/harness/checks.md "Automatic wiring" and
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
// And it denies a shell write into `src/`, `__tests__/`, `rules/`, or `e2e/` at the
// root of any worktree of this repository — `sed -i`, `perl -i`, a `>`/`>>`
// (or `>|`, `&>`, `<>`) redirect, `tee`, a python `-c` or node `-e` one-liner
// (or one fed by a heredoc or here-string on its stdin)
// that opens a file for writing, and `xargs`
// running an in-place edit — because the pre-write guard sees only
// Edit/Write/MultiEdit, so such a write lands unchecked. A heredoc body that
// no shell or interpreter runs is text, never checked for writes.
//
// And it denies a `while` or `until` loop that scans the process table (`ps`,
// `top`, `pstree`, or `pgrep -f`) for make verify, check:all, jest, stryker,
// semgrep, or xcodebuild: the loop's own command line holds the pattern, so
// the scan matches the loop itself and the wait never ends. A one-time scan
// outside a loop, and a loop that scans nothing (a file, a pid,
// scripts/wait-load.sh), stay allowed.
//
// And it denies a `git commit`, `git merge`, or `git pull` that skips the tracked githooks/ (the
// pre-commit typecheck): `--no-verify` (or an abbreviation of it), commit's `-n` (alone or inside
// a flag group), `-c core.hooksPath=...` or `--config-env=core.hooksPath=...` before the
// subcommand, and core.hooksPath set through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_<n>` or
// `GIT_CONFIG_PARAMETERS`, in any directory and inside a shell string. A `git config` that sets or
// unsets core.hooksPath, or removes or renames its `core` section, is denied too, in any scope: it
// switches the hooks off for every worktree. git reads a `--long` option as an exact name or a
// unique prefix (`--unset-a` is `--unset-all`), so the guard resolves each option the same way
// (CONFIG_LONG_OPTIONS, the union of the `git config -h` lists); an ambiguous or unknown option
// denies when the command names the key or the section. These config denies carry their own
// reason: leave core.hooksPath as scripts/ensure-git-hooks.sh sets it.
// A user may still bypass in their own shell; the deny binds agent Bash calls only. `-n` after
// another option's value, after `--`, in a message, or on `git log` or `git merge`/`git pull`
// (`--no-stat`) is not a bypass, and a `git config` read of the key is allowed.
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
  'WHAT FAILED:    kill-guard denied a shell write into src/, __tests__/, rules/, or e2e/ of a worktree ' +
    'of this repository.',
  'WHY IT MATTERS: the pre-write guard (scripts/checks/pre-write-guard.sh) sees only the Edit, ' +
    'Write, and MultiEdit tools, so a file written by sed -i, perl -i, a > or >> redirect, tee, ' +
    'cp, mv, or a python or node one-liner lands unchecked; guard-replay only catches it at ' +
    'Stop, after the fact.',
  'HOW TO FIX:     use the Edit or Write tool for that file; to move a file, use `git mv` ' +
    '(git add a new file first), which guard-replay follows as a rename. A path the guard ' +
    'cannot resolve (a ' +
    'variable, a glob) counts when a folder in it is named src, rules, e2e, or __tests__: write the ' +
    'literal path, or use another folder name. Reading it, a redirect to /dev/null or to a path ' +
    'outside those trees (your scratchpad, /tmp), git itself (without a redirect into those ' +
    'trees), and a formatter or fixer writing on its own (./node_modules/.bin/biome check ' +
    "--write, the harness's " +
    'import-order --write) stay allowed.',
  'DO NOT:         route the write through a variable, a script file, a shell fed by a pipe, or ' +
    'another tool (cp, mv, dd) to get past this guard.',
];

function blockReason(reasonLines, detail) {
  const [what, ...rest] = reasonLines;

  return [what, `DETAILS:        ${detail}`, ...rest].join('\n');
}

const WAIT_LOOP_REASON_LINES = [
  'WHAT FAILED:    kill-guard denied a while or until loop that scans ps or pgrep for make verify, ' +
    'check:all, jest, stryker, semgrep, or xcodebuild.',
  "WHY IT MATTERS: the loop's own command line holds the pattern, so the scan matches the loop " +
    'itself and the wait never ends; a [x] bracket in the pattern fails as soon as the same word ' +
    'appears elsewhere in that command line.',
  'HOW TO FIX:     for a load wait, run `bash scripts/wait-load.sh <load> <timeout>` chained with ' +
    "&& before the heavy command; for a job you started, run it with the tool's own " +
    'run_in_background and wait on its exit code. A one-time ps or pgrep outside a loop, a ' +
    'pgrep without -f, and a loop on a file or on a pid you started (kill -0 <pid>) stay allowed.',
  'DO NOT:         write a ps|grep or pgrep loop for these names, through a bracket trick, a ' +
    'variable, or a script file, to get past this guard.',
];

const NO_VERIFY_REASON_LINES = [
  'WHAT FAILED:    kill-guard denied a git commit, merge, or pull that skips the pre-commit hook, ' +
    'or a git config that switches it off (--no-verify, -n, -c core.hooksPath=..., git config ' +
    'core.hooksPath, or GIT_CONFIG_* in the environment).',
  'WHY IT MATTERS: each commit must typecheck by itself: the tracked githooks/pre-commit and ' +
    'githooks/pre-merge-commit run tsc on the staged files, and a bypassed commit lands an ' +
    'unchecked type error on the branch.',
  'HOW TO FIX:     fix the type error the hook reports, git add the fix, and commit again (the ' +
    'hook reads the index, so an unstaged fix does not count). A user may bypass in their own ' +
    'shell with git commit --no-verify; an agent never does.',
  'DO NOT:         skip the hook through --no-verify, -n, -c core.hooksPath, git config ' +
    'core.hooksPath (set or --unset, in any scope), GIT_CONFIG_COUNT/GIT_CONFIG_KEY_<n>/' +
    'GIT_CONFIG_PARAMETERS, a script file, an alias, or a variable to get past this guard.',
];

const HOOKS_CONFIG_REASON_LINES = [
  'WHAT FAILED:    kill-guard denied a change to the git config that holds core.hooksPath (git ' +
    'config core.hooksPath, --unset, --remove-section core, an abbreviated option, or GIT_CONFIG_* ' +
    'in the environment).',
  'WHY IT MATTERS: core.hooksPath=githooks, set once by scripts/ensure-git-hooks.sh, runs the ' +
    'pre-commit typecheck for every worktree; rewriting the key, or removing or renaming its ' +
    'core section, switches that typecheck off everywhere until someone notices.',
  'HOW TO FIX:     leave core.hooksPath as scripts/ensure-git-hooks.sh sets it. If it was lost, ' +
    'repair it with `bash scripts/ensure-git-hooks.sh` (or `npm ci`, whose postinstall runs it).',
  'DO NOT:         set, unset, remove, or rename core.hooksPath or its section through git config ' +
    '(any scope, any option spelling or abbreviation), GIT_CONFIG_COUNT/GIT_CONFIG_KEY_<n>/' +
    'GIT_CONFIG_PARAMETERS, a script file, an alias, or a variable to get past this guard.',
];

const REASON_BY_KIND = {
  kill: () => KILL_REASON,
  stash: (finding) => blockReason(STASH_REASON_LINES, finding.detail),
  heredoc: (finding) => blockReason(HEREDOC_REASON_LINES, finding.detail),
  mainCheckout: (finding) => blockReason(MAIN_CHECKOUT_REASON_LINES, finding.detail),
  shellWrite: (finding) => blockReason(SHELL_WRITE_REASON_LINES, finding.detail),
  waitLoop: (finding) => blockReason(WAIT_LOOP_REASON_LINES, finding.detail),
  noVerify: (finding) => blockReason(NO_VERIFY_REASON_LINES, finding.detail),
  hooksConfig: (finding) => blockReason(HOOKS_CONFIG_REASON_LINES, finding.detail),
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
    new Set([
      '-C',
      '-D',
      '-g',
      '-h',
      '-p',
      '-R',
      '-r',
      '-T',
      '-t',
      '-U',
      '-u',
      '--user',
      '--group',
      '--close-from',
      '--chdir',
      '--host',
      '--prompt',
      '--chroot',
      '--command-timeout',
      '--other-user',
      '--role',
      '--type',
    ]),
  ],
  ['nice', new Set(['-n', '--adjustment'])],
  // `/usr/bin/time -o file` (BSD and GNU) and GNU `-f format`.
  ['time', new Set(['-o', '-f', '--output', '--format'])],
  ['stdbuf', new Set(['-i', '-o', '-e', '--input', '--output', '--error'])],
  ['env', new Set(['-C', '-P', '-a', '-u', '--chdir', '--unset', '--argv0'])],
  ['timeout', new Set(['-k', '-s', '--kill-after', '--signal'])],
  [
    'xargs',
    new Set([
      '-a',
      '-d',
      '-E',
      '-I',
      '-J',
      '-L',
      '-n',
      '-P',
      '-R',
      '-S',
      '-s',
      '--arg-file',
      '--delimiter',
      '--max-args',
      '--max-procs',
      '--max-chars',
      '--process-slot-var',
    ]),
  ],
]);

// Words that can stand before a command in its own position.
const RESERVED_WORDS = new Set(['!', 'if', 'then', 'elif', 'else', 'do', 'while', 'until']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
const GROUP_OPENERS = /^[({]+/;

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
// `-c`, and any flag group that holds it (`-lc`, `-ec`, `-xc`).
const SHELL_COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

// GNU `xargs -i[R]`, `-e[EOF]`, and `-l[N]` take only a value glued on (`-iR`),
// never the next word, so a letter after one of them is part of that value.
const XARGS_GLUED_ONLY_OPTIONS = new Set(['i', 'e', 'l']);

// A `--long` option written without `=` that is a prefix of a listed
// value-taking one (`--max-p` for `--max-procs`), as getopt_long accepts it.
// For `git`, which rejects abbreviations, this only over-skips a word, never
// hides a command.
const abbreviatesLongOption = (option, optionsWithValue) =>
  option.length > 2 &&
  option.startsWith('--') &&
  !option.includes('=') &&
  [...optionsWithValue].some((name) => name.startsWith(option));

// Whether an option takes its value as the NEXT word: a listed option (or an
// abbreviation of a listed long one), or a flag group whose first value-taking
// letter comes last (`sudo -iu me`, as getopt reads it; in `-uroot` the value
// is glued on). A group holding a glued-only letter never takes the next word.
function takesNextWord(option, optionsWithValue, gluedOnlyLetters = new Set()) {
  if (optionsWithValue.has(option) || abbreviatesLongOption(option, optionsWithValue)) return true;
  if (!/^-[A-Za-z0-9]{2,}$/.test(option)) return false;
  const letters = [...option.slice(1)];
  if (letters.some((letter) => gluedOnlyLetters.has(letter))) return false;

  return letters.findIndex((letter) => optionsWithValue.has(`-${letter}`)) === letters.length - 1;
}

// The tokens after a command word and its leading options.
function skipOptions(tokens, optionsWithValue, gluedOnlyLetters) {
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    i += takesNextWord(tokens[i], optionsWithValue, gluedOnlyLetters) ? 2 : 1;
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
  if (base === 'env') return envSplitCommand(t);

  return null;
}

// The `=value` of `--name[=value]` (undefined when bare) when `name` is `full`
// or an abbreviation of it, as getopt_long reads it; null for any other word.
function longOptionValue(word, full) {
  const match = /^(--[a-z][a-z-]*)(?:=(.*))?$/s.exec(word);

  return match !== null && full.startsWith(match[1]) ? { value: match[2] } : null;
}

// `env`'s split-string option (`-S str`, `-Sstr`, `-iS str`, `--split-string
// str`, `--split-string=str`, or an abbreviation of the long form) with its
// value and how many words it used, or null for any other option. A short
// group holds it only when no other value-taking letter comes first.
function splitStringOption(option, next) {
  const long = longOptionValue(option, '--split-string');
  if (long !== null) {
    return { value: long.value ?? next ?? '', used: long.value === undefined ? 2 : 1 };
  }
  const short = /^-([^CuPaS-]*)S(.*)$/s.exec(option);
  if (short === null) return null;

  return { value: short[2] || (next ?? ''), used: short[2] ? 1 : 2 };
}

// An `env` command line whose leading options hold a split-string: its string
// split into words, then the words after it. Null when none does.
function envSplitCommand(t) {
  let i = 1;
  while (i < t.length && t[i].startsWith('-')) {
    const split = splitStringOption(t[i], t[i + 1]);
    if (split !== null) return [...words(split.value), ...t.slice(i + split.used)];
    i += takesNextWord(t[i], OPTION_WRAPPERS.get('env')) ? 2 : 1;
  }

  return null;
}

// The word an `xargs` replaces with its input (`-I {}`, `-I{}`, `-J %`,
// GNU `-i[R]` and `--replace[=R]`, whose default is `{}`), or undefined when
// it appends the input after the command's own words.
function xargsPlaceholder(tokens) {
  let placeholder;
  for (let index = 1; index < tokens.length && tokens[index].startsWith('-'); index++) {
    const word = tokens[index];
    const replace = longOptionValue(word, '--replace');
    const letters = /^-([^-].*)$/s.exec(word)?.[1] ?? '';
    const at = letters.search(/[adEeIJLlnPRSsi]/);
    if (replace !== null) placeholder = replace.value ?? '{}';
    else if (letters[at] === 'i') placeholder = letters.slice(at + 1) || '{}';
    else if ('IJ'.includes(letters[at] ?? '-')) {
      placeholder = letters.slice(at + 1) || tokens[index + 1];
    }
    if (takesNextWord(word, OPTION_WRAPPERS.get('xargs'), XARGS_GLUED_ONLY_OPTIONS)) index++;
  }

  return placeholder;
}

// Strips every lead-in and wrapper command (`sudo -u me`, `env`, `nice -n 10`,
// `time -p`, `timeout N`, `xargs`, ...) so the checks below see the command
// actually being run. Returns the remaining tokens and whether an `xargs`
// wrapper was stripped: a `kill`/`pkill`/`killall` reached through `xargs`
// takes its targets from the piped-in input — from a pattern, by
// construction — so it is denied unconditionally regardless of any static
// args that follow it. `environment` holds the `NAME=value` prefixes it
// stripped (`GIT_DIR=…` changes where git writes), and `xargsPlaceholder`
// the last `xargs`'s own replace word (see `xargsPlaceholder`).
function unwrap(tokens) {
  let viaXargs = false;
  let placeholder;
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
      return {
        tokens: [word, ...t.slice(1)],
        viaXargs,
        xargsPlaceholder: placeholder,
        environment,
      };
    }
    if (base === 'xargs') {
      viaXargs = true;
      placeholder = xargsPlaceholder(t);
    }
    t = skipOptions(
      t,
      OPTION_WRAPPERS.get(base),
      base === 'xargs' ? XARGS_GLUED_ONLY_OPTIONS : undefined,
    );
    if (base === 'timeout') t = t.slice(1);
  }

  return { tokens: t, viaXargs, xargsPlaceholder: placeholder, environment };
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
// glob, a brace group, a `$(...)`) cannot be pinned down from the text. A
// brace also stands for a python f-string field or `.format` placeholder
// (`f'{root}/__tests__/x.ts'`) in an interpreter's code.
const UNRESOLVED_PATH = /^~|[$`*?[{]|__SUBSHELL__/;

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

// The global options that set a config entry for one command: `-c name=value` and
// `--config-env=name=VARIABLE`.
const GIT_CONFIG_OPTIONS = new Set(['-c', '--config-env']);

function applyGitOption(invocation, option, next) {
  const equals = option.indexOf('=');
  const name = equals === -1 ? option : option.slice(0, equals);
  const value = equals === -1 ? next : option.slice(equals + 1);
  if (value === undefined) return;
  if (GIT_CONFIG_OPTIONS.has(name)) invocation.configs.push(value);
  const field = GIT_PATH_OPTIONS.get(name);
  if (field === undefined) return;
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
    configs: [],
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
    configs: invocation.configs,
    environment,
    targets: [locate(invocation.workTree), locate(invocation.gitDirectory)],
  };
}

// ---- a commit or merge that skips the tracked githooks/ ----

// `pull` runs the merge hooks, and takes `--no-verify` for the merge it starts.
const HOOK_RUNNING_SUBCOMMANDS = new Set(['commit', 'merge', 'pull']);
// Git config keys are case-insensitive, and a bare name or an empty value still overrides the path.
const HOOKS_PATH_CONFIG = /^core\.hookspath(?:=|$)/i;
const HOOKS_PATH_KEY = /^core\.hookspath$/i;
// `GIT_CONFIG_COUNT` with `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` names a config entry by key.
const GIT_CONFIG_KEY_VARIABLE = /^GIT_CONFIG_KEY_\d+$/;
// `GIT_CONFIG_PARAMETERS` holds quoted `'name=value'` entries, so the key sits after a quote or a
// space.
const HOOKS_PATH_PARAMETER = /(?:^|[\s'"])core\.hookspath(?:=|['"\s]|$)/i;
const NO_VERIFY_OPTION = '--no-verify';
// `--no-v` is the shortest prefix of `--no-verify`. Other options share it (`--no-verbose`,
// `--no-verify-signatures`), so git may reject it as ambiguous, and denying a command git then
// rejects costs nothing.
const NO_VERIFY_SHORTEST = '--no-v';

// The options whose value is the NEXT word, so a `-n` or `--no-verify` there is text, not a flag.
const VALUE_OPTIONS_BY_SUBCOMMAND = new Map([
  [
    'commit',
    new Set([
      '-m',
      '-F',
      '-C',
      '-c',
      '-t',
      '--message',
      '--file',
      '--author',
      '--date',
      '--template',
      '--reuse-message',
      '--reedit-message',
      '--fixup',
      '--squash',
      '--cleanup',
      '--trailer',
      '--pathspec-from-file',
    ]),
  ],
  [
    'merge',
    new Set([
      '-m',
      '-F',
      '-s',
      '-X',
      '--message',
      '--file',
      '--strategy',
      '--strategy-option',
      '--into-name',
      '--cleanup',
    ]),
  ],
  [
    'pull',
    new Set([
      '-s',
      '-X',
      '-o',
      '-j',
      '--strategy',
      '--strategy-option',
      '--server-option',
      '--jobs',
      '--depth',
      '--upload-pack',
      '--cleanup',
    ]),
  ],
]);
// `git commit -S[<key>]` and `-u[<mode>]` take only a glued value, never the next word.
const COMMIT_GLUED_ONLY_LETTERS = new Set(['S', 'u']);

const isNoVerifyOption = (word) =>
  word.length >= NO_VERIFY_SHORTEST.length && NO_VERIFY_OPTION.startsWith(word);

// Whether a short-option group such as `-anm` holds commit's `-n`. A letter that takes a value ends
// the group, because the rest of the group is its value: `-amn` is `-a -m n`.
function groupHoldsNoVerify(group) {
  for (const letter of group.slice(1)) {
    if (letter === 'n') return true;
    if ('mFCctSu'.includes(letter)) return false;
  }

  return false;
}

const unquoted = (text) => text.replace(/^['"]|['"]$/g, '');

// Whether the NAME=value prefixes of the command set core.hooksPath for the git it runs.
const environmentSetsHooksPath = (environment) =>
  Object.entries(environment).some(
    ([name, value]) =>
      (GIT_CONFIG_KEY_VARIABLE.test(name) && HOOKS_PATH_KEY.test(unquoted(value))) ||
      (name === 'GIT_CONFIG_PARAMETERS' && HOOKS_PATH_PARAMETER.test(value)),
  );

// The long options of `git config`, as `git config -h` lists them on git 2.38.1 (the git on this
// machine's PATH), plus the ones later gits added (`--value`, `--all`, `--regexp`, `--url`,
// `--comment`, `--show-names`): the union, so a prefix that is unique on one git but ambiguous on
// another reads as ambiguous (git then rejects it, and the guard denies it with a hooksPath key).
// Each name maps to what it does: `read` (an action that only reads, so nothing is written),
// `write` (sets or unsets the keys named after it), `section` (removes or renames the section
// named after it), `value` (the NEXT word is its value), or `flag`.
const CONFIG_LONG_OPTIONS = new Map([
  ['--global', 'flag'],
  ['--system', 'flag'],
  ['--local', 'flag'],
  ['--worktree', 'flag'],
  ['--file', 'value'],
  ['--blob', 'value'],
  ['--get', 'read'],
  ['--get-all', 'read'],
  ['--get-regexp', 'read'],
  ['--get-urlmatch', 'read'],
  ['--get-color', 'read'],
  ['--get-colorbool', 'read'],
  ['--list', 'read'],
  ['--replace-all', 'write'],
  ['--add', 'write'],
  ['--unset', 'write'],
  ['--unset-all', 'write'],
  ['--rename-section', 'section'],
  ['--remove-section', 'section'],
  ['--fixed-value', 'flag'],
  ['--edit', 'flag'],
  ['--type', 'value'],
  ['--bool', 'flag'],
  ['--int', 'flag'],
  ['--bool-or-int', 'flag'],
  ['--bool-or-str', 'flag'],
  ['--path', 'flag'],
  ['--expiry-date', 'flag'],
  ['--null', 'flag'],
  ['--name-only', 'flag'],
  ['--includes', 'flag'],
  ['--show-origin', 'flag'],
  ['--show-scope', 'flag'],
  ['--show-names', 'flag'],
  ['--default', 'value'],
  ['--comment', 'value'],
  ['--value', 'value'],
  ['--url', 'value'],
  ['--all', 'flag'],
  ['--regexp', 'flag'],
  ['--help', 'read'],
  ['--help-all', 'read'],
]);
const CONFIG_SHORT_OPTIONS = new Map([
  ['f', 'value'],
  ['t', 'value'],
  ['l', 'read'],
  ['e', 'flag'],
  ['z', 'flag'],
  ['h', 'read'],
]);

// What one `--long[=value]` word of `git config` is, as git's parse-options reads it: an exact
// name wins; otherwise a prefix that only one name starts with resolves to it; any other word is
// `unresolved` (ambiguous, or unknown). A `--no-<option>` negates a flag and never names an action.
function resolveConfigLongOption(word) {
  const name = word.split('=')[0];
  const exact = CONFIG_LONG_OPTIONS.get(name);
  if (exact !== undefined) return { kind: exact, hasValue: word.includes('=') };
  if (name.startsWith('--no-')) return { kind: 'flag', hasValue: false };
  const matches = [...CONFIG_LONG_OPTIONS].filter(([candidate]) => candidate.startsWith(name));
  if (matches.length !== 1) return { kind: 'unresolved', hasValue: false };

  return { kind: matches[0][1], hasValue: word.includes('=') };
}

// A short-option group of `git config` (`-l`, `-lz`, `-fFILE`): the strongest kind in it, and
// whether the NEXT word is the value of its last letter.
function resolveConfigShortOption(word) {
  const kinds = [];
  for (const [index, letter] of [...word.slice(1)].entries()) {
    const kind = CONFIG_SHORT_OPTIONS.get(letter) ?? 'unresolved';
    kinds.push(kind);
    if (kind === 'value') {
      return { kinds, hasValue: index < word.length - 2 };
    }
  }

  return { kinds, hasValue: true };
}

// The kinds one option word names, and whether its value is the NEXT word.
function readConfigOption(word) {
  if (word.startsWith('--')) {
    const { kind, hasValue } = resolveConfigLongOption(word);

    return { kinds: [kind], takesNextWord: kind === 'value' && !hasValue };
  }
  const { kinds, hasValue } = resolveConfigShortOption(word);

  return { kinds, takesNextWord: kinds.includes('value') && !hasValue };
}

// A `git config` command line split into the kinds of its options and its positional words.
function splitConfigWords(parameters) {
  const kinds = [];
  const positionals = [];
  let optionsEnded = false;
  for (let index = 0; index < parameters.length; index += 1) {
    const word = parameters[index];
    if (!optionsEnded && word === '--') {
      optionsEnded = true;
    } else if (optionsEnded || !word.startsWith('-') || word === '-') {
      positionals.push(word);
    } else {
      const option = readConfigOption(word);
      kinds.push(...option.kinds);
      if (option.takesNextWord) index += 1;
    }
  }

  return { kinds: new Set(kinds), positionals };
}

const isHooksPathKey = (word) => word !== undefined && HOOKS_PATH_KEY.test(word);
const isCoreSection = (word) => word !== undefined && word.toLowerCase() === 'core';

// Whether a `git config` writes or unsets core.hooksPath, or removes or renames its section
// (`core`), which switches the hooks off for every worktree until someone notices. `git config
// core.hooksPath` alone, and any resolved read action (`--get` and its prefixes, `--list`), only
// read. A word git cannot resolve to one option (ambiguous or unknown) makes git reject the whole
// command, so it denies whenever the command names the key or the section (fail closed).
function rewritesHooksPath({ subcommand, arguments: parameters }) {
  if (subcommand !== 'config') return false;
  const { kinds, positionals } = splitConfigWords(parameters);
  const namesTarget = (word) => isHooksPathKey(word) || isCoreSection(word);
  if (kinds.has('unresolved')) return positionals.some(namesTarget);
  if (kinds.has('read')) return false;
  if (kinds.has('write')) return positionals.some(isHooksPathKey);
  if (kinds.has('section')) return positionals.some(isCoreSection);
  // `git config set|unset <key>` and `remove-section|rename-section <name>` (git 2.46) name the
  // action first.
  const [action, name] = positionals;
  if (action === 'set' || action === 'unset') return isHooksPathKey(name);
  if (action === 'remove-section' || action === 'rename-section') return isCoreSection(name);

  return isHooksPathKey(action) && positionals.length >= 2;
}

// Whether the git command is told to skip its hooks, by option, by config, or by environment.
function skipsHooks(git) {
  const { subcommand, arguments: parameters, configs, environment } = git;
  if (!HOOK_RUNNING_SUBCOMMANDS.has(subcommand)) return false;
  if (configs.some((entry) => HOOKS_PATH_CONFIG.test(entry))) return true;
  if (environmentSetsHooksPath(environment)) return true;
  const valueOptions = VALUE_OPTIONS_BY_SUBCOMMAND.get(subcommand);
  let index = 0;
  while (index < parameters.length) {
    const word = parameters[index];
    if (word === '--') return false;
    if (isNoVerifyOption(word)) return true;
    // `-n` is commit's --no-verify but merge's --no-stat.
    if (subcommand === 'commit' && /^-[A-Za-z]+$/.test(word) && groupHoldsNoVerify(word)) {
      return true;
    }
    index += takesNextWord(word, valueOptions, COMMIT_GLUED_ONLY_LETTERS) ? 2 : 1;
  }

  return false;
}

// One invocation per directory the command may run in; the subcommand is
// the same in each.
function gitFinding(segment, invocations, rules) {
  const [git] = invocations;
  if (git.subcommand === 'stash') return { kind: 'stash', detail: segment.trim() };
  if (rewritesHooksPath(git)) return { kind: 'hooksConfig', detail: segment.trim() };
  if (skipsHooks(git)) return { kind: 'noVerify', detail: segment.trim() };
  if (!MAIN_CHECKOUT_SUBCOMMANDS.has(git.subcommand) || leavesMainCheckoutSafe(git)) return null;
  const target = invocations
    .flatMap((invocation) => invocation.targets)
    .find((directory) => isInsideMainCheckout(directory, rules.mainCheckoutPath));
  if (target === undefined) return null;

  return { kind: 'mainCheckout', detail: `${segment.trim()} (runs in ${target})` };
}

// ---- shell writes into src/, __tests__/, rules/, and e2e/ ----

// The folders, at the root of any worktree of this repository, that only
// Edit/Write may change: the pre-write guard sees no other tool.
const WRITE_GUARDED_TREES = new Set(['src', '__tests__', 'rules', 'e2e']);

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

// Where `target` lands from `directory` (resolved when the text allows) when
// that is inside a tree, or null. A cp/mv `destination` may be a folder, and
// what it copies lands inside it, so one that is a tree folder itself counts
// too. With `resolvedOnly`, a target the text cannot resolve never counts.
function guardedPlace(target, directory, rules, { destination, resolvedOnly }) {
  const resolved = resolveDirectory(directory, target);
  const inside = (place) => (destination ? `${place.replace(/\/+$/, '')}/_` : place);
  if (resolved === null) {
    return !resolvedOnly && namesGuardedTree(inside(target)) ? target : null;
  }

  return isInsideGuardedTree(inside(resolved), rules) ? resolved : null;
}

// The first of `targets` that lands inside a tree from any directory the
// command may run in, as `{ verb, where }` for the deny's DETAILS, or null.
function firstGuardedWrite(
  targets,
  directories,
  rules,
  { verb = 'writes', destination = false, resolvedOnly = false } = {},
) {
  for (const target of targets) {
    for (const directory of directories) {
      const where = guardedPlace(target, directory, rules, { destination, resolvedOnly });
      if (where !== null) return { verb, where };
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

const COPY_MOVE_COMMANDS = new Set(['cp', 'mv', 'gcp', 'gmv']);
const MOVE_COMMANDS = new Set(['mv', 'gmv']);

function readCopyMoveLongOption(word, next) {
  const [name, value] = word.split(/=(.*)/s);
  const takesValue = name === '--target-directory' || name === '--suffix';

  return {
    targetDirectory: name === '--target-directory' ? (value ?? next) : undefined,
    noTargetDirectory: name === '--no-target-directory',
    recursive: ['--recursive', '--archive'].some((full) => longOptionValue(word, full) !== null),
    skip: takesValue && value === undefined ? 1 : 0,
  };
}

// One cp/mv option word: the target folder it names (`-t DIR`, `-tDIR`,
// `--target-directory[=]DIR`), whether it names the destination itself
// (`-T`, `--no-target-directory`), whether it copies folders (`-r`, `-R`,
// `-a`, `--recursive`, `--archive`), and whether the next word is its value
// (`-t`, `-S`, `--suffix`, `--target-directory` with no `=`).
function readCopyMoveOption(word, next) {
  if (word.startsWith('--')) return readCopyMoveLongOption(word, next);
  const letters = word.slice(1);
  const valueAt = letters.search(/[tS]/);
  const head = valueAt === -1 ? letters : letters.slice(0, valueAt);
  const value = valueAt === -1 ? undefined : letters.slice(valueAt + 1) || next;

  return {
    targetDirectory: letters[valueAt] === 't' ? value : undefined,
    noTargetDirectory: head.includes('T'),
    recursive: /[rRa]/.test(head),
    skip: valueAt !== -1 && valueAt === letters.length - 1 ? 1 : 0,
  };
}

const intoFolder = (folder, sources) =>
  sources.map((source) => `${folder.replace(/\/+$/, '')}/${path.basename(source)}`);

// The paths a cp/mv writes; a moved source is removed, not written. With
// two operands the text cannot tell whether the destination is a folder,
// so both readings count (fail closed).
function copyMoveTargets(parameters) {
  const { options, operands } = splitOptions(parameters, readCopyMoveOption);
  const targetDirectory = options.findLast((option) => option.targetDirectory !== undefined);
  if (targetDirectory !== undefined) return intoFolder(targetDirectory.targetDirectory, operands);
  if (operands.length < 2) return [];
  const destination = operands.at(-1);
  const sources = operands.slice(0, -1);
  if (options.some((option) => option.noTargetDirectory)) return [destination];
  if (sources.length > 1 || destination.endsWith('/')) return intoFolder(destination, sources);

  return [destination, ...intoFolder(destination, sources)];
}

// The files a command writes (`sed -i`, `perl -i`, `tee`, `cp`, `mv`), or
// null when it is none of them or does not edit in place.
function writtenFiles(base, parameters) {
  if (COPY_MOVE_COMMANDS.has(base)) return copyMoveTargets(parameters);
  if (SED_COMMANDS.has(base)) {
    return inPlaceFiles(splitOptions(parameters, readSedOption), (option) => option.script);
  }
  if (base === 'perl') {
    return inPlaceFiles(splitOptions(parameters, readPerlSwitches, true), (option) => option.code);
  }
  if (base === 'tee') return splitOptions(parameters, () => ({})).operands;

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
// pathlib's `.write_text(`/`.write_bytes(` names its file in the receiver, and
// so does its `.open(` with a writing mode: its first argument (`'w'`), or a
// `mode=` keyword in any place (`encoding='utf8', mode='w'`).
const PATHLIB_WRITE = /\.write_(?:text|bytes)\s*\(/g;
const PATHLIB_OPEN = /\.open\s*\(/g;
const PATHLIB_WRITING_MODE =
  /^\s*(['"])[rbt]*[wax+][rbtwax+]*\1|\bmode\s*=\s*(['"])[rbt]*[wax+][rbtwax+]*\2/;
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

// The text of the statement before `index`: pathlib's receiver
// (`Path('…')`, `p`).
function statementBefore(code, index) {
  const start = Math.max(code.lastIndexOf(';', index), code.lastIndexOf('\n', index)) + 1;

  return code.slice(start, index);
}

// The first argument of each write call in `code` (for pathlib, the
// receiver), as text.
function writeCallTargets(code) {
  const targets = [];
  for (const match of code.matchAll(WRITE_CALL)) {
    const { content } = matchDelimited(code, match.index + match[0].length, '(', ')');
    const [first, rest] = splitFirstArgument(content);
    if (!OPEN_CALL.test(match[1]) || WRITING_MODE.test(rest)) targets.push(first);
  }
  for (const match of code.matchAll(PATHLIB_WRITE)) {
    targets.push(statementBefore(code, match.index));
  }
  for (const match of code.matchAll(PATHLIB_OPEN)) {
    const { content } = matchDelimited(code, match.index + match[0].length, '(', ')');
    if (PATHLIB_WRITING_MODE.test(content)) targets.push(statementBefore(code, match.index));
  }

  return targets;
}

const literalsOf = (text) => [...text.matchAll(STRING_LITERAL)].map((match) => match[2]);

const BARE_NAME = /^\s*[A-Za-z_$][\w$]*\s*$/;
const ARGV_READ = /\b(?:sys|process)\.argv\b/;

// The paths the write calls in `program` may write. A string-literal target
// writes that path (`certain`). A bare variable, or an expression with no
// string literal and no argv read (`Path(name)`, `os.path.join(root, name)`),
// may hold any string literal in the code; any other expression may build
// its path from its own literals, alone or joined by `/`
// (`os.path.join('src', 'x.ts')`), and, when it reads `sys.argv`/
// `process.argv`, from the words after the code (`possible`). The code's
// literals are read once, however many calls.
function writeCallCandidates({ code, argv }) {
  const certain = new Set();
  const possible = new Set();
  let throughVariable = false;
  for (const target of writeCallTargets(code)) {
    const literal = WHOLE_STRING_LITERAL.exec(target);
    if (literal !== null) certain.add(literal[2]);
    else if (BARE_NAME.test(target) || isLiteralFree(target)) throughVariable = true;
    else for (const candidate of expressionPaths(target, argv)) possible.add(candidate);
  }
  if (throughVariable) for (const literal of literalsOf(code)) possible.add(literal);

  return { certain, possible };
}

const isLiteralFree = (expression) =>
  literalsOf(expression).length === 0 && !ARGV_READ.test(expression);

// A literal after a variable (`root + '/__tests__/x.ts'`) starts with the
// slash that joins them, so it also counts without it. A candidate that is
// a tree folder itself (`os.path.join(root, 'src', name)`) names a file in
// it: the rest of the path is a variable.
function expressionPaths(expression, argv) {
  const own = literalsOf(expression);
  const joined = own.map((literal) => literal.replace(/^\/+/, ''));
  const candidates = [...own, ...joined, own.join('/')];
  const insideTree = candidates
    .map((candidate) => candidate.replace(/\/+$/, ''))
    .filter((candidate) => WRITE_GUARDED_TREES.has(candidate.split('/').pop().toLowerCase()))
    .map((candidate) => `${candidate}/_`);

  return [...candidates, ...insideTree, ...(ARGV_READ.test(expression) ? argv : [])];
}

function interpreterWrite(program, directories, rules) {
  const { certain, possible } = writeCallCandidates(program);

  return (
    firstGuardedWrite([...certain], directories, rules) ??
    firstGuardedWrite([...possible], directories, rules, { verb: 'may write' })
  );
}

// What `xargs` hands an in-place edit comes from its input, so it may be
// any file.
const XARGS_WRITE = { verb: 'writes', where: 'the files xargs reads from its input' };

// Whether the input `xargs` hands a cp/mv may be its destination: a
// `-t DIR` that holds the placeholder, or, with no `-t`, a last operand that
// holds it, or no placeholder at all (the input is appended last).
function inputMayBeDestination(parameters, placeholder) {
  const holdsInput = (word) => placeholder !== undefined && word.includes(placeholder);
  const { options } = splitOptions(parameters, readCopyMoveOption);
  const folder = options.findLast((option) => option.targetDirectory !== undefined);
  if (folder !== undefined) return holdsInput(folder.targetDirectory);
  const destination = parameters.at(-1);

  return placeholder === undefined || destination === undefined || holdsInput(destination);
}

// The cp/mv words with one `input` in place of the placeholder, or appended
// last when there is none.
const withXargsInput = (parameters, placeholder, input) =>
  placeholder === undefined
    ? [...parameters, input]
    : parameters.map((word) => word.replaceAll(placeholder, input));

// A cp/mv behind `xargs` writes into a folder its own text names only when
// the input cannot reach the destination; null when it may. The input may
// carry any name, so each source it fills counts once as a fixed marker
// (a plain file) and once as each tree folder's name (`ls | xargs -I{} cp
// -r {} .` may write `./src`). Those folder names are `named`; a plain cp
// cannot copy a folder, so `canCopyFolder` is false for it and its `named`
// targets count only where the text resolves them.
function xargsCopyMoveTargets(base, parameters, placeholder) {
  if (!COPY_MOVE_COMMANDS.has(base) || inputMayBeDestination(parameters, placeholder)) return null;
  const targetsFor = (inputs) =>
    inputs.flatMap((input) => copyMoveTargets(withXargsInput(parameters, placeholder, input)));
  const { options } = splitOptions(parameters, readCopyMoveOption);

  return {
    plain: targetsFor(['xargs-input']),
    named: targetsFor([...WRITE_GUARDED_TREES]),
    canCopyFolder: MOVE_COMMANDS.has(base) || options.some((option) => option.recursive),
  };
}

// Where one unwrapped command writes inside a tree, or null.
function commandWrite(
  { tokens, viaXargs, xargsPlaceholder: placeholder },
  { directories, rules, stdinScripts },
) {
  const base = basename(tokens[0]);
  const parameters = tokens.slice(1);
  const files = writtenFiles(base, parameters);
  const destination = COPY_MOVE_COMMANDS.has(base);
  if (files !== null && viaXargs) {
    const targets = xargsCopyMoveTargets(base, parameters, placeholder);
    if (targets === null) return XARGS_WRITE;

    return (
      firstGuardedWrite(targets.plain, directories, rules, { destination }) ??
      firstGuardedWrite(targets.named, directories, rules, {
        destination,
        resolvedOnly: !targets.canCopyFolder,
      })
    );
  }
  if (files !== null) return firstGuardedWrite(files, directories, rules, { destination });
  const program = interpreterProgramOf(base, parameters, stdinScripts);
  if (program === null) return null;

  return interpreterWrite(program, directories, rules);
}

const shellWriteFinding = (segment, { verb, where }) => ({
  kind: 'shellWrite',
  detail: `${segment.trim()} (${verb} ${where})`,
});

const isWriteCommand = (base) =>
  SED_COMMANDS.has(base) ||
  COPY_MOVE_COMMANDS.has(base) ||
  ['perl', 'tee'].includes(base) ||
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
      xargsPlaceholder: after.viaXargs ? after.xargsPlaceholder : command.xargsPlaceholder,
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
  const write = commandWrite(command, context);
  if (write === null) return null;

  return shellWriteFinding(context.segment, write);
}

// Where a segment's redirects write inside a tree, or null.
function redirectWrite(redirects, directories, rules) {
  if (!rules.checkWrites) return null;
  const targets = redirects.filter(isWritingRedirect).map((redirect) => redirect.target);

  return firstGuardedWrite(targets, directories, rules);
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
  const write = redirectWrite(redirects, directories, rules);
  if (write === null) return null;

  return shellWriteFinding(segment, write);
}

// ---- wait loops that scan the process table ----

// A `while` or `until` loop that lists processes for one of these jobs
// matches its own command line (the pattern is in it), so the wait never ends.
// The brackets of the `[j]est` trick are dropped first: the trick fails as soon
// as the word appears anywhere else in the same command line.
const WATCHED_JOB = /make\W+verify|check:all|jest|stryker|semgrep|xcodebuild/i;
const BRACKETS_AND_BACKSLASHES = /[[\]\\]/g;

const WAIT_LOOP_WORDS = new Set(['while', 'until']);
// `for` and `select` open a loop that ends in `done` too, so they are counted
// to keep each `done` paired with its opener; only a `while`/`until` is judged.
const LOOP_WORDS = new Set([...WAIT_LOOP_WORDS, 'for', 'select', 'done']);
const LOOP_WORD_SEARCH = /\b(?:while|until|for|select|done)\b/;

const PROCESS_LISTERS = new Set(['top', 'pstree']);
// `ps` named by pid (`-p`, `--pid`, `-q`) lists just those pids, so it is a pid
// wait, not a scan, unless it also selects every process (`-A`, `-e`, `-a`, `-x`, BSD
// `a`/`x`). The `p`/`q` ends its flag group or is glued to the pid (`-fp`, `-p123`),
// and a letter after a glued `-o` belongs to its value (`-opid,command`), not to a flag.
const PS_PID_OPTION = /^--pid(?:=|$)|^-[A-Za-z]*[pq](?:\d.*)?$/;
const PS_ALL_OPTION = /^-[A-NP-Za-np-z]*[Aeax]|^[axuUwW]*[ax][axuUwW]*$/;

const TEXT_FILTERS = new Set([
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'ack',
  'awk',
  'gawk',
  'sed',
  'gsed',
  '[',
  '[[',
  'test',
]);
// pgrep matches the full command line only with -f (any flag group holding it)
// or --full; without it a name match cannot see the loop's own command line.
// The rest of a group after a letter that takes a value (GNU and BSD: `-d`,
// `-F`, `-g`, `-G`, `-j`, `-M`, `-N`, `-P`, `-r`, `-s`, `-t`, `-u`, `-U`) is
// that value, so its `f` is no flag (`-ufred` is `-u fred`).
const FULL_COMMAND_OPTION = /^-(?:(?![dFgGjMNPrstuU])[A-Za-z])*f/;

function listsAllProcesses(base, parameters) {
  if (base !== 'ps') return false;

  return (
    !parameters.some((word) => PS_PID_OPTION.test(word)) ||
    parameters.some((word) => PS_ALL_OPTION.test(word))
  );
}

// The loop words that open the segment: lead-ins (`do`, `then`, a group
// opener) may stand before them (`do until …`).
function loopWordsOf(tokens) {
  const found = [];
  for (const token of tokens) {
    const word = token.replace(GROUP_OPENERS, '');
    if (LOOP_WORDS.has(word)) found.push(word);
    else if (!isLeadIn(word)) break;
  }

  return found;
}

// A shell's `-c` string and `eval`'s joined arguments are command text.
function scriptOf(base, tokens) {
  if (base === 'eval') return tokens.slice(1).join(' ');
  if (!SHELLS.has(base)) return undefined;
  const flagIndex = tokens.findIndex((token, index) => index > 0 && SHELL_COMMAND_FLAG.test(token));

  return flagIndex === -1 ? undefined : tokens[flagIndex + 1];
}

// Every command a segment runs, wrapper words stripped, and the commands of
// the script text its shell or `eval` runs.
function commandsOfTokens(tokens, depth) {
  const command = unwrap(tokens).tokens;
  if (command.length === 0) return [];
  const script = scriptOf(basename(command[0]), command);

  return script === undefined ? [command] : [command, ...scannedCommands(script, depth + 1)];
}

// Every command in a span's text, nested spans included.
function scannedCommands(text, depth = 0) {
  if (depth > 8) return [];
  const { segments, nested } = scanLevel(text);

  return [
    ...segments.flatMap((segment) => commandsOfTokens(words(segment), depth)),
    ...nested.flatMap((entry) => scannedCommands(entry.text, depth + 1)),
  ];
}

// What one command adds to a loop's process scan: whether it lists processes,
// and the first watched job its text names where it filters them.
function scanTraits(command) {
  const base = basename(command[0]);
  const parameters = command.slice(1);
  const matchesFullCommand =
    base === 'pgrep' &&
    parameters.some((word) => word === '--full' || FULL_COMMAND_OPTION.test(word));
  const watched = WATCHED_JOB.exec(parameters.join(' ').replace(BRACKETS_AND_BACKSLASHES, ''));
  const filters = matchesFullCommand || TEXT_FILTERS.has(base);

  return {
    lists: matchesFullCommand || PROCESS_LISTERS.has(base) || listsAllProcesses(base, parameters),
    job: filters && watched !== null ? watched[0] : undefined,
  };
}

// Tracks the `while`/`until` loops one line opens and closes, in the order
// its segments come, so a scan counts only inside the outermost wait loop
// that holds it, and only once that loop's `done` closes it: an unclosed
// `while` is a syntax error that never runs, so prose in a heredoc body
// (a commit message) that starts a line with `while` is not a loop. `open`
// holds one flag per open loop (true for while/until); `evidence` is the
// segment where the loop's scan first showed both a lister and a job name.
const newScanState = () => ({ lists: false, job: undefined, evidence: undefined });
const newWaitLoopWatch = () => ({ open: [], waiting: 0, ...newScanState() });

// Closes the innermost open loop; returns the finding when that was the
// outermost wait loop and its scan named a watched job.
function closeLoop(watch) {
  if (watch.open.pop() !== true) return null;
  watch.waiting--;
  if (watch.waiting > 0) return null;
  const { evidence, job } = watch;
  Object.assign(watch, newScanState());
  if (evidence === undefined) return null;

  return {
    kind: 'waitLoop',
    detail: `${evidence.trim()} (a wait loop scanning the process list for "${job}")`,
  };
}

function openLoop(watch, word) {
  const waits = WAIT_LOOP_WORDS.has(word);
  watch.open.push(waits);
  if (waits) watch.waiting++;
}

// Adds the commands of one segment (and of the spans in it) to the loop's scan.
function addToScan(watch, segment, spans, tokens) {
  const commands = [
    ...commandsOfTokens(tokens, 0),
    ...spans.flatMap((text) => scannedCommands(text, 1)),
  ];
  for (const command of commands) {
    const traits = scanTraits(command);
    watch.lists = watch.lists || traits.lists;
    watch.job = watch.job ?? traits.job;
  }
  if (watch.lists && watch.job !== undefined) watch.evidence = watch.evidence ?? segment;
}

// Feeds one segment of a line, with the text of its spans, to the watch.
// Returns a `waitLoop` finding when the segment closes a wait loop whose scan
// names a watched job.
function observeWaitLoops(watch, segment, spans) {
  if (watch.waiting === 0 && !LOOP_WORD_SEARCH.test(segment)) return null;
  const tokens = words(segment);
  const loopWords = loopWordsOf(tokens);
  for (const word of loopWords) {
    if (word !== 'done') openLoop(watch, word);
  }
  // A `done` closes before its segment is scanned: what feeds the loop
  // (`done < <(ps aux | grep jest)`) runs once, outside it.
  const closed = loopWords.filter((word) => word === 'done').map(() => closeLoop(watch));
  if (watch.waiting > 0) addToScan(watch, segment, spans, tokens);

  return closed.find((finding) => finding !== null) ?? null;
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
  const waitLoops = newWaitLoopWatch();
  let before = '';

  for (const [index, segment] of segments.entries()) {
    enterSubshells(location, opens[index]);
    const here = location.directories;
    directoriesAt.push(here);
    const segmentScripts = [];
    const finding =
      segmentFinding({
        segment,
        scripts: segmentScripts,
        stdinBodies: bodiesAt(index),
        spans: spansAt(index),
        directories: here,
        rules,
      }) ?? observeWaitLoops(waitLoops, segment, spansAt(index));
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
