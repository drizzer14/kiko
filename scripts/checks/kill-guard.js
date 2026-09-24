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

const REASON =
  'Blocked: pkill, killall, and pattern or process-group kills are banned in this repo ' +
  '(a pattern kill once restarted Orca and the iOS Simulator). Stop only a process ID you ' +
  'started yourself (kill <pid>), or let the tool timeout end a hung command.';

const DENY_JSON = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: REASON,
  },
});

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

// Finds the character matching the one that opened at `start - 1` (a `(`
// after `$`, or a backtick), honoring nested quotes and — for `(` — nested
// parens. Returns the text between the delimiters and the index of the
// closing delimiter.
function matchDelimited(text, start, open, close) {
  const state = { text, i: start, quote: null };
  let depth = 1;
  while (state.i < text.length) {
    if (state.quote) {
      stepQuoteInDelimited(state);
      continue;
    }
    const c = text[state.i];
    if (c === "'" || c === '"') {
      state.quote = c;
      state.i++;
      continue;
    }
    if (open && c === open) {
      depth++;
      state.i++;
      continue;
    }
    if (c === close) {
      depth--;
      state.i++;
      if (depth === 0) return { content: text.slice(start, state.i - 1), end: state.i - 1 };
      continue;
    }
    state.i++;
  }
  return { content: text.slice(start), end: text.length };
}

// ---- scanLevel: split one line into top-level simple commands ----

function consumeSubshell(context, start, open, close) {
  const { content, end } = matchDelimited(context.text, start, open, close);
  context.nested.push(content);
  context.buf += ' __SUBSHELL__ ';
  context.i = end + 1;
}

// A `$(...)` or backtick span expands (and so is recursed into) both at top
// level and inside double quotes — the two callers that share this check.
function tryConsumeSubshell(context) {
  const { text, i } = context;
  const c = text[i];
  if (c === '$' && text[i + 1] === '(') {
    consumeSubshell(context, i + 2, '(', ')');
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

function stepTopLevel(context) {
  const { text, i, n } = context;
  const c = text[i];
  if (c === '\\' && i + 1 < n) {
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
  if (consumeSeparator(context)) return;
  context.buf += c;
  context.i++;
}

// Splits one line of shell text into top-level simple-command segments at
// an unquoted `;`, `&&`, `||`, `|`, `&`, or newline, and collects the text
// of every `$(...)` / backtick span found — at top level or inside double
// quotes, where the shell still expands them (NOT inside single quotes,
// where it never does) — for the caller to recurse into.
function scanLevel(text) {
  const context = { text, i: 0, n: text.length, buf: '', quote: null, segments: [], nested: [] };
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
  return { segments: context.segments, nested: context.nested };
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

const PLAIN_PREFIXES = new Set(['sudo', 'nohup', 'command', 'exec']);
const SHELLS = new Set(['sh', 'bash', 'zsh']);

function unwrapEnv(tokens) {
  let t = tokens.slice(1);
  while (t.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]) || t[0].startsWith('-'))) {
    t = t.slice(1);
  }
  return t;
}

function unwrapTimeout(tokens) {
  let t = tokens.slice(1);
  while (t.length > 0 && t[0].startsWith('-')) t = t.slice(1);
  if (t.length > 0) t = t.slice(1); // the duration argument
  return t;
}

function unwrapXargs(tokens) {
  let t = tokens.slice(1);
  while (t.length > 0 && t[0].startsWith('-')) t = t.slice(1);
  return t;
}

// Strips leading wrapper commands (`sudo`, `env`, `nohup`, `timeout N`,
// `command`, `exec`, `xargs`) so the checks below see the command actually
// being run. Returns the remaining tokens and whether an `xargs` wrapper was
// stripped: a `kill`/`pkill`/`killall` reached through `xargs` takes its
// targets from the piped-in input — from a pattern, by construction — so it
// is denied unconditionally regardless of any static args that follow it.
function unwrap(tokens) {
  let viaXargs = false;
  let t = tokens;
  while (t.length > 0) {
    const base = basename(t[0]);
    if (PLAIN_PREFIXES.has(base)) {
      t = t.slice(1);
      continue;
    }
    if (base === 'env') {
      t = unwrapEnv(t);
      continue;
    }
    if (base === 'timeout') {
      t = unwrapTimeout(t);
      continue;
    }
    if (base === 'xargs') {
      viaXargs = true;
      t = unwrapXargs(t);
      continue;
    }
    break;
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

function segmentIsDangerous(segment, nested) {
  const tokens = words(segment);
  if (tokens.length === 0) return false;

  const { tokens: rest, viaXargs } = unwrap(tokens);
  if (rest.length === 0) return false;
  const base = basename(rest[0]);

  if (SHELLS.has(base)) {
    const cIndex = rest.indexOf('-c');
    if (cIndex !== -1 && cIndex + 1 < rest.length) nested.push(rest[cIndex + 1]);
    return false;
  }

  if (base === 'pkill' || base === 'killall') return true;

  if (base === 'kill') {
    if (viaXargs) return true;
    return killTargets(rest.slice(1)).some(isDangerousKillTarget);
  }

  return false;
}

// Scans one full line of shell text (recursing into `$(...)`, backticks, and
// a quoted `-c` argument to `sh`/`bash`/`zsh`) and returns true the moment
// anything dangerous is found anywhere in it.
function isDangerous(line, depth) {
  if (depth > 8) return false; // guards against pathological nesting
  const { segments, nested } = scanLevel(line);

  if (segments.some((segment) => segmentIsDangerous(segment, nested))) return true;
  return nested.some((n) => isDangerous(n, depth + 1));
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

  if (isDangerous(command, 0)) process.stdout.write(DENY_JSON);
}

try {
  const raw = require('node:fs').readFileSync(0, 'utf8');
  main(raw);
} catch {
  // Never break the Bash tool: any unexpected failure here falls through to
  // the unconditional exit 0 below with no output, i.e. allow.
}
process.exit(0);
