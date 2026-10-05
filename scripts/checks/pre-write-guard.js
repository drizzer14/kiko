#!/usr/bin/env node

// PreToolUse guard for Edit/Write/MultiEdit: rebuilds the file content an
// edit WOULD produce (the edit has not touched disk yet — that is the whole
// point of a PreToolUse hook) and denies the write when the rebuilt content
// introduces a known violation. See scripts/checks/pre-write-guard.sh for
// the wrapper that invokes this script and its own exit-code contract (0
// allow, 2 deny, anything else means the wrapper itself denies), and
// docs/superpowers/specs/2026-09-25-pre-write-guard-design.md for the full
// design.
//
// `rebuildContents` rebuilds Write/Edit/MultiEdit into the BEFORE/AFTER pair;
// `runSemgrep` runs ONE Semgrep process over the trees that can possibly
// matter (an empty BEFORE tree is skipped — it can have no findings, so
// scanning it would only waste the one process this hook is allowed);
// `runNodeChecks` runs the hand-rolled checkers Semgrep cannot express (the
// `NODE_RULES` rows) on AFTER first, and on BEFORE only the rules that found
// something in AFTER; `findingKeys`/`newFindings` diff the finding sets —
// Semgrep's and the Node checkers' combined — so only a finding the edit
// ADDS ever blocks the write, never one already on disk. A file on disk
// with git conflict markers never parses, so `conflictSides` rebuilds the
// two sides it stands between and both serve as BEFORE; content that keeps
// a conflict block is checked as its own two sides (`afterTreesFor`).
// `overrideState` recognizes a rule-specific `nosemgrep`/`kiko-override`
// comment that exempts a finding: a justified one (carrying `OVERRIDE(...)`)
// drops the finding from BOTH trees before the diff, and a bare one (naming
// the rule with no `OVERRIDE(...)`) never suppresses anything — Semgrep
// itself runs with `--disable-nosem`, so this file is the only place a
// suppression is ever honored. Fail closed throughout: the top-level
// try/catch below turns ANY throw — a malformed payload, a missing/unreadable rules file, an
// unexpected Semgrep or Node-checker exit code, a finding whose rule is
// missing its required `metadata.skill`, or an internal timeout killing a
// child — into a deny, never a silent allow.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');

const ROOT = path.resolve(__dirname, '..', '..');

const TIMEOUT_MILLISECONDS = Number(process.env.KIKO_PREWRITE_TIMEOUT_MS) || 25000;
const DEADLINE = Date.now() + TIMEOUT_MILLISECONDS;

// A later child gets only what is left of the guard's own budget, never a
// fresh full one, so the hook's 30 s ceiling holds. Floored at 1 because
// `spawn` treats 0 as "no timeout".
function remainingBudget() {
  return Math.max(1, DEADLINE - Date.now());
}

const EXCLUDED_PREFIXES = ['rules/fixtures/', 'node_modules/', 'ios/', 'android/'];

// Promise.all rejects on the FIRST rejection, which would let `run`'s
// `finally` remove the shared mkdtemp root while a sibling child is still
// reading from it. Waiting for every promise to settle, then throwing the
// first rejection in array order, keeps the tree alive until every reader
// is done.
async function allSettledOrThrowFirst(promises) {
  const settled = await Promise.allSettled(promises);
  const firstRejected = settled.find((result) => result.status === 'rejected');
  if (firstRejected) throw firstRejected.reason;
  return settled.map((result) => result.value);
}

// spawnSync cannot overlap two children, so this resolves with the same
// shape spawnSync returns (`error`, `status`, `signal`, `stdout`, `stderr`)
// and lets Semgrep and the Node checkers run concurrently under the same
// fail-closed checks. It settles once, on 'error' or 'close', because a
// process that fails to spawn may emit 'error' with no 'close'.
function spawnAsync(command, args, options) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn(command, args, options);
    } catch (error) {
      settle({ error, status: null, signal: null, stdout: '', stderr: '' });
      return;
    }

    // Decode as a UTF-8 stream: per-chunk decoding turns a multibyte
    // character split across two `data` events into U+FFFD, so the same
    // text could read differently BEFORE vs AFTER and look like a new
    // finding.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      settle({ error, status: null, signal: null, stdout, stderr });
    });
    child.on('close', (code, signal) => {
      settle({ error: null, status: code, signal, stdout, stderr });
    });
  });
}

// Reads the hook's tool_input JSON payload. Throws (SyntaxError) on
// malformed JSON — the caller's fail-closed try/catch turns that into a
// deny, per the spec's "Fail closed" section.
function readPayload(text) {
  const payload = JSON.parse(text);
  const toolInput = payload.tool_input || {};
  return {
    toolName: payload.tool_name,
    filePath: toolInput.file_path,
    toolInput,
  };
}

