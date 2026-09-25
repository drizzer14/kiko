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
// This first pass wires the shared shape every later task builds on: read
// the payload, resolve `file_path` against CLAUDE_PROJECT_DIR (through a
// symlink on either side), gate on file scope, mirror the before/after
// content into a scratch tree, and run ONE Semgrep pass against it. Content
// rebuilding for Edit/MultiEdit (rebuildContents) and real finding
// extraction (runSemgrep) are stubs here — Edit/MultiEdit rebuilding and
// new-findings-only comparison land in later tasks. Fail closed throughout:
// the top-level try/catch below turns ANY throw — a malformed payload, a
// missing/unreadable rules file, an unexpected Semgrep exit code, or an
// internal timeout killing a child — into a deny, never a silent allow.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
// Returns null when `filePath` sits outside `projectDirectory`, or either
// side cannot be resolved at all.
function relativeInProject(filePath, projectDirectory) {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;

  let resolvedProjectDirectory;
  let resolvedFilePath;
  try {
    resolvedProjectDirectory = fs.realpathSync(projectDirectory);
    resolvedFilePath = resolveNearestExisting(path.resolve(filePath));
  } catch {
    return null;
  }

  const relative = path.relative(resolvedProjectDirectory, resolvedFilePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}

// Only .ts/.tsx files are in scope, and never a fixture, a native
// generated tree, or node_modules — see the spec's "File scope" section.
function isInScope(relativePath) {
  if (!/\.(ts|tsx)$/.test(relativePath)) return false;
  const posixRelativePath = relativePath.split(path.sep).join('/');
  return !EXCLUDED_PREFIXES.some((prefix) => posixRelativePath.startsWith(prefix));
}

// STUB: real Edit/MultiEdit rebuilding (applying old_string/new_string, or
// an edits array, against beforeText) lands in a later task. For now this
// only handles the Write shape, which is enough to exercise scope, the
// mirrored trees, and the Semgrep child-process contract this task wires.
function rebuildContents(_toolName, toolInput, _beforeText) {
  return toolInput.content ?? '';
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

// Runs Semgrep against the requested trees ('after', or ['before','after']
// for a later task's new-findings comparison) with the pre-write rule set.
// A missing/unreadable rules file, a Semgrep exit code other than 0
// (clean) or 1 (findings), or a child killed by its own timeout all throw —
// caught by the top-level fail-closed handler below. STUB: parsing
// `results` into Finding[] lands in a later task; this pass only proves the
// child-process contract (rules readability, exit-code handling, the
// timeout budget).
function runSemgrep(temporaryRoot, relativePath, trees) {
  const rulesPath =
    process.env.KIKO_PREWRITE_RULES || path.join(ROOT, 'rules', 'semgrep-prewrite.yml');
  fs.accessSync(rulesPath, fs.constants.R_OK);

  const semgrepBinary = process.env.KIKO_PREWRITE_SEMGREP_BIN || 'semgrep';
  const targets = trees.map((tree) => path.join(temporaryRoot, tree, relativePath));

  const childResult = spawnSync(semgrepBinary, ['--config', rulesPath, '--json', ...targets], {
    encoding: 'utf8',
    timeout: remainingBudget(),
  });

  if (childResult.error) throw childResult.error;
  if (childResult.signal !== null) {
    throw new Error(`semgrep timed out (signal ${childResult.signal})`);
  }
  if (childResult.status !== 0 && childResult.status !== 1) {
    throw new Error(`semgrep exited ${childResult.status}`);
  }

  return [];
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

function run() {
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

    const findings = runSemgrep(temporaryRoot, relativePath, ['after']);
    if (findings.length === 0) {
      emitAllow();
      return;
    }

    emitDeny(`pre-write guard found ${findings.length} new violation(s) in ${relativePath}`);
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
