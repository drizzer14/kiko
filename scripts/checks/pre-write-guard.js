#!/usr/bin/env node

// PreToolUse guard for Edit/Write/MultiEdit: rebuilds the file content an
// edit WOULD produce (the edit has not touched disk yet — that is the whole
// point of a PreToolUse hook) and denies the write when the rebuilt content
// introduces a known violation. See scripts/checks/pre-write-guard.sh for
// the wrapper that invokes this script and its own exit-code contract (0
// allow, 2 deny, anything else means the wrapper itself denies), and
// docs/superpowers/specs/2026-09-25-pre-write-guard-design.md for the full
// design this file implements incrementally.
//
// `rebuildContents` rebuilds Write/Edit/MultiEdit into the BEFORE/AFTER pair;
// `runSemgrep` runs ONE Semgrep process over the trees that can possibly
// matter (an empty BEFORE tree is skipped — it can have no findings, so
// scanning it would only waste the one process this hook is allowed);
// `runNodeChecks` runs the hand-rolled checkers Semgrep cannot express
// (import-order.js, full-word-identifiers.js, and, `.tsx` only,
// one-component-per-file.ts's `exportedComponentNames`) via the same
// AFTER-first, BEFORE-only-if-AFTER-has-findings staging; `findingKeys`/
// `newFindings` diff the two finding sets — Semgrep's and the Node
// checkers' combined — so only a finding the edit ADDS ever blocks the
// write, never one already on disk. `overrideState` recognizes a rule-
// specific `nosemgrep`/`kiko-override` comment that exempts a finding: a
// justified one (carrying `OVERRIDE(...)`) drops the finding from BOTH
// trees before the diff, and a bare one (naming the rule with no
// `OVERRIDE(...)`) never suppresses anything — Semgrep itself runs with
// `--disable-nosem`, so this file is the only place a suppression is ever
// honored. Fail closed throughout: the top-level try/catch below turns ANY
// throw — a malformed payload, a missing/unreadable rules file, an
// unexpected Semgrep or Node-checker exit code, a finding whose rule is
// missing its required `metadata.skill`, or an internal timeout killing a
// child — into a deny, never a silent allow.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

const TIMEOUT_MILLISECONDS = Number(process.env.KIKO_PREWRITE_TIMEOUT_MS) || 25000;
const DEADLINE = Date.now() + TIMEOUT_MILLISECONDS;

// The remaining internal budget, in milliseconds, handed to a child's own
// `spawnSync` `timeout` option — never the full per-hook budget again for a
// second child, so a slow first child cannot let a second one blow past the
// hook's own 30s ceiling. Floored at 1 so `spawnSync` (which treats 0 as
// "no timeout") always gets a real deadline.
function remainingBudget() {
  return Math.max(1, DEADLINE - Date.now());
}

const EXCLUDED_PREFIXES = ['rules/fixtures/', 'node_modules/', 'ios/', 'android/'];

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

// Resolves both `filePath` and `projectDirectory` with realpath (Review
// Focus 2: a symlinked project directory, or a file_path reached through
// one, must not be mistaken for "outside the project") before relativizing.
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
// changed the on-disk bytes since the agent last read them (Review Focus 1:
// the caller's fail-closed try/catch turns this into a deny that tells the
// agent to re-read the file, never an unchecked write).
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
    throw new RebuildError('old_string not found; re-read the file and retry');
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

// Mirrors BEFORE and AFTER into one mkdtemp root, each under its own
// repo-relative path, so a path-keyed Semgrep rule still evaluates
// correctly when pointed at the scratch tree instead of the real one (see
// the spec's "Rebuilding the proposed content" section). Both trees are
// always written, even though this task only scans "after" — a later
// task's new-findings-only comparison needs "before" scanned too.
function writeMirroredTrees(relativePath, beforeText, afterText) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-prewrite-'));
  const beforePath = path.join(temporaryRoot, 'before', relativePath);
  const afterPath = path.join(temporaryRoot, 'after', relativePath);

  fs.mkdirSync(path.dirname(beforePath), { recursive: true });
  fs.mkdirSync(path.dirname(afterPath), { recursive: true });
  fs.writeFileSync(beforePath, beforeText);
  fs.writeFileSync(afterPath, afterText);

  return { temporaryRoot, beforePath, afterPath };
}