// Walks up from `candidate` to the nearest existing ancestor, realpath's
// that ancestor (resolving any symlink in it), then rejoins the
// not-yet-existing tail — this is what lets a Write to a brand-new file
// (which cannot itself be realpath'd) still resolve through a symlinked
// parent directory correctly.
function resolveNearestExisting(candidate) {
  let current = candidate;
  const tail = [];
  while (true) {
    try {
      const real = fs.realpathSync(current);
      return tail.length === 0 ? real : path.join(real, ...tail);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

// Resolves both `filePath` and `projectDirectory` with realpath (a
// symlinked project directory, or a file_path reached through one, must not
// be mistaken for "outside the project") before relativizing.
// Returns null when `filePath` sits outside `projectDirectory`. Fails
// closed on any OTHER realpath failure (an unresolvable
// `CLAUDE_PROJECT_DIR`, or EACCES/ELOOP/ENOTDIR on `filePath`) by letting it
// throw — `resolveNearestExisting` already swallows the one benign case
// (ENOENT on a not-yet-created file, resolved through its nearest existing
// parent instead), so anything that still reaches here is a real error, not
// "outside the project", and the caller's fail-closed try/catch turns it
// into a deny.
function relativeInProject(filePath, projectDirectory) {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;

  const resolvedProjectDirectory = fs.realpathSync(projectDirectory);
  const resolvedFilePath = resolveNearestExisting(path.resolve(filePath));

  const relative = path.relative(resolvedProjectDirectory, resolvedFilePath);
  const isOutsideProjectDirectory = relative === '..' || relative.startsWith(`..${path.sep}`);
  if (relative === '' || isOutsideProjectDirectory) return null;
  return relative;
}

// Only .ts/.tsx files are in scope, and never a fixture, a native
// generated tree, or node_modules — see the spec's "File scope" section.
function isInScope(relativePath) {
  if (!/\.(ts|tsx)$/.test(relativePath)) return false;
  const posixRelativePath = relativePath.split(path.sep).join('/');
  return !EXCLUDED_PREFIXES.some((prefix) => posixRelativePath.startsWith(prefix));
}

// Thrown by rebuildContents when an old_string cannot be found verbatim in
// the running text — for example after a curly-quote or CRLF normalization
// changed the on-disk bytes since the agent last read them (the caller's
// fail-closed try/catch turns this into a deny that tells the agent to
// re-read the file, never an unchecked write).
class RebuildError extends Error {}

// Applies one old_string/new_string edit to sourceText, exactly as the real
// Edit tool would: every occurrence when replaceAll is true, otherwise only
// the first. Deliberately never uses String.prototype.replace with a string
// replacement argument — a literal '$&' (or '$1', '$`', etc.) in newString
// has special meaning to that overload and would silently stop being
// literal. split/join and indexOf/slice below only ever treat newString as
// a plain literal string.
function applySingleEdit(sourceText, oldString, newString, replaceAll) {
  if (!sourceText.includes(oldString)) {
    throw new RebuildError(
      'old_string was not found in the file. The match is byte-exact: a curly quote ' +
        "(\u2019 U+2019 vs ' U+0027), a CRLF vs LF line ending, tabs vs spaces, or a change " +
        'since your last read all break it, so re-read the file and copy old_string from ' +
        'its exact current bytes; retrying the same old_string fails the same way.',
    );
  }
  if (replaceAll) {
    return sourceText.split(oldString).join(newString);
  }
  const matchIndex = sourceText.indexOf(oldString);
  return (
    sourceText.slice(0, matchIndex) + newString + sourceText.slice(matchIndex + oldString.length)
  );
}

// Rebuilds the AFTER content per the spec's "Rebuilding the proposed
// content" section:
// - Write: AFTER is toolInput.content verbatim; beforeText is unused.
// - Edit: BEFORE with one old_string/new_string edit applied.
// - MultiEdit: BEFORE with toolInput.edits applied in array order, each one
//   built on the running result of the previous edit (reduce, not a fresh
//   apply against the original beforeText every time) — the same order the
//   real MultiEdit tool applies them in.
// Throws RebuildError (via applySingleEdit) when an old_string is not found
// verbatim; the caller's fail-closed try/catch turns that into a deny.
function rebuildContents(toolName, toolInput, beforeText) {
  if (toolName === 'Write') {
    return toolInput.content ?? '';
  }
  if (toolName === 'Edit') {
    return applySingleEdit(
      beforeText,
      toolInput.old_string,
      toolInput.new_string,
      Boolean(toolInput.replace_all),
    );
  }
  if (toolName === 'MultiEdit') {
    return (toolInput.edits || []).reduce(
      (runningText, edit) =>
        applySingleEdit(runningText, edit.old_string, edit.new_string, Boolean(edit.replace_all)),
      beforeText,
    );
  }
  throw new RebuildError(`unsupported tool_name: ${toolName}`);
}

// Git writes each conflict marker as seven characters at the start of a
// line, then a space and a label or the end of the line (`\r` too, in a
// CRLF file).
const CONFLICT_OURS_MARKER = /^<{7}(?: |\r?$)/;
const CONFLICT_BASE_MARKER = /^\|{7}(?: |\r?$)/;
const CONFLICT_SEPARATOR_MARKER = /^={7}\r?$/;
const CONFLICT_THEIRS_MARKER = /^>{7}(?: |\r?$)/;

// Per section of a conflicted file: the markers that end it, each with the
// section that follows, and the sides that keep its lines. A diff3 base
// section is kept by neither side, since the merge result can keep neither
// side's copy of it.
const CONFLICT_SECTIONS = {
  shared: { transitions: [[CONFLICT_OURS_MARKER, 'ours']], keptBy: ['ours', 'theirs'] },
  ours: {
    transitions: [
      [CONFLICT_BASE_MARKER, 'base'],
      [CONFLICT_SEPARATOR_MARKER, 'theirs'],
    ],
    keptBy: ['ours'],
  },
  base: { transitions: [[CONFLICT_SEPARATOR_MARKER, 'theirs']], keptBy: [] },
  theirs: { transitions: [[CONFLICT_THEIRS_MARKER, 'shared']], keptBy: ['theirs'] },
};

// Rebuilds the two files a merge conflict stands between: `ours` keeps the
// first section of every conflict block, `theirs` the last one.
// `lineNumbers[side][index]` is the 1-based line in `text` that the side's
// line `index + 1` came from, so a finding on a side can name its real
// line. Only a complete block (ours marker, separator, theirs marker, in
// that order) counts in `blockCount`, so one stray marker-like line never
// makes a file read as conflicted.
function conflictSides(text) {
  const sides = { ours: [], theirs: [] };
  const lineNumbers = { ours: [], theirs: [] };
  let section = 'shared';
  let blockCount = 0;

  text.split('\n').forEach((line, index) => {
    const { transitions, keptBy } = CONFLICT_SECTIONS[section];
    const transition = transitions.find(([marker]) => marker.test(line));

    if (transition) {
      if (section === 'theirs') blockCount += 1;
      section = transition[1];
      return;
    }

    for (const side of keptBy) {
      sides[side].push(line);
      lineNumbers[side].push(index + 1);
    }
  });

  return { blockCount, ours: sides.ours.join('\n'), theirs: sides.theirs.join('\n'), lineNumbers };
}

// The trees an AFTER finding is compared against to tell a new finding from
// one already on disk. A conflicted file never parses, so it is replaced by
// the two sides it stands between.
function baselineTextsFor(beforeText, beforeSides) {
  if (beforeSides.blockCount > 0) {
    return { ours: beforeSides.ours, theirs: beforeSides.theirs };
  }

  return { before: beforeText };
}

// The trees that stand for the content the edit would write. A step that
// keeps a conflict block in a conflicted file cannot parse as a whole, so
// it is checked as its two rebuilt sides, each against the union of BOTH
// sides on disk: a violation it adds would otherwise sit on both sides of
// the next step's baseline and pass the final resolution unseen. Comparing
// a side only with its own old side would deny a block resolved to the
// other side. A side the edit left unchanged has exactly its old side's
// findings, all already in the baseline, so it is not scanned again.
// `sameSide` names the old side whose parse state a new side is judged by.
function afterTreesFor(afterText, baselineTexts) {
  const afterSides = conflictSides(afterText);

  if (!('ours' in baselineTexts) || afterSides.blockCount === 0) {
    return [{ tree: 'after', text: afterText, lineNumbers: null, sameSide: null }];
  }

  return ['ours', 'theirs']
    .map((side) => ({
      tree: `after-${side}`,
      text: afterSides[side],
      lineNumbers: afterSides.lineNumbers[side],
      sameSide: side,
    }))
    .filter((afterTree) => afterTree.text !== baselineTexts[afterTree.sameSide]);
}

// Mirrors every tree (the baselines and AFTER) into one mkdtemp root, each
// under its own repo-relative path, so a path-keyed Semgrep rule still
// evaluates correctly when pointed at the scratch tree instead of the real
// one (see the spec's "Rebuilding the proposed content" section).
function writeMirroredTrees(relativePath, textsByTree) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-prewrite-'));

  for (const [tree, text] of Object.entries(textsByTree)) {
    const treePath = path.join(temporaryRoot, tree, relativePath);
    fs.mkdirSync(path.dirname(treePath), { recursive: true });
    fs.writeFileSync(treePath, text);
  }

  return temporaryRoot;
}

// This Semgrep version reports a rule from rules/semgrep-prewrite.yml as
// `rules.<rule-id>`; a rule id is never dotted, so the last segment is the
// id every other place (fixtures, NODE_RULES, the deny reason) uses.
function stripConfigPathPrefix(checkId) {
  const segments = checkId.split('.');
  return segments[segments.length - 1];
}

// `matchedText` is sliced from the mirrored file because this Semgrep
// version reports `extra.lines` as the literal "requires login". The
// offsets are UTF-8 BYTE offsets, so the slice happens on a Buffer: a
// string slice misaligns after any non-ASCII byte. A result without
// `metadata.skill` throws, because a deny must point the agent at the
// rule's skill section.
function buildFinding(temporaryRoot, result) {
  const tree = result.path.split('/')[0];
  const sourceBuffer = fs.readFileSync(path.join(temporaryRoot, result.path));
  const matchedText = sourceBuffer
    .subarray(result.start.offset, result.end.offset)
    .toString('utf8');
  const metadata = result.extra?.metadata || {};
  if (!metadata.skill) {
    throw new Error(`semgrep rule ${result.check_id} is missing metadata.skill`);
  }
  return {
    ruleId: stripConfigPathPrefix(result.check_id),
    tree,
    line: result.start.line,
    matchedText,
    fix: metadata.fix,
    skill: metadata.skill,
    projectCheck: 'check:security',
  };
}

// Semgrep's own names for "this target did not parse": a plain-string
// `type`, or the first element of an array one (`["PartialParsing", [...]]`).
const PARSE_ERROR_TYPES = new Set([
  'Syntax error',
  'Lexical error',
  'Other syntax error',
  'PartialParsing',
]);

const TREE_LABELS = {
  after: 'the content this edit would write',
  'after-ours': 'the ours side of the content this edit would write',
  'after-theirs': 'the theirs side of the content this edit would write',
  before: 'the file as it is on disk',
};

function isParseError(semgrepError) {
  const typeName = Array.isArray(semgrepError.type) ? semgrepError.type[0] : semgrepError.type;

  return PARSE_ERROR_TYPES.has(typeName);
}

function treeOfSemgrepPath(semgrepPath) {
  return String(semgrepPath || '').split('/')[0];
}

// A parse failure is almost always a half-applied multi-part change, which
// an agent fixes only if it knows where the file broke — so the reason names
// each file:line and Semgrep's own message, not just "could not check".
// While the on-disk file fails, every write to it is denied, so the "make
// each edit complete" advice would send the agent the wrong way even when
// the new content fails too. `lineNumbersByTree` maps a rebuilt side's line
// back to the line in the content the edit would write.
function describeParseErrors(parseErrors, lineNumbersByTree = {}) {
  const locations = parseErrors.map((semgrepError) => {
    const [tree, ...pathParts] = String(semgrepError.path || '').split('/');
    const arrayLocation = Array.isArray(semgrepError.type) ? semgrepError.type[1]?.[0] : undefined;
    const sideLine = (semgrepError.spans?.[0] ?? arrayLocation)?.start?.line;
    const line = lineNumbersByTree[tree]?.[sideLine - 1] ?? sideLine ?? '?';
    const label = TREE_LABELS[tree] || tree;

    return `${pathParts.join('/')}:${line} (${label}): ${normalizeText(semgrepError.message || '')}`;
  });
  const beforeFailed = parseErrors.some(
    (semgrepError) => treeOfSemgrepPath(semgrepError.path) === 'before',
  );
  const advice = beforeFailed
    ? 'The file on disk already does not parse, so the guard cannot tell a new violation ' +
      'from one already there, and denies every write to it until the file on disk parses ' +
      'again. Ask the user how to repair it.'
    : 'Make each edit syntactically complete on its own; for a change that spans several ' +
      'places, use MultiEdit so every part lands in one checked write.';

  return `the file does not parse, so no rule could run on it — ${locations.join('; ')}. ${advice}`;
}

// Semgrep runs with cwd = temporaryRoot and targets relative to it
// ('after/<rel>'), so a path-keyed rule (rule 9's nav-layer allowlist,
// rule 12's screen folders) sees the real repo-relative path, and both
// trees fit in one process. `run` overlaps this with the AFTER-tree Node
// checks, since both only read the already-written trees. Every sign that
// Semgrep did not check the whole target throws rather than returning an
// empty result: an unreadable rules file, an exit code other than 0/1, a
// non-empty `errors[]`, a target missing from `paths.scanned` (a
// `paths.exclude` or `.semgrepignore` skip), or a timeout kill. The one
// exception is a parse error in a `tolerantTrees` tree (a rebuilt side of a
// merge conflict, which the merge itself may have left unparseable): it is
// returned in `unparsedTrees` (tree -> its parse errors) for the caller to
// judge, not thrown.
async function runSemgrep(temporaryRoot, relativePath, trees, tolerantTrees) {
  const rulesPath =
    process.env.KIKO_PREWRITE_RULES || path.join(ROOT, 'rules', 'semgrep-prewrite.yml');
  fs.accessSync(rulesPath, fs.constants.R_OK);

  const semgrepBinary = process.env.KIKO_PREWRITE_SEMGREP_BIN || 'semgrep';
  const posixRelativePath = relativePath.split(path.sep).join('/');
  const targets = trees.map((tree) => `${tree}/${posixRelativePath}`);

  // Semgrep's own per-rule default (5 s) would turn a rule that is merely
  // slow under load into an errors[] Timeout, and so a random "could not
  // check" deny. It gets the guard's whole remaining budget instead, in
  // whole seconds (floored at 1, since 0 means "no limit" to Semgrep); the
  // spawn `timeout` below still ends the child at the guard's own deadline.
  const ruleTimeoutSeconds = Math.max(1, Math.floor(remainingBudget() / 1000));
  const childResult = await spawnAsync(
    semgrepBinary,
    [
      '--metrics',
      'off',
      '--quiet',
      '--json',
      '--disable-nosem',
      '--timeout',
      String(ruleTimeoutSeconds),
      '--config',
      rulesPath,
      ...targets,
    ],
    {
      cwd: temporaryRoot,
      timeout: remainingBudget(),
    },
  );

  if (childResult.error) throw childResult.error;
  if (childResult.signal !== null) {
    throw new Error(`semgrep timed out (signal ${childResult.signal})`);
  }
  if (childResult.status !== 0 && childResult.status !== 1) {
    throw new Error(`semgrep exited ${childResult.status}`);
  }

  const parsed = JSON.parse(childResult.stdout);
  const errors = parsed.errors || [];
  const isTolerated = (semgrepError) =>
    isParseError(semgrepError) && tolerantTrees.includes(treeOfSemgrepPath(semgrepError.path));
  const fatalParseErrors = errors.filter(
    (semgrepError) => isParseError(semgrepError) && !isTolerated(semgrepError),
  );
  if (fatalParseErrors.length > 0) {
    throw new Error(describeParseErrors(fatalParseErrors));
  }
  const otherErrors = errors.filter((semgrepError) => !isParseError(semgrepError));
  if (otherErrors.length > 0) {
    throw new Error(
      `semgrep reported ${otherErrors.length} error(s): ${JSON.stringify(otherErrors)}`,
    );
  }

  const scannedTargets = new Set(parsed.paths?.scanned || []);
  const unscannedTarget = targets.find((target) => !scannedTargets.has(target));
  if (unscannedTarget) {
    throw new Error(`semgrep did not scan ${unscannedTarget}`);
  }

  const unparsedTrees = new Map();
  for (const semgrepError of errors.filter(isTolerated)) {
    const tree = treeOfSemgrepPath(semgrepError.path);
    unparsedTrees.set(tree, [...(unparsedTrees.get(tree) || []), semgrepError]);
  }
  const findings = (parsed.results || []).map((result) => buildFinding(temporaryRoot, result));

  return { findings, unparsedTrees };
}

// Spawns one Node checker script against one mirrored file (the `.ts`
// one-component-per-file checker runs in-process instead). Exit 0 is clean,
// 1 means findings, anything else throws. A crashing checker can also exit
// 1, so exit 1 with any stderr output, or with no parseable finding, throws
// too — otherwise a broken checker would silently disable its own rule.
async function runSpawnedNodeChecker(scriptName, filePath, parseOutput) {
  const nodeBinary = process.env.KIKO_PREWRITE_NODE_BIN || 'node';
  const scriptPath = path.join(ROOT, 'scripts', 'checks', scriptName);

  const childResult = await spawnAsync(nodeBinary, [scriptPath, filePath], {
    timeout: remainingBudget(),
  });

  if (childResult.error) throw childResult.error;
  if (childResult.signal !== null) {
    throw new Error(`${scriptName} timed out (signal ${childResult.signal})`);
  }
  if (childResult.stderr) {
    throw new Error(`${scriptName} wrote to stderr: ${childResult.stderr}`);
  }
  if (childResult.status !== 0 && childResult.status !== 1) {
    throw new Error(`${scriptName} exited ${childResult.status}`);
  }
  if (childResult.status === 0) return [];

  const findings = parseOutput(childResult.stdout);
  if (findings.length === 0) {
    throw new Error(`${scriptName} exited 1 but reported no findings`);
  }
  return findings;
}

// import-order.js's plain-checker output (no --write) is `${file}:\n` then
// one `  ${violation}\n` line per violation — see its own `runCli`. The
// checker reports no line number of its own (it flags the leading import
// HEADER as a whole, not one statement), so every finding here is pinned to
// line 1; the violation text itself (with the 2-space indent stripped) is
// the finding's matched text.
function parseImportOrderCheckerOutput(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('  '))
    .map((line) => ({ line: 1, matchedText: line.slice(2) }));
}

// full-word-identifiers.js's output is one `<path>:<line>: \`<name>\` —
// abbreviated word \`<word>\` (write the full word)` line per violation —
// see its own `findViolations`. `<path>` is whatever argv this call passed
// (the mirrored temp path here), which can itself contain colons on some
// systems, so the pattern anchors on the LAST `:<digits>: \`` run rather than
// splitting on the first colon.
const FULL_WORD_IDENTIFIER_VIOLATION_LINE = /:(\d+): `([^`]+)`/;

function parseFullWordIdentifiersCheckerOutput(stdout) {
  const findings = [];
  for (const line of stdout.split('\n')) {
    const match = FULL_WORD_IDENTIFIER_VIOLATION_LINE.exec(line);
    if (match) {
      findings.push({ line: Number(match[1]), matchedText: match[2] });
    }
  }
  return findings;
}

// blank-line-separation.js's output is one `<path>:<line>: <kind>:
// <statement>` line per violation — see its own `findViolations`. `<kind>`
// is always one bare lowercase word (`return`/`if`/`for`/`while`/`jsx`), so
// the pattern anchors on the LAST `:<digits>: <word>: ` run for the same
// path-can-contain-colons reason as the full-word-identifiers pattern above.
// `matchedText` is the KIND alone: the new-findings-only diff keys on
// (ruleId, matchedText, occurrence), so keying it on the full statement text
// would read editing the TEXT of an already-unseparated statement (renaming
// a variable it returns, say) as a brand-new violation. The full statement
// text is kept separately as `detailText`, purely for the deny reason a
// human reads.
const BLANK_LINE_SEPARATION_VIOLATION_LINE = /:(\d+): (\w+): (.*)$/;

function parseBlankLineSeparationCheckerOutput(stdout) {
  const findings = [];
  for (const line of stdout.split('\n')) {
    const match = BLANK_LINE_SEPARATION_VIOLATION_LINE.exec(line);
    if (match) {
      findings.push({ line: Number(match[1]), matchedText: match[2], detailText: match[3] });
    }
  }
  return findings;
}

// screen-imports.js's output is one `<path>:<line>: <specifier>` line per
// violation — see its own `findViolations`. `<path>` can itself contain
// colons on some systems, so the pattern anchors on the LAST `:<digits>: `
// run, the same convention as the two parsers above.
const SCREEN_IMPORTS_VIOLATION_LINE = /:(\d+): (.+)$/;

function parseScreenImportsCheckerOutput(stdout) {
  const findings = [];
  for (const line of stdout.split('\n')) {
    const match = SCREEN_IMPORTS_VIOLATION_LINE.exec(line);
    if (match) {
      findings.push({ line: Number(match[1]), matchedText: match[2] });
    }
  }
  return findings;
}

// feature-imports.js's output is one `<path>:<line>: <specifier> [<kind>] ->
// <suggestion>` line per violation — see its own `runCheckMode`. Anchored on
// the LAST `:<digits>: ` run like the parsers above. `matchedText` leaves
// the suggestion out: it names the target feature's barrel, which an
// unrelated edit (a moved importer) can change without adding a finding.
// The whole line stays the `detailText` a human reads.
const FEATURE_IMPORTS_VIOLATION_LINE = /:(\d+): ((\S+ \[[a-z-]+\]) -> .*)$/;