// Strips the enclosing config's own path segments from a Semgrep
// `check_id` — this Semgrep version reports a rule loaded from
// `rules/semgrep-prewrite.yml` as `rules.<rule-id>` (a dotted prefix built
// from the config file's own basename), not the bare rule id every other
// place in this codebase names it (fixtures, `NODE_RULES`, the deny
// message). Only the LAST dot-separated segment is ever the rule id itself,
// since a rule id is hyphen-separated, never dotted.
function stripConfigPathPrefix(checkId) {
  const segments = checkId.split('.');
  return segments[segments.length - 1];
}

// Builds one Finding from a raw Semgrep JSON result. `matchedText` is
// ALWAYS sliced from the real mirrored source file by byte offset
// (`start.offset`/`end.offset`) — this Semgrep version reports
// `extra.lines` as the fixed literal string "requires login" regardless of
// the actual match, so it can never be trusted as the matched text.
// `start.offset`/`end.offset` are UTF-8 BYTE offsets, not UTF-16 code-unit
// indices, so the source is read as a raw Buffer and sliced there — slicing
// a decoded JS string with them would misalign on any non-ASCII byte
// earlier in the file (a Cyrillic comment, an em dash) and read the wrong
// span, or a pre-existing finding's span, as new. Fails closed (throws,
// caught by `run`'s top-level fail-closed handler) when a result's metadata
// is missing the `skill` pointer every pre-write rule is required to carry:
// a rule that would deny a write without pointing the agent at the skill
// section explaining why is a guard bug, not a rule this hook can safely
// enforce.
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
  };
}