function parseFeatureImportsCheckerOutput(stdout) {
  const findings = [];
  for (const line of stdout.split('\n')) {
    const match = FEATURE_IMPORTS_VIOLATION_LINE.exec(line);
    if (match) {
      findings.push({ line: Number(match[1]), matchedText: match[3], detailText: match[2] });
    }
  }
  return findings;
}

// plural-count.js's output is one `<path>:<line>: t('<key>') has no count`
// line per violation — see its own `runCli`. Anchored on the LAST
// `:<digits>: t('` run like the parsers above. `matchedText` is the call
// alone, with no line number, so moving an existing call is not a new finding.
const PLURAL_COUNT_VIOLATION_LINE = /:(\d+): (t\('[^']*'\)) has no count$/;

function parsePluralCountCheckerOutput(stdout) {
  const findings = [];
  for (const line of stdout.split('\n')) {
    const match = PLURAL_COUNT_VIOLATION_LINE.exec(line);
    if (match) {
      findings.push({ line: Number(match[1]), matchedText: match[2] });
    }
  }
  return findings;
}

// comment-line-width.js's output is one `<path>:<line>: <columns> columns: <comment text>` line
// per violation — see its own `runCli`. The comment text is the trimmed comment(s) on that line
// and the whole of `matchedText`: it holds no line number and no code, so moving a long comment
// or renaming code beside it is not a new finding, while rewording it is. The column count rides
// in `detailText` for the human.
const COMMENT_LINE_WIDTH_VIOLATION_LINE = /:(\d+): (\d+) columns: (.*)$/;

function parseCommentLineWidthCheckerOutput(stdout) {
  const findings = [];
  for (const line of stdout.split('\n')) {
    const match = COMMENT_LINE_WIDTH_VIOLATION_LINE.exec(line);
    if (match) {
      findings.push({
        line: Number(match[1]),
        matchedText: match[3],
        detailText: `${match[2]} columns: ${match[3]}`,
      });
    }
  }
  return findings;
}

// Finds the 1-based line of the `export` declaration that introduces
// `name` — tried, in order, against every shape
// one-component-per-file.ts's own `classifySlice` recognizes an EXPORTED
// component under (`export [default] function/const Name`, `export default
// memo(Name);`, `export default Name;`, a named export list containing
// Name), falling back to the first line mentioning `name` as a whole word,
// then to line 1 — so a finding always has a real, reproducible line even
// for a shape this best-effort search does not special-case.
function exportDeclarationLine(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declarationPatterns = [
    new RegExp(`^export\\s+(?:default\\s+)?(?:function|const)\\s+${escapedName}\\b`),
    new RegExp(`^export\\s+default\\s+memo\\(\\s*${escapedName}\\s*\\)\\s*;`),
    new RegExp(`^export\\s+default\\s+${escapedName}\\s*;`),
    new RegExp(`^export\\s*\\{[^}]*\\b${escapedName}\\b[^}]*\\}\\s*;`),
  ];
  const lines = source.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    if (declarationPatterns.some((pattern) => pattern.test(lines[index]))) {
      return index + 1;
    }
  }

  const wordBoundaryPattern = new RegExp(`\\b${escapedName}\\b`);
  const fallbackIndex = lines.findIndex((line) => wordBoundaryPattern.test(line));
  return fallbackIndex === -1 ? 1 : fallbackIndex + 1;
}

// A worker thread inherits the guard's own `--experimental-strip-types`,
// which loading the `.ts` module needs.
const ONE_COMPONENT_WORKER_SOURCE = `
const fs = require('node:fs');
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.moduleUrl).then(({ exportedComponentNames }) => {
  parentPort.postMessage(exportedComponentNames(fs.readFileSync(workerData.filePath, 'utf8')));
});
`;

// Runs `exportedComponentNames` in a worker thread: on a large file it takes
// over a second, and the two rebuilt sides of a conflict would otherwise
// queue on the guard's own thread instead of overlapping. The worker is
// ended at the guard's deadline like a spawned child; any other way it
// stops without an answer rejects.
function exportedComponentNamesInWorker(moduleUrl, filePath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(ONE_COMPONENT_WORKER_SOURCE, {
      eval: true,
      workerData: { moduleUrl, filePath },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('one-component-per-file.ts timed out'));
    }, remainingBudget());
    const settle = (callback) => (value) => {
      clearTimeout(timer);
      callback(value);
    };

    worker.once(
      'message',
      settle((names) => {
        resolve(names);
        worker.terminate();
      }),
    );
    worker.once('error', settle(reject));
    worker.once(
      'exit',
      settle((code) => reject(new Error(`one-component-per-file.ts worker exited ${code}`))),
    );
  });
}

// Runs one-component-per-file.ts's `exportedComponentNames` (never spawned
// — it is a `.ts` module, not a standalone CLI, and this is the same checker
// the "one exported component per .tsx" Jest invariant calls directly) and
// reports one finding per exported component name AFTER the first, at that
// name's own export declaration line. `pathToFileURL` is required here: a
// bare absolute path is not a valid ES module specifier on every platform
// this could run on.
async function runOneComponentPerFileChecker(filePath) {
  const moduleUrl = pathToFileURL(
    path.join(ROOT, 'scripts', 'checks', 'one-component-per-file.ts'),
  ).href;
  const names = await exportedComponentNamesInWorker(moduleUrl, filePath);
  const source = fs.readFileSync(filePath, 'utf8');

  return names
    .slice(1)
    .map((name) => ({ line: exportDeclarationLine(source, name), matchedText: name }));
}