// Runs Semgrep against the requested trees ('after', or ['before','after'])
// with the pre-write rule set. The child runs with cwd = temporaryRoot and
// is given targets RELATIVE to it ('after/<rel>', not an absolute path) —
// this is what lets a path-keyed rule (for example rule 9's nav-layer
// allowlist, or rule 12's screen-folder rule) evaluate against the file's
// real repo-relative path instead of a throwaway scratch path, and lets
// both trees stay reachable from the SAME cwd in one process when both are
// requested. A missing/unreadable rules file, a Semgrep exit code other
// than 0 (clean) or 1 (findings), a non-empty `errors[]` (Semgrep's own
// signal that it could not evaluate a rule), a target missing from
// `paths.scanned` (Semgrep silently skipped a target — a `paths.exclude`
// pattern or a `.semgrepignore` entry would otherwise let a violation
// through unseen), or a child killed by its own timeout all throw — caught
// by the top-level fail-closed handler below.
function runSemgrep(temporaryRoot, relativePath, trees) {
  const rulesPath =
    process.env.KIKO_PREWRITE_RULES || path.join(ROOT, 'rules', 'semgrep-prewrite.yml');
  fs.accessSync(rulesPath, fs.constants.R_OK);

  const semgrepBinary = process.env.KIKO_PREWRITE_SEMGREP_BIN || 'semgrep';
  const posixRelativePath = relativePath.split(path.sep).join('/');
  const targets = trees.map((tree) => `${tree}/${posixRelativePath}`);

  const childResult = spawnSync(
    semgrepBinary,
    ['--metrics', 'off', '--quiet', '--json', '--disable-nosem', '--config', rulesPath, ...targets],
    {
      cwd: temporaryRoot,
      encoding: 'utf8',
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
  if (errors.length > 0) {
    throw new Error(`semgrep reported ${errors.length} error(s): ${JSON.stringify(errors)}`);
  }

  const scannedTargets = new Set(parsed.paths?.scanned || []);
  const unscannedTarget = targets.find((target) => !scannedTargets.has(target));
  if (unscannedTarget) {
    throw new Error(`semgrep did not scan ${unscannedTarget}`);
  }

  return (parsed.results || []).map((result) => buildFinding(temporaryRoot, result));
}

// Spawns one Node checker script (import-order.js or full-word-
// identifiers.js — never one-component-per-file.ts, which runs in-process
// below) against a single mirrored file. Mirrors runSemgrep's exit-code
// contract: 0 is clean, 1 means `parseOutput` should read the checker's own
// stdout; any other code (a crash, a stub standing in for one in a test)
// throws, caught by the top-level fail-closed handler in `run`. A crashing
// checker (a syntax error, an uncaught exception) can ALSO exit 1 — the same
// code a real violation report uses — so exit 1 alone is not proof of a real
// finding: any stderr output, or an exit-1 stdout that `parseOutput` reads as
// zero findings, throws too, instead of silently parsing to an empty
// Finding[] that would let a broken checker disable its own rule unnoticed.
function runSpawnedNodeChecker(scriptName, filePath, parseOutput) {
  const nodeBinary = process.env.KIKO_PREWRITE_NODE_BIN || 'node';
  const scriptPath = path.join(ROOT, 'scripts', 'checks', scriptName);

  const childResult = spawnSync(nodeBinary, [scriptPath, filePath], {
    encoding: 'utf8',
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
const BLANK_LINE_SEPARATION_VIOLATION_LINE = /:(\d+): (\w+): (.*)$/;

function parseBlankLineSeparationCheckerOutput(stdout) {
  const findings = [];
  for (const line of stdout.split('\n')) {
    const match = BLANK_LINE_SEPARATION_VIOLATION_LINE.exec(line);
    if (match) {
      findings.push({ line: Number(match[1]), matchedText: match[3] });
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

// Loads one-component-per-file.ts's `exportedComponentNames` in-process
// (never spawned — it is a `.ts` module, not a standalone CLI, and this is
// the same checker the "one exported component per .tsx" Jest invariant
// calls directly) and reports one finding per exported component name AFTER
// the first, at that name's own export declaration line. `pathToFileURL` is
// required here: a bare absolute path is not a valid ES module specifier on
// every platform this could run on.
async function runOneComponentPerFileChecker(filePath) {
  const moduleUrl = pathToFileURL(
    path.join(ROOT, 'scripts', 'checks', 'one-component-per-file.ts'),
  ).href;
  const { exportedComponentNames } = await import(moduleUrl);
  const source = fs.readFileSync(filePath, 'utf8');
  const names = exportedComponentNames(source);

  return names
    .slice(1)
    .map((name) => ({ line: exportDeclarationLine(source, name), matchedText: name }));
}

// One row per Node-checker rule id: which `.ts`/`.tsx` extension(s) it
// applies to, how to run it against one mirrored file, and the fix/skill
// pair the deny reason cites (see buildFindingBlock below) — the Node-check
// analog of a Semgrep rule's own `metadata.fix`/`metadata.skill`. A new
// checker (rule 11's blank-line-separation, rule 12's no-cross-screen-
// import) is one more row here plus, for a spawned script, one more
// `parseOutput` function above.
const NODE_RULES = [
  {
    ruleId: 'kiko-import-order',
    extensions: ['.ts', '.tsx'],
    fix: 'run `node scripts/checks/import-order.js --write <file>`, or reorder the groups by hand: external, then ../**, then ./**, each ascending by ending-line length',
    skill: 'kiko-code-style › Import ordering',
    run: (filePath) =>
      runSpawnedNodeChecker('import-order.js', filePath, parseImportOrderCheckerOutput),
  },
  {
    ruleId: 'kiko-full-word-identifiers',
    extensions: ['.ts', '.tsx'],
    fix: 'spell out the abbreviated word in full',
    skill: 'kiko-code-style › Full words in identifiers',
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
    run: (filePath) => runOneComponentPerFileChecker(filePath),
  },
  {
    ruleId: 'kiko-blank-line-separation',
    extensions: ['.ts', '.tsx'],
    fix: 'run `node scripts/checks/blank-line-separation.js --write <file>`, or insert a blank line by hand above the return/if/for/while statement (or JSX sibling), unless it is the first statement of its block or already preceded by a comment',
    skill:
      'kiko-code-style › Blank lines before statement blocks / Blank line between adjacent JSX sibling nodes',
    run: (filePath) =>
      runSpawnedNodeChecker(
        'blank-line-separation.js',
        filePath,
        parseBlankLineSeparationCheckerOutput,
      ),
  },
];

// Runs every NODE_RULES row whose `extensions` covers `relativePath`'s own
// extension against the ONE requested tree ('before' or 'after'), returning
// their combined Finding[] — the Node-checker analog of runSemgrep, called
// twice by `run` below (AFTER first; BEFORE only when AFTER already has a
// finding, so a clean edit never pays for a BEFORE pass it cannot possibly
// need — see the "New-findings-only comparison" section normalizeText/
// findingKeys implement for Semgrep, applied the same way here).
async function runNodeChecks(temporaryRoot, relativePath, tree) {
  const filePath = path.join(temporaryRoot, tree, relativePath);
  const extension = path.extname(relativePath);
  const findings = [];

  for (const rule of NODE_RULES) {
    if (!rule.extensions.includes(extension)) continue;

    const ruleFindings = await rule.run(filePath);
    for (const finding of ruleFindings) {
      findings.push({
        ruleId: rule.ruleId,
        tree,
        line: finding.line,
        matchedText: finding.matchedText,
        fix: rule.fix,
        skill: rule.skill,
      });
    }
  }

  return findings;
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

// A finding the proposed edit ADDS: present in the AFTER key set, absent
// from the BEFORE one. A pre-existing violation (present in both) is never
// reported here — it stays visible to check:rules/check:all, which this
// hook does not affect.
function newFindings(beforeFindings, afterFindings) {
  const beforeKeys = findingKeys(beforeFindings);
  const afterKeys = findingKeys(afterFindings);
  const added = [];
  for (const [key, finding] of afterKeys) {
    if (!beforeKeys.has(key)) added.push(finding);
  }
  return added;
}

// One finding's contribution to the deny reason, in the same five-part
// WHAT/DETAILS/WHY/HOW/DO-NOT shape `_lib.sh`'s `print_block` uses for
// every other check wrapper's stderr output — adapted to plain text inside
// a single JSON string field, since a PreToolUse deny reason is not a block
// written to stderr.
function buildFindingBlock(relativePath, finding) {
  const lines = [
    `WHAT FAILED:    rule ${finding.ruleId} at ${relativePath}:${finding.line}`,
    `DETAILS:        matched text: ${JSON.stringify(finding.matchedText)}`,
    'WHY IT MATTERS: this is a NEW violation the edit would add; a pre-existing one is left for check:rules to catch',
    `HOW TO FIX:     ${finding.fix}`,
    `DO NOT:         suppress this without a justified override; see ${finding.skill}`,
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

    const mirrored = writeMirroredTrees(relativePath, beforeText, afterText);
    temporaryRoot = mirrored.temporaryRoot;

    // An empty BEFORE tree can have no findings at all — skip scanning it
    // and spend the ONE Semgrep process this hook budgets for on the AFTER
    // tree alone, which is trivially every new finding there is.
    const trees = beforeText === '' ? ['after'] : ['before', 'after'];
    const rawFindings = runSemgrep(temporaryRoot, relativePath, trees);
    const beforeFindings = rawFindings.filter((finding) => finding.tree === 'before');
    const afterFindings = rawFindings.filter((finding) => finding.tree === 'after');

    // The Node checkers (rules 4, 5, 6) run AFTER first; a clean AFTER can
    // have no new finding, so BEFORE is only worth the extra process when
    // AFTER already found something to diff against.
    const afterNodeFindings = await runNodeChecks(temporaryRoot, relativePath, 'after');
    const beforeNodeFindings =
      afterNodeFindings.length > 0
        ? await runNodeChecks(temporaryRoot, relativePath, 'before')
        : [];

    // Annotate every finding with its override state against the tree it
    // belongs to (BEFORE findings against beforeText's own lines, AFTER
    // findings against afterText's own lines — Review Focus 5), then drop
    // every JUSTIFIED finding from both trees before diffing: this is what
    // both lets an added justified override suppress a new finding, and
    // makes deleting a justified override that suppressed a BEFORE finding
    // turn that finding "new" again (it is dropped from the AFTER set only
    // when it is STILL justified there). A 'bare' override is left in place
    // — it never suppresses anything — so `buildFindingBlock` can still name
    // it when the finding it decorates ends up in the diff.
    const beforeLines = beforeText.split('\n');
    const afterLines = afterText.split('\n');
    const annotate = (findings, sourceLines) =>
      findings.map((finding) => ({
        ...finding,
        overrideState: overrideState(sourceLines, finding.line, finding.ruleId),
      }));
    const annotatedBefore = annotate(beforeFindings.concat(beforeNodeFindings), beforeLines);
    const annotatedAfter = annotate(afterFindings.concat(afterNodeFindings), afterLines);
    const nonJustifiedBefore = annotatedBefore.filter(
      (finding) => finding.overrideState !== 'justified',
    );
    const nonJustifiedAfter = annotatedAfter.filter(
      (finding) => finding.overrideState !== 'justified',
    );

    const addedFindings = newFindings(nonJustifiedBefore, nonJustifiedAfter);

    if (addedFindings.length === 0) {
      emitAllow();
      return;
    }

    emitDeny(denyReason(relativePath, addedFindings));
  } catch (error) {
    emitDeny(`pre-write guard could not check this edit: ${error.message}`);
  } finally {
    if (temporaryRoot) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  run();
}