// One row per Node-checker rule: the extensions it applies to, how to run
// it, and the fix/skill pair the deny reason cites (the Node-check analog
// of a Semgrep rule's `metadata.fix`/`metadata.skill`). `projectCheck` is
// the project-wide gate the deny reason names for a pre-existing finding:
// check:security runs only Semgrep, so it never sees a Node rule.
const NODE_RULES = [
  {
    ruleId: 'kiko-import-order',
    extensions: ['.ts', '.tsx'],
    fix: 'run `node scripts/checks/import-order.js --write <file>`, or reorder the groups by hand: external, then ../**, then ./**, each ascending by ending-line length; merge two imports of one specifier into one by hand, with an inline `type` modifier on each type name',
    skill: 'kiko-code-style › Import ordering and `import type`',
    projectCheck: 'check:import-order',
    run: (filePath) =>
      runSpawnedNodeChecker('import-order.js', filePath, parseImportOrderCheckerOutput),
  },
  {
    ruleId: 'kiko-full-word-identifiers',
    extensions: ['.ts', '.tsx'],
    fix: 'spell out the abbreviated word in full',
    skill: 'kiko-code-style › Full words in identifiers',
    projectCheck: 'check:full-word-identifiers',
    run: (filePath) =>
      runSpawnedNodeChecker(
        'full-word-identifiers.js',
        filePath,
        parseFullWordIdentifiersCheckerOutput,
      ),
  },
  {
    ruleId: 'kiko-one-component-per-file',
    extensions: ['.tsx'],
    fix: 'move every exported component but the first into its own file',
    skill: 'kiko-code-style › One component per file, each in its own folder',
    projectCheck: '__tests__/one-component-per-file.test.ts',
    run: (filePath) => runOneComponentPerFileChecker(filePath),
  },
  {
    ruleId: 'kiko-blank-line-separation',
    extensions: ['.ts', '.tsx'],
    fix: 'run `node scripts/checks/blank-line-separation.js --write <file>`, or insert a blank line by hand above the return/if/for/while statement (or JSX sibling), unless it is the first statement of its block or already preceded by a comment',
    skill:
      'kiko-code-style › Blank lines before statement blocks / Blank line between adjacent JSX sibling nodes',
    projectCheck: 'check:blank-line-separation',
    run: (filePath) =>
      runSpawnedNodeChecker(
        'blank-line-separation.js',
        filePath,
        parseBlankLineSeparationCheckerOutput,
      ),
  },
  {
    ruleId: 'kiko-no-cross-screen-import',
    extensions: ['.ts', '.tsx'],
    fix: 'move the shared module out of src/screens/ into src/design-system/components/ (a UI component) or the owning domain module (a hook/util), then import it from there — see the FieldTrigger precedent; if the module is really screen-owned, move the IMPORTER instead',
    skill: 'kiko-design-system › Component set',
    projectCheck: 'check:screen-imports',
    run: (filePath) =>
      runSpawnedNodeChecker('screen-imports.js', filePath, parseScreenImportsCheckerOutput),
  },
  {
    ruleId: 'kiko-feature-imports',
    extensions: ['.ts', '.tsx'],
    fix: 'import across features through the barrel: @kiko/<feature> (or ../<sibling> in one non-screen container); relative paths only inside one feature',
    skill: 'kiko-code-style › Feature imports (B2)',
    projectCheck: 'check:feature-imports',
    run: (filePath) =>
      runSpawnedNodeChecker('feature-imports.js', filePath, parseFeatureImportsCheckerOutput),
  },
  {
    ruleId: 'kiko-plural-key-needs-count',
    extensions: ['.ts', '.tsx'],
    fix: 'pass { count } — i18next picks _one/_few/_many/_other from it',
    skill: 'kiko-translator › A plural key is always called with `count`',
    projectCheck: '__tests__/plural-count.test.ts',
    run: (filePath) =>
      runSpawnedNodeChecker('plural-count.js', filePath, parsePluralCountCheckerOutput),
  },
  {
    ruleId: 'kiko-comment-line-width',
    extensions: ['.ts', '.tsx'],
    fix: 'Wrap the comment at 100 columns.',
    skill: 'kiko-code-style › Wrap comments at 100 columns',
    projectCheck: 'check:comment-line-width',
    // No override comment can stand in for wrapping a comment: neither the project-wide check
    // nor guard-replay would catch an override that waved a long comment through.
    overridable: false,
    run: (filePath) =>
      runSpawnedNodeChecker('comment-line-width.js', filePath, parseCommentLineWidthCheckerOutput),
  },
];

// Runs the NODE_RULES rows for this extension against ONE tree (only the
// rows in `ruleIds`, when given). `run` calls it for AFTER first and for
// the baselines only when AFTER has findings, since a clean AFTER cannot
// add a finding. The rules start together (each only reads the same
// mirrored file) and settle through allSettledOrThrowFirst; findings stay
// in NODE_RULES order, not completion order, so `findingKeys`' occurrence
// numbering is stable.
async function runNodeChecks(temporaryRoot, relativePath, tree, ruleIds) {
  const filePath = path.join(temporaryRoot, tree, relativePath);
  const extension = path.extname(relativePath);
  const applicableRules = NODE_RULES.filter(
    (rule) => rule.extensions.includes(extension) && (!ruleIds || ruleIds.has(rule.ruleId)),
  );

  const resultsByRule = await allSettledOrThrowFirst(
    applicableRules.map((rule) => rule.run(filePath)),
  );

  const findings = [];
  resultsByRule.forEach((ruleFindings, ruleIndex) => {
    const rule = applicableRules[ruleIndex];
    for (const finding of ruleFindings) {
      findings.push({
        ruleId: rule.ruleId,
        tree,
        line: finding.line,
        matchedText: finding.matchedText,
        detailText: finding.detailText,
        fix: rule.fix,
        skill: rule.skill,
        projectCheck: rule.projectCheck,
        overridable: rule.overridable !== false,
      });
    }
  });

  return findings;
}

// The Node checks on every baseline tree, one list per tree in `trees`
// order. A baseline finding can only match an AFTER finding of the same
// rule, so only the rules that found something in AFTER re-run — on a large
// file each checker costs over a second. The trees are checked together.
async function runBaselineNodeChecks(temporaryRoot, relativePath, trees, afterNodeFindings) {
  const ruleIds = new Set(afterNodeFindings.map((finding) => finding.ruleId));

  if (ruleIds.size === 0) return trees.map(() => []);

  return allSettledOrThrowFirst(
    trees.map((tree) => runNodeChecks(temporaryRoot, relativePath, tree, ruleIds)),
  );
}

// Collapses every whitespace run in `text` to a single space and trims the
// ends, so a whitespace-only reformat of an existing violation (for example
// `switch (x)  {` becoming `switch (x) {`) never reads as a new one — see
// `findingKeys`.
function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// Keys every finding on (rule id, normalized matched text, occurrence), per
// the design spec's "New-findings-only comparison" section: line number is
// deliberately excluded, so an edit earlier in the file that shifts every
// later line never turns an untouched violation into a "new" one, and
// `occurrence` — the finding's 1-based rank among findings sharing the same
// rule+text pair, in file order — is what still lets two textually
// identical violations of the same rule match pairwise by position instead
// of collapsing into a single key.
function findingKeys(findings) {
  const occurrenceCounts = new Map();
  const keyedFindings = new Map();
  for (const finding of findings) {
    const baseKey = `${finding.ruleId}\u0000${normalizeText(finding.matchedText)}`;
    const occurrence = (occurrenceCounts.get(baseKey) || 0) + 1;
    occurrenceCounts.set(baseKey, occurrence);
    keyedFindings.set(`${baseKey}\u0000${occurrence}`, finding);
  }
  return keyedFindings;
}

// The override protocol (design spec's "Override protocol" section): a
// `// nosemgrep: <rule-id> OVERRIDE(<reason>) <justification>` comment (or,
// for a Node-checked rule, the same shape spelled `kiko-override:`) placed on
// the finding's own line or the line directly above it — Semgrep line
// numbers are 1-based, so `line - 1` indexes "this line" and `line - 2`
// indexes "the line above" in a 0-based `sourceLines` array. Returns
// 'justified' when a candidate line names `ruleId` and carries `OVERRIDE(`,
// 'bare' when a candidate line names `ruleId` with no `OVERRIDE(`, and 'none'
// otherwise — including when a candidate line names a DIFFERENT rule id,
// which never suppresses THIS finding, per the "denies an override naming a
// different rule id" case.
const OVERRIDE_COMMENT_PATTERN = /(?:nosemgrep|kiko-override):\s*([\w-]+)/;

function overrideState(sourceLines, line, ruleId) {
  const candidateLines = [sourceLines[line - 1], sourceLines[line - 2]];
  for (const candidateLine of candidateLines) {
    if (typeof candidateLine !== 'string') continue;
    const match = OVERRIDE_COMMENT_PATTERN.exec(candidateLine);
    if (match && match[1] === ruleId) {
      return candidateLine.includes('OVERRIDE(') ? 'justified' : 'bare';
    }
  }
  return 'none';
}

// Annotates every finding with its override state against the text of the
// tree it belongs to, then drops every JUSTIFIED one. Doing this for every
// tree before diffing both lets an added justified override suppress a new
// finding, and makes deleting a justified override that suppressed a
// baseline finding turn that finding "new" again (it is dropped from the
// AFTER set only when it is STILL justified there). A 'bare' override is
// left in place — it never suppresses anything — so `buildFindingBlock` can
// still name it when the finding it decorates ends up in the diff. A finding
// of a rule whose NODE_RULES row says `overridable: false` is never read for
// an override comment at all: its state is always 'none'.
function nonJustifiedFindings(findings, sourceText) {
  const sourceLines = sourceText.split('\n');

  return findings
    .map((finding) => ({
      ...finding,
      overrideState:
        finding.overridable === false
          ? 'none'
          : overrideState(sourceLines, finding.line, finding.ruleId),
    }))
    .filter((finding) => finding.overrideState !== 'justified');
}

// A finding the proposed edit ADDS: present in the AFTER key set, absent
// from every baseline's. A pre-existing violation is never reported here —
// it stays visible to the finding's projectCheck, which this hook does not
// affect. A conflicted file has two baselines, one per side; a key found in
// either is pre-existing, and since the occurrence rank is part of the key,
// a repeated violation is allowed up to the larger of the two sides' counts.
// The one exception is a BARE override: a bare comment naming nosemgrep or
// kiko-override never suppresses anything, so an edit that adds one over an
// EXISTING finding must still deny — the finding itself need not be new for
// the added bare comment to be the reason to block.
function newFindings(baselineFindingSets, afterFindings) {
  const baselineKeys = new Set(
    baselineFindingSets.flatMap((findings) => [...findingKeys(findings).keys()]),
  );
  const afterKeys = findingKeys(afterFindings);
  const added = [];
  for (const [key, finding] of afterKeys) {
    if (!baselineKeys.has(key) || finding.overrideState === 'bare') added.push(finding);
  }
  return added;
}

// A rebuilt side of the new content that fails to parse while the same
// side on disk parsed is a break this edit made, so it is denied like any
// AFTER parse error. A side already broken on disk is tolerated here; the
// final step, checked as one whole file, still has to parse.
function throwIfEditBrokeASide(afterTrees, unparsedTrees) {
  const brokenTrees = afterTrees.filter(
    (afterTree) => unparsedTrees.has(afterTree.tree) && !unparsedTrees.has(afterTree.sameSide),
  );

  if (brokenTrees.length === 0) return;

  const lineNumbersByTree = Object.fromEntries(
    afterTrees.map((afterTree) => [afterTree.tree, afterTree.lineNumbers]),
  );
  const parseErrors = brokenTrees.flatMap((afterTree) => unparsedTrees.get(afterTree.tree));
  throw new Error(describeParseErrors(parseErrors, lineNumbersByTree));
}

// The findings each checked AFTER tree adds over the union baseline, named
// at their line in the content the edit would write (override comments
// are read on the tree's own lines first). A violation in a shared region
// shows up on both sides and is reported once.
function addedFindingsFor(afterTrees, semgrepFindings, nodeFindingsByTree, baselineFindingSets) {
  const reportedKeys = new Set();

  return afterTrees
    .flatMap((afterTree) => {
      const treeFindings = nonJustifiedFindings(
        semgrepFindings
          .filter((finding) => finding.tree === afterTree.tree)
          .concat(nodeFindingsByTree.get(afterTree.tree)),
        afterTree.text,
      );

      return newFindings(baselineFindingSets, treeFindings).map((finding) => ({
        ...finding,
        line: afterTree.lineNumbers?.[finding.line - 1] ?? finding.line,
      }));
    })
    .filter((finding) => {
      const key = `${finding.ruleId}\u0000${finding.line}\u0000${normalizeText(finding.matchedText)}`;

      if (reportedKeys.has(key)) return false;

      reportedKeys.add(key);
      return true;
    });
}

// One finding's contribution to the deny reason, in the same five-part
// WHAT/DETAILS/WHY/HOW/DO-NOT shape `_lib.sh`'s `print_block` uses for
// every other check wrapper's stderr output — adapted to plain text inside
// a single JSON string field, since a PreToolUse deny reason is not a block
// written to stderr. `detailText`, when present (rule 11's kind/statement
// split — see parseBlankLineSeparationCheckerOutput), is the full statement
// text a human reads here; `matchedText` itself stays the diff key.
function buildFindingBlock(relativePath, finding) {
  const displayText = finding.detailText ?? finding.matchedText;
  const doNot =
    finding.overridable === false
      ? `this rule has no override; see ${finding.skill}`
      : `suppress this without a justified override; see ${finding.skill}`;
  const lines = [
    `WHAT FAILED:    rule ${finding.ruleId} at ${relativePath}:${finding.line}`,
    `DETAILS:        matched text: ${JSON.stringify(displayText)}`,
    `WHY IT MATTERS: this is a NEW violation the edit would add; a pre-existing one is left for ${finding.projectCheck} to catch`,
    `HOW TO FIX:     ${finding.fix}`,
    `DO NOT:         ${doNot}`,
  ];
  if (finding.overrideState === 'bare') {
    lines.push(
      `OVERRIDE:       a bare nosemgrep/kiko-override comment names rule ${finding.ruleId} with no OVERRIDE(...) justification, so it does not suppress this finding`,
    );
  }
  return lines.join('\n');
}

// The full PreToolUse deny reason for every new finding the proposed edit
// would add, in AFTER-file order.
function denyReason(relativePath, findings) {
  const header = `pre-write guard: ${relativePath} would add ${findings.length} new violation(s)`;
  return [header, ...findings.map((finding) => buildFindingBlock(relativePath, finding))].join(
    '\n\n',
  );
}

function buildDenyPayload(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function emitDeny(reason) {
  process.stdout.write(buildDenyPayload(reason));
  process.stderr.write(`${reason}\n`);
  process.exitCode = 2;
}

function emitAllow() {
  process.exitCode = 0;
}

async function run() {
  let temporaryRoot = null;
  try {
    const rawInput = fs.readFileSync(0, 'utf8');
    const { toolName, filePath, toolInput } = readPayload(rawInput);
    const projectDirectory = process.env.CLAUDE_PROJECT_DIR || ROOT;
    const relativePath = relativeInProject(filePath, projectDirectory);

    if (relativePath === null || !isInScope(relativePath)) {
      emitAllow();
      return;
    }

    const beforeText = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    const afterText = rebuildContents(toolName, toolInput, beforeText);

    const beforeSides = conflictSides(beforeText);
    const beforeIsConflicted = beforeSides.blockCount > 0;
    const baselineTexts = baselineTextsFor(beforeText, beforeSides);
    const baselineTrees = Object.keys(baselineTexts);
    const afterTrees = afterTreesFor(afterText, baselineTexts);

    // A marker-keeping step that changed neither side (say, only a marker
    // label) cannot add a finding.
    if (afterTrees.length === 0) {
      emitAllow();
      return;
    }

    temporaryRoot = writeMirroredTrees(relativePath, {
      ...baselineTexts,
      ...Object.fromEntries(afterTrees.map((afterTree) => [afterTree.tree, afterTree.text])),
    });

    // Every non-empty tree goes to the ONE Semgrep process this hook
    // budgets for; an empty baseline can have no findings, so scanning it
    // would only cost time. The Node checkers (the NODE_RULES rows) run on
    // the AFTER trees first, and on the baselines only when an AFTER tree
    // has a finding (see runBaselineNodeChecks). Semgrep and the AFTER-tree
    // Node checkers only read the mirrored trees and their findings are
    // only concatenated, so they run TOGETHER, for speed.
    const semgrepTrees = [
      ...baselineTrees.filter((tree) => baselineTexts[tree] !== ''),
      ...afterTrees.map((afterTree) => afterTree.tree),
    ];
    const conflictSideTrees = afterTrees
      .filter((afterTree) => afterTree.sameSide)
      .map((afterTree) => afterTree.tree);
    const tolerantTrees = beforeIsConflicted ? [...baselineTrees, ...conflictSideTrees] : [];
    const [semgrepOutcome, ...afterNodeResults] = await allSettledOrThrowFirst([
      runSemgrep(temporaryRoot, relativePath, semgrepTrees, tolerantTrees),
      ...afterTrees.map((afterTree) => runNodeChecks(temporaryRoot, relativePath, afterTree.tree)),
    ]);
    const { findings: semgrepFindings, unparsedTrees } = semgrepOutcome;
    throwIfEditBrokeASide(afterTrees, unparsedTrees);
    const parsedBaselineTrees = baselineTrees.filter((tree) => !unparsedTrees.has(tree));

    // With neither side of the conflict parseable there is no baseline, so
    // every violation the merge already carried would read as new and block
    // the resolution. Allow it; check:security (the Semgrep rules) and
    // check:all (the Node checkers) still check the finished file.
    if (beforeIsConflicted && parsedBaselineTrees.length === 0) {
      emitAllow();
      return;
    }

    const nodeFindingsByTree = new Map(
      afterTrees.map((afterTree, treeIndex) => [afterTree.tree, afterNodeResults[treeIndex]]),
    );
    const checkedAfterTrees = afterTrees.filter((afterTree) => !unparsedTrees.has(afterTree.tree));
    const baselineNodeFindings = await runBaselineNodeChecks(
      temporaryRoot,
      relativePath,
      parsedBaselineTrees,
      checkedAfterTrees.flatMap((afterTree) => nodeFindingsByTree.get(afterTree.tree)),
    );

    const baselineFindingSets = parsedBaselineTrees.map((tree, treeIndex) =>
      nonJustifiedFindings(
        semgrepFindings
          .filter((finding) => finding.tree === tree)
          .concat(baselineNodeFindings[treeIndex]),
        baselineTexts[tree],
      ),
    );

    const addedFindings = addedFindingsFor(
      checkedAfterTrees,
      semgrepFindings,
      nodeFindingsByTree,
      baselineFindingSets,
    );

    if (addedFindings.length === 0) {
      emitAllow();
      return;
    }

    emitDeny(denyReason(relativePath, addedFindings));
  } catch (error) {
    // A missing old_string is the agent's edit, not a guard failure: say so
    // plainly, so the agent re-reads instead of retrying the same edit.
    if (error instanceof RebuildError) {
      emitDeny(`pre-write guard: ${error.message}`);
      return;
    }
    emitDeny(`pre-write guard could not check this edit: ${error.message}`);
  } finally {
    if (temporaryRoot) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) run() catches every error itself and turns it into a deny
  run();
}
