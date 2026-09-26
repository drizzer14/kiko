import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/pre-write-guard.sh is the PreToolUse hook for Edit/Write/
// MultiEdit (wired in harness/kiko/hooks/hooks.json in a later task). It
// reads the hook's tool_input JSON payload from stdin, rebuilds the file's
// proposed content, and denies the write when the rebuilt content is out of
// scope, malformed, or the internal check fails for any reason (fail
// closed — see scripts/checks/pre-write-guard.js). This task only wires the
// scope check, the fail-closed shell, and the deny JSON shape; the real
// Semgrep/Node rule findings land in later tasks, so every scenario here
// that reaches the checker exercises a stubbed semgrep binary that always
// reports zero findings.
const SCRIPT = join(__dirname, '../scripts/checks/pre-write-guard.sh');

const createdPaths: string[] = [];

function createTempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  createdPaths.push(directory);

  return directory;
}

// The guard's own `runSemgrep` always sends the SAME 9 fixed flag/value
// tokens before any target ('--metrics off --quiet --json --disable-nosem
// --timeout <seconds> --config <rulesPath>') — `shift 9` drops exactly
// those, leaving only the requested targets in "$@", which every stub below
// reports back as `paths.scanned` so the guard's own "target missing from
// paths.scanned" fail-closed check never fires against a stub that never
// claimed to have scanned anything.
function writeSemgrepStub(directory: string): string {
  const stubPath = join(directory, 'semgrep-stub.sh');
  writeFileSync(
    stubPath,
    [
      '#!/usr/bin/env bash',
      'if [ -n "$KIKO_PREWRITE_TEST_MARKER" ]; then',
      '  touch "$KIKO_PREWRITE_TEST_MARKER"',
      'fi',
      'if [ -n "$STUB_SLEEP" ]; then',
      '  sleep "$STUB_SLEEP"',
      'fi',
      'shift 9',
      'scannedParts=""',
      'for target in "$@"; do',
      '  if [ -z "$scannedParts" ]; then scannedParts="\\"$target\\""; else scannedParts="$scannedParts,\\"$target\\""; fi',
      'done',
      'printf \'{"results":[],"errors":[],"paths":{"scanned":[%s]}}\' "$scannedParts"',
      'exitCode="$STUB_EXIT"',
      'if [ -z "$exitCode" ]; then',
      '  exitCode=0',
      'fi',
      'exit "$exitCode"',
      '',
    ].join('\n'),
  );
  chmodSync(stubPath, 0o755);

  return stubPath;
}

function writeRulesStub(directory: string): string {
  const rulesPath = join(directory, 'rules-stub.yml');
  writeFileSync(rulesPath, 'rules: []\n');

  return rulesPath;
}

// A semgrep stub for the rebuildContents tests below. It captures its own
// cwd and argv, and the content of the AFTER target it was pointed at, plus
// whether and what the BEFORE counterpart (the sibling before/<rel> path
// relative to that same cwd) holds — this is how the tests observe the
// rebuilt content and the mirrored-tree layout without reading them off the
// guard's own scratch tree, which is removed before the guard process
// exits, so any check has to happen from data the stub captured while that
// tree still existed.
function writeCapturingSemgrepStub(directory: string, captureDirectory: string): string {
  const stubPath = join(directory, 'semgrep-capture-stub.sh');
  writeFileSync(
    stubPath,
    [
      '#!/usr/bin/env bash',
      'shift 9',
      'for target in "$@"; do :; done',
      'pwd > "$KIKO_PREWRITE_TEST_CAPTURE_DIR/cwd.txt"',
      'printf \'%s\' "$target" > "$KIKO_PREWRITE_TEST_CAPTURE_DIR/argv.txt"',
      'cp "$target" "$KIKO_PREWRITE_TEST_CAPTURE_DIR/after.txt"',
      "beforeTarget=$(printf '%s' \"$target\" | sed 's#^after/#before/#')",
      'if [ -f "$beforeTarget" ]; then',
      '  cp "$beforeTarget" "$KIKO_PREWRITE_TEST_CAPTURE_DIR/before.txt"',
      '  printf \'yes\' > "$KIKO_PREWRITE_TEST_CAPTURE_DIR/before-exists.txt"',
      'else',
      '  : > "$KIKO_PREWRITE_TEST_CAPTURE_DIR/before.txt"',
      '  printf \'no\' > "$KIKO_PREWRITE_TEST_CAPTURE_DIR/before-exists.txt"',
      'fi',
      'scannedParts=""',
      'for target in "$@"; do',
      '  if [ -z "$scannedParts" ]; then scannedParts="\\"$target\\""; else scannedParts="$scannedParts,\\"$target\\""; fi',
      'done',
      'printf \'{"results":[],"errors":[],"paths":{"scanned":[%s]}}\' "$scannedParts"',
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(stubPath, 0o755);
  mkdirSync(captureDirectory, { recursive: true });

  return stubPath;
}

// A stub for the Semgrep-findings tests below: it combines the raw Semgrep
// result objects supplied via the `STUB_RESULTS_BEFORE`/`STUB_RESULTS_AFTER`
// env vars (JSON arrays), keeps only the ones whose own `path` was actually
// among the requested targets (mirroring real Semgrep, which only ever
// reports a result for a target it was pointed at), and reports those
// targets back as `paths.scanned`. When `KIKO_PREWRITE_TEST_COUNTER_FILE`/
// `KIKO_PREWRITE_TEST_ARGV_FILE` are set, it also records one call (an
// appended line) and the exact target list the guard passed it, so a test
// can assert the guard spent exactly ONE Semgrep process on a given edit.
function writeFindingsStub(directory: string): string {
  const stubPath = join(directory, 'semgrep-findings-stub.js');
  writeFileSync(
    stubPath,
    [
      '#!/usr/bin/env node',
      'const fs = require("fs");',
      'const targets = process.argv.slice(11);',
      'const before = JSON.parse(process.env.STUB_RESULTS_BEFORE || "[]");',
      'const after = JSON.parse(process.env.STUB_RESULTS_AFTER || "[]");',
      'const results = before',
      '  .concat(after)',
      '  .filter((result) => targets.includes(result.path));',
      'if (process.env.KIKO_PREWRITE_TEST_COUNTER_FILE) {',
      '  fs.appendFileSync(process.env.KIKO_PREWRITE_TEST_COUNTER_FILE, "1\\n");',
      '}',
      'if (process.env.KIKO_PREWRITE_TEST_ARGV_FILE) {',
      '  fs.writeFileSync(process.env.KIKO_PREWRITE_TEST_ARGV_FILE, JSON.stringify(targets));',
      '}',
      'process.stdout.write(JSON.stringify({ results, errors: [], paths: { scanned: targets } }));',
      'process.exitCode = process.env.STUB_EXIT ? Number(process.env.STUB_EXIT) : 0;',
      '',
    ].join('\n'),
  );
  chmodSync(stubPath, 0o755);

  return stubPath;
}

// Builds one raw Semgrep `results[]` entry the way this Semgrep version
// actually shapes it: `check_id` carries the loaded config's own dotted
// prefix (`rules.<rule-id>`), and `extra.lines` is always the fixed literal
// "requires login" — never the real matched text — so a test that expects
// the guard to slice the matched text from `start.offset`/`end.offset`
// instead can rely on `extra.lines` never containing the right answer.
function rawResult(options: {
  checkId: string;
  path: string;
  line: number;
  offsetStart: number;
  offsetEnd: number;
  fix?: string;
  skill?: string;
}): Record<string, unknown> {
  const metadata: Record<string, string> = {};

  if (options.fix !== undefined) metadata.fix = options.fix;

  if (options.skill !== undefined) metadata.skill = options.skill;

  return {
    check_id: options.checkId,
    path: options.path,
    start: { line: options.line, offset: options.offsetStart },
    end: { offset: options.offsetEnd },
    extra: { lines: 'requires login', metadata },
  };
}

function payloadFor(toolName: string, toolInput: Record<string, unknown>): string {
  return JSON.stringify({ tool_name: toolName, tool_input: toolInput });
}

function baseEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides };
}

function runGuard(input: string, env: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return spawnSync('bash', [SCRIPT], { input, encoding: 'utf8', env });
}

afterEach(() => {
  while (createdPaths.length > 0) {
    const directory = createdPaths.pop();

    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('scripts/checks/pre-write-guard.sh (PreToolUse Edit/Write/MultiEdit guard)', () => {
  it('allows a non-.ts/.tsx file without running semgrep', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const marker = join(project, 'marker.txt');
    const targetFile = join(project, 'README.md');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'hello' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_MARKER: marker,
      }),
    );

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it('allows a path under rules/fixtures/', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const marker = join(project, 'marker.txt');
    const targetFile = join(project, 'rules', 'fixtures', 'x.bad.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const bad = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_MARKER: marker,
      }),
    );

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it('allows a .ts file outside CLAUDE_PROJECT_DIR', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const outside = createTempDirectory('kiko-prewrite-outside-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const marker = join(project, 'marker.txt');
    const targetFile = join(outside, 'example.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_MARKER: marker,
      }),
    );

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it('resolves a symlinked project path before relativizing', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const projectLink = join(tmpdir(), `kiko-prewrite-link-${process.pid}-${Date.now()}`);
    symlinkSync(project, projectLink);
    createdPaths.push(projectLink);
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const marker = join(project, 'marker.txt');
    const targetFile = join(projectLink, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_MARKER: marker,
      }),
    );

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  it('denies on malformed stdin JSON', () => {
    const project = createTempDirectory('kiko-prewrite-project-');

    const result = runGuard('{not valid json', baseEnv({ CLAUDE_PROJECT_DIR: project }));

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(result.stderr.trim()).not.toBe('');
  });

  it('denies when semgrep exits neither 0 nor 1', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_EXIT: '3',
      }),
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('denies when rules/semgrep-prewrite.yml is unreadable', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const missingRules = join(project, 'rules', 'semgrep-prewrite.yml');
    const targetFile = join(project, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: missingRules,
      }),
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('denies when CLAUDE_PROJECT_DIR cannot be resolved', () => {
    const missingProjectDirectory = join(
      tmpdir(),
      `kiko-prewrite-missing-project-${process.pid}-${Date.now()}`,
    );
    const targetFile = join(missingProjectDirectory, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({ CLAUDE_PROJECT_DIR: missingProjectDirectory }),
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('denies on a non-ENOENT realpath error (a symlink loop) instead of allowing unchecked', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const loopPath = join(project, 'loop.ts');
    symlinkSync(loopPath, loopPath);

    const result = runGuard(
      payloadFor('Write', { file_path: loopPath, content: 'export const value = 1;\n' }),
      baseEnv({ CLAUDE_PROJECT_DIR: project }),
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('treats a file name starting with ".." as inside the project, not outside', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const marker = join(project, 'marker.txt');
    const targetFile = join(project, '..env-shim.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_MARKER: marker,
      }),
    );

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  it('denies an unknown tool_name instead of treating BEFORE as AFTER', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'example.ts');
    writeFileSync(targetFile, 'export const value = 0;\n');

    const result = runGuard(
      payloadFor('NotebookEdit', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('denies on internal timeout and leaves no temp root', () => {
    const scratchTemporaryDirectory = createTempDirectory('kiko-prewrite-scratch-');
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_SLEEP: '5',
        KIKO_PREWRITE_TIMEOUT_MS: '500',
        TMPDIR: scratchTemporaryDirectory,
      }),
    );

    expect(result.status).toBe(2);
    expect(readdirSync(scratchTemporaryDirectory)).toEqual([]);
  });

  it('removes its temp root on allow, deny, and crash', () => {
    const scratchTemporaryDirectory = createTempDirectory('kiko-prewrite-scratch-');
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'example.ts');

    const allowResult = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        TMPDIR: scratchTemporaryDirectory,
      }),
    );
    expect(allowResult.status).toBe(0);
    expect(readdirSync(scratchTemporaryDirectory)).toEqual([]);

    const denyResult = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_EXIT: '3',
        TMPDIR: scratchTemporaryDirectory,
      }),
    );
    expect(denyResult.status).toBe(2);
    expect(readdirSync(scratchTemporaryDirectory)).toEqual([]);

    const crashResult = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: join(project, 'does-not-exist.sh'),
        KIKO_PREWRITE_RULES: rules,
        TMPDIR: scratchTemporaryDirectory,
      }),
    );
    expect(crashResult.status).toBe(2);
    expect(readdirSync(scratchTemporaryDirectory)).toEqual([]);
  });

  it('prints the documented deny JSON shape', () => {
    const project = createTempDirectory('kiko-prewrite-project-');

    const result = runGuard('{not valid json', baseEnv({ CLAUDE_PROJECT_DIR: project }));

    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: expect.any(String),
    });
  });

  // Not one of the brief's named cases, but required by the same brief's
  // fail-closed wrapper contract (Step 3: "Any other code, or node missing,
  // means the wrapper prints its own deny JSON") — left untested, this
  // branch of pre-write-guard.sh would ship unverified.
  it("denies via the wrapper's own JSON when node exits with an unexpected code, even with a multi-line stderr", () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const fakeBinDirectory = join(project, 'fake-bin');
    mkdirSync(fakeBinDirectory);
    const fakeNodePath = join(fakeBinDirectory, 'node');
    writeFileSync(
      fakeNodePath,
      "#!/usr/bin/env bash\nprintf 'boom\\n    at first (stack.js:1)\\n    at second (stack.js:2)\\n' >&2\nexit 42\n",
    );
    chmodSync(fakeNodePath, 0o755);

    const result = runGuard(
      '{}',
      baseEnv({ PATH: `${fakeBinDirectory}:${process.env.PATH ?? ''}` }),
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('exit 42');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('boom');
    expect(result.stderr).toContain('boom');
  });
});

describe('rebuildContents (BEFORE/AFTER reconstruction for Write/Edit/MultiEdit)', () => {
  it('Write, new file: BEFORE empty, AFTER = content', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const captureDirectory = createTempDirectory('kiko-prewrite-capture-');
    const stub = writeCapturingSemgrepStub(project, captureDirectory);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'new-file.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_CAPTURE_DIR: captureDirectory,
      }),
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(captureDirectory, 'before.txt'), 'utf8')).toBe('');
    expect(readFileSync(join(captureDirectory, 'after.txt'), 'utf8')).toBe(
      'export const value = 1;\n',
    );
  });

  it('Write, existing file: BEFORE = disk, AFTER = content', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const captureDirectory = createTempDirectory('kiko-prewrite-capture-');
    const stub = writeCapturingSemgrepStub(project, captureDirectory);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'existing-file.ts');
    writeFileSync(targetFile, 'export const value = 0;\n');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_CAPTURE_DIR: captureDirectory,
      }),
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(captureDirectory, 'before.txt'), 'utf8')).toBe(
      'export const value = 0;\n',
    );
    expect(readFileSync(join(captureDirectory, 'after.txt'), 'utf8')).toBe(
      'export const value = 1;\n',
    );
  });

  it('Edit: replaces the first occurrence only', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const captureDirectory = createTempDirectory('kiko-prewrite-capture-');
    const stub = writeCapturingSemgrepStub(project, captureDirectory);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'edit-file.ts');
    writeFileSync(targetFile, 'a X b X');

    const result = runGuard(
      payloadFor('Edit', { file_path: targetFile, old_string: 'X', new_string: 'Y' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_CAPTURE_DIR: captureDirectory,
      }),
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(captureDirectory, 'after.txt'), 'utf8')).toBe('a Y b X');
  });

  it('Edit replace_all: replaces every occurrence', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const captureDirectory = createTempDirectory('kiko-prewrite-capture-');
    const stub = writeCapturingSemgrepStub(project, captureDirectory);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'edit-file.ts');
    writeFileSync(targetFile, 'a X b X');

    const result = runGuard(
      payloadFor('Edit', {
        file_path: targetFile,
        old_string: 'X',
        new_string: 'Y',
        replace_all: true,
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_CAPTURE_DIR: captureDirectory,
      }),
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(captureDirectory, 'after.txt'), 'utf8')).toBe('a Y b Y');
  });

  it('Edit: keeps a literal $& in new_string, never a matched-substring backreference', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const captureDirectory = createTempDirectory('kiko-prewrite-capture-');
    const stub = writeCapturingSemgrepStub(project, captureDirectory);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'edit-file.ts');
    writeFileSync(targetFile, 'aXb');

    const result = runGuard(
      payloadFor('Edit', { file_path: targetFile, old_string: 'X', new_string: '$&' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_CAPTURE_DIR: captureDirectory,
      }),
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(captureDirectory, 'after.txt'), 'utf8')).toBe('a$&b');
  });

  it('MultiEdit: applies edits in array order on the running result', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const captureDirectory = createTempDirectory('kiko-prewrite-capture-');
    const stub = writeCapturingSemgrepStub(project, captureDirectory);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'multi-edit-file.ts');
    writeFileSync(targetFile, 'X');

    const result = runGuard(
      payloadFor('MultiEdit', {
        file_path: targetFile,
        edits: [
          { old_string: 'X', new_string: 'Y' },
          { old_string: 'Y', new_string: 'Z' },
        ],
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_CAPTURE_DIR: captureDirectory,
      }),
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(captureDirectory, 'after.txt'), 'utf8')).toBe('Z');
  });

  it('denies when old_string is not found verbatim', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const captureDirectory = createTempDirectory('kiko-prewrite-capture-');
    const stub = writeCapturingSemgrepStub(project, captureDirectory);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'edit-file.ts');
    writeFileSync(targetFile, 'hello world');

    const result = runGuard(
      payloadFor('Edit', { file_path: targetFile, old_string: 'NOTFOUND', new_string: 'X' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_CAPTURE_DIR: captureDirectory,
      }),
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('re-read');
  });

  it('mirrors the repo-relative path under before/ and after/', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const captureDirectory = createTempDirectory('kiko-prewrite-capture-');
    const stub = writeCapturingSemgrepStub(project, captureDirectory);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'screens', 'a', 'a.screen.tsx');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_TEST_CAPTURE_DIR: captureDirectory,
      }),
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(captureDirectory, 'argv.txt'), 'utf8')).toBe(
      'after/src/screens/a/a.screen.tsx',
    );
    // The BEFORE file is checked by the stub itself, while the guard's
    // mkdtemp scratch tree still exists — the guard removes it in its own
    // `finally` before this test process gets to run any assertion.
    expect(readFileSync(join(captureDirectory, 'before-exists.txt'), 'utf8')).toBe('yes');
  });
});

describe('Semgrep pass + new-findings-only diff', () => {
  it('allows when the only finding already existed on a shifted line', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'example.ts');
    const beforeContent = 'switch (x) {\n};\n';
    const afterContent = '\n\n\n\nswitch (x) {\n};\n';
    writeFileSync(targetFile, beforeContent);
    const needle = 'switch (x) {';
    const afterOffset = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_BEFORE: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'before/src/example.ts',
            line: 5,
            offsetStart: 0,
            offsetEnd: needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/example.ts',
            line: 9,
            offsetStart: afterOffset,
            offsetEnd: afterOffset + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(0);
  });

  it('denies a second textually identical violation (occurrence index)', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'example.ts');
    const beforeContent = 'switch (x) {\n};\n';
    const afterContent = 'switch (x) {\n};\nswitch (x) {\n};\n';
    writeFileSync(targetFile, beforeContent);
    const needle = 'switch (x) {';
    const firstOffset = afterContent.indexOf(needle);
    const secondOffset = afterContent.indexOf(needle, firstOffset + needle.length);

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_BEFORE: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'before/src/example.ts',
            line: 1,
            offsetStart: 0,
            offsetEnd: needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/example.ts',
            line: 1,
            offsetStart: firstOffset,
            offsetEnd: firstOffset + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/example.ts',
            line: 3,
            offsetStart: secondOffset,
            offsetEnd: secondOffset + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('example.ts:3');
    expect(reason).not.toContain('example.ts:1');
  });

  it('treats a whitespace-only reformat of a finding as pre-existing', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'example.ts');
    const beforeContent = 'switch (x)  {\n};\n';
    const afterContent = 'switch (x) {\n};\n';
    writeFileSync(targetFile, beforeContent);
    const beforeNeedle = 'switch (x)  {';
    const afterNeedle = 'switch (x) {';

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_BEFORE: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'before/src/example.ts',
            line: 1,
            offsetStart: 0,
            offsetEnd: beforeNeedle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/example.ts',
            line: 1,
            offsetStart: 0,
            offsetEnd: afterNeedle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(0);
  });

  it('strips the config-path prefix from check_id', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'new-file.ts');
    const afterContent = 'switch (x) {\n};\n';
    const needle = 'switch (x) {';

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/new-file.ts',
            line: 1,
            offsetStart: 0,
            offsetEnd: needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('kiko-no-switch');
    expect(reason).not.toContain('rules.kiko-no-switch');
  });

  it('slices matched text from offsets, not extra.lines', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'new-file.ts');
    const afterContent = 'const someActualCode = 1;\n';
    const needle = 'someActualCode';
    const offsetStart = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-history-id-comment',
            path: 'after/src/new-file.ts',
            line: 1,
            offsetStart,
            offsetEnd: offsetStart + needle.length,
            fix: 'remove the task id from the comment',
            skill: 'kiko-code-style › No history id comment',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('someActualCode');
    expect(reason).not.toContain('requires login');
  });

  it('slices matched text by UTF-8 byte offset, not UTF-16 code unit, for non-ASCII source', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'example.ts');
    const beforeContent = 'switch (x) {\n};\n';
    const afterContent = `// Кіко — гривня\n${beforeContent}`;
    writeFileSync(targetFile, beforeContent);
    const needle = 'switch (x) {';
    const beforeOffsetStart = beforeContent.indexOf(needle);
    const afterPrefix = afterContent.slice(0, afterContent.indexOf(needle));
    const afterOffsetStart = Buffer.byteLength(afterPrefix, 'utf8');
    const afterOffsetEnd = afterOffsetStart + Buffer.byteLength(needle, 'utf8');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_BEFORE: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'before/src/example.ts',
            line: 1,
            offsetStart: beforeOffsetStart,
            offsetEnd: beforeOffsetStart + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/example.ts',
            line: 2,
            offsetStart: afterOffsetStart,
            offsetEnd: afterOffsetEnd,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(0);
  });

  it('runs one semgrep process, AFTER only, when AFTER is clean', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const captureDirectory = createTempDirectory('kiko-prewrite-capture-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'new-file.ts');
    const counterFile = join(captureDirectory, 'counter.txt');
    const argvFile = join(captureDirectory, 'argv.json');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_AFTER: '[]',
        KIKO_PREWRITE_TEST_COUNTER_FILE: counterFile,
        KIKO_PREWRITE_TEST_ARGV_FILE: argvFile,
      }),
    );

    expect(result.status).toBe(0);
    expect(readFileSync(counterFile, 'utf8').trim().split('\n')).toEqual(['1']);
    expect(JSON.parse(readFileSync(argvFile, 'utf8'))).toEqual(['after/src/new-file.ts']);
  });

  // Semgrep's own default per-rule timeout (5 s) turns a slow rule into an
  // errors[] Timeout — a "could not check" deny at random under load. The
  // guard hands Semgrep its own remaining budget instead, in whole seconds,
  // so a slow rule finishes; the guard's own deadline still ends the child.
  it('passes semgrep a --timeout of whole seconds within the remaining budget', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const captureDirectory = createTempDirectory('kiko-prewrite-capture-');
    const argvFile = join(captureDirectory, 'argv.json');
    const stub = join(project, 'semgrep-argv-stub.js');
    writeFileSync(
      stub,
      [
        '#!/usr/bin/env node',
        'const fs = require("fs");',
        'const argumentList = process.argv.slice(2);',
        'fs.writeFileSync(process.env.KIKO_PREWRITE_TEST_ARGV_FILE, JSON.stringify(argumentList));',
        'const targets = argumentList.filter((item) => /^(before|after)\\//.test(item));',
        'process.stdout.write(JSON.stringify({ results: [], errors: [], paths: { scanned: targets } }));',
        '',
      ].join('\n'),
    );
    chmodSync(stub, 0o755);

    const result = runGuard(
      payloadFor('Write', {
        file_path: join(project, 'src', 'new-file.ts'),
        content: 'export const value = 1;\n',
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: writeRulesStub(project),
        KIKO_PREWRITE_TIMEOUT_MS: '20000',
        KIKO_PREWRITE_TEST_ARGV_FILE: argvFile,
      }),
    );

    expect(result.status).toBe(0);
    const argumentList: string[] = JSON.parse(readFileSync(argvFile, 'utf8'));
    const timeoutIndex = argumentList.indexOf('--timeout');
    expect(timeoutIndex).toBeGreaterThanOrEqual(0);
    const timeoutSeconds = argumentList[timeoutIndex + 1];
    expect(timeoutSeconds).toMatch(/^\d+$/);
    expect(Number(timeoutSeconds)).toBeGreaterThanOrEqual(1);
    expect(Number(timeoutSeconds)).toBeLessThanOrEqual(20);
  });

  it('runs one semgrep process over both trees when AFTER has findings', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const captureDirectory = createTempDirectory('kiko-prewrite-capture-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'example.ts');
    writeFileSync(targetFile, 'const value = 0;\n');
    const counterFile = join(captureDirectory, 'counter.txt');
    const argvFile = join(captureDirectory, 'argv.json');
    const afterContent = 'const someActualCode = 1;\n';
    const needle = 'someActualCode';
    const offsetStart = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_BEFORE: '[]',
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-history-id-comment',
            path: 'after/src/example.ts',
            line: 1,
            offsetStart,
            offsetEnd: offsetStart + needle.length,
            fix: 'remove the task id from the comment',
            skill: 'kiko-code-style › No history id comment',
          }),
        ]),
        KIKO_PREWRITE_TEST_COUNTER_FILE: counterFile,
        KIKO_PREWRITE_TEST_ARGV_FILE: argvFile,
      }),
    );

    expect(result.status).toBe(2);
    expect(readFileSync(counterFile, 'utf8').trim().split('\n')).toEqual(['1']);
    expect(JSON.parse(readFileSync(argvFile, 'utf8'))).toEqual([
      'before/src/example.ts',
      'after/src/example.ts',
    ]);
  });

  it('deny reason lists rule id, AFTER line, matched text, fix and skill', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'new-file.ts');
    const afterContent = 'const someActualCode = 1;\n';
    const needle = 'someActualCode';
    const offsetStart = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-history-id-comment',
            path: 'after/src/new-file.ts',
            line: 42,
            offsetStart,
            offsetEnd: offsetStart + needle.length,
            fix: 'remove the task id from the comment',
            skill: 'kiko-code-style › No history id comment',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('kiko-no-history-id-comment');
    expect(reason).toContain('42');
    expect(reason).toContain('someActualCode');
    expect(reason).toContain('remove the task id from the comment');
    expect(reason).toContain('kiko-code-style › No history id comment');
  });

  it('denies when a finding lacks metadata.skill', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'new-file.ts');
    const afterContent = 'const someActualCode = 1;\n';
    const needle = 'someActualCode';
    const offsetStart = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-undocumented-rule',
            path: 'after/src/new-file.ts',
            line: 1,
            offsetStart,
            offsetEnd: offsetStart + needle.length,
            fix: 'do the right thing',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('metadata.skill');
  });
});

// Rules 4, 5, 6 run the REAL checker scripts (scripts/checks/import-order.js,
// full-word-identifiers.js, one-component-per-file.ts) against the mirrored
// tree — only Semgrep is stubbed clean here (writeSemgrepStub/writeRulesStub),
// per the brief's "use real checkers, stub Semgrep clean". The
// new-findings-only diff (allow when a pre-existing violation survives
// unchanged) mirrors the Semgrep describe block above, proven here against a
// Node-checker finding instead of a Semgrep one.
describe('runNodeChecks (rules 4, 5, 6: import-order, full-word-identifiers, one-component-per-file)', () => {
  it('denies an edit that breaks import order (kiko-import-order)', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', {
        file_path: targetFile,
        content: [
          "import { local } from './local';",
          '',
          "import React from 'react';",
          '',
          'export const value = 1;',
          '',
        ].join('\n'),
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('kiko-import-order');
    expect(reason).toContain('out of order');
  });

  it('allows an unrelated edit in a file whose import order was already broken', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'example.ts');
    writeFileSync(
      targetFile,
      [
        "import { local } from './local';",
        '',
        "import React from 'react';",
        '',
        'export const value = 1;',
        '',
      ].join('\n'),
    );

    const result = runGuard(
      payloadFor('Edit', {
        file_path: targetFile,
        old_string: 'export const value = 1;',
        new_string: 'export const value = 2;',
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(0);
  });

  it('denies a new abbreviated identifier (kiko-full-word-identifiers)', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: "export const msg = 'hi';\n" }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('kiko-full-word-identifiers');
    expect(reason).toContain('msg');
  });

  it('honors full-word-identifiers EXEMPTIONS by path suffix', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src', 'db'), { recursive: true });
    const targetFile = join(project, 'src', 'db', 'run-migrations.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const idx = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(0);
  });

  it('denies a second exported component in a .tsx (kiko-one-component-per-file)', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'example.screen.tsx');

    const result = runGuard(
      payloadFor('Write', {
        file_path: targetFile,
        content: [
          'export function Foo() {',
          '  return <View />;',
          '}',
          '',
          'export function Bar() {',
          '  return <View />;',
          '}',
          '',
        ].join('\n'),
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('kiko-one-component-per-file');
    expect(reason).toContain('Bar');
  });

  it('does not run the component check on a .ts file', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', {
        file_path: targetFile,
        content: [
          'export function Foo() {',
          '  return <View />;',
          '}',
          '',
          'export function Bar() {',
          '  return <View />;',
          '}',
          '',
        ].join('\n'),
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(0);
  });

  it('denies when a Node checker exits with a code other than 0 or 1', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const nodeStubPath = join(project, 'node-stub.sh');
    writeFileSync(nodeStubPath, '#!/usr/bin/env bash\nexit 3\n');
    chmodSync(nodeStubPath, 0o755);
    const targetFile = join(project, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_NODE_BIN: nodeStubPath,
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('exited 3');
  });

  it('denies when a Node checker crashes with exit 1, empty stdout, and stderr output', () => {
    // A crashing checker (for example a syntax error introduced into
    // blank-line-separation.js) can also exit 1 — the SAME code a real
    // violation report uses — with empty stdout. Parsing that empty stdout
    // to zero findings would silently allow the write instead of denying it,
    // which is exactly what would let a broken checker disable its own rule
    // unnoticed. Any stderr output on a Node-checker child is treated as a
    // crash, never a clean run's exit 1.
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const nodeStubPath = join(project, 'node-stub.sh');
    writeFileSync(nodeStubPath, '#!/usr/bin/env bash\necho "TypeError: boom" >&2\nexit 1\n');
    chmodSync(nodeStubPath, 0o755);
    const targetFile = join(project, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_NODE_BIN: nodeStubPath,
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('boom');
  });

  it('denies when a Node checker exits 1 but its stdout parses to zero findings', () => {
    // Exit 1 with stdout that never matches any parseOutput pattern is the
    // OTHER shape a crash can take (no stderr, but no real violation line
    // either) — the same fail-closed contract as the stderr case above, on
    // the stdout side instead.
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const nodeStubPath = join(project, 'node-stub.sh');
    writeFileSync(
      nodeStubPath,
      '#!/usr/bin/env bash\necho "unexpected output with no violation line"\nexit 1\n',
    );
    chmodSync(nodeStubPath, 0o755);
    const targetFile = join(project, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_NODE_BIN: nodeStubPath,
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('no findings');
  });
});

// M3: spawnAsync decoded each stdout/stderr `data` chunk on its own (the
// implicit Buffer-to-string coercion in `stdout += chunk` defaults to
// per-chunk UTF-8), so a multibyte character split across two chunks
// decoded to a replacement character in one call but not the other. This
// stub reports the SAME pre-existing finding (an accented "e", a 2-byte
// UTF-8 sequence, inside the reported name) for both the BEFORE and AFTER
// mirrored file, but only splits the AFTER call stdout into two separate
// writes around a sleep — a real multibyte identifier read consistently on
// both sides must never read as a NEW violation.
describe('spawnAsync stdout decoding (M3: multibyte character split across chunks)', () => {
  function writeMultibyteFullWordStub(directory: string): string {
    const stubPath = join(directory, 'node-multibyte-stub.sh');
    writeFileSync(
      stubPath,
      [
        '#!/usr/bin/env bash',
        'scriptPath="$1"',
        'targetFile="$2"',
        '',
        'case "$scriptPath" in',
        '  */full-word-identifiers.js) : ;;',
        '  *) exit 0 ;;',
        'esac',
        '',
        'case "$targetFile" in',
        '  */after/*)',
        '    # Splits the accented e 2-byte UTF-8 sequence across two separate',
        '    # stdout writes with a sleep between them, so the AFTER call',
        '    # stdout arrives as two separate data events -- the pre-fix',
        '    # spawnAsync bug (M3) decodes each event on its own and corrupts',
        '    # the split character, unlike the BEFORE call below (one single,',
        '    # unsplit write).',
        '    printf "%s:1: \\`caf" "$targetFile"',
        '    printf "\\xc3"',
        '    sleep 0.2',
        '    printf "\\xa9\\` \\xe2\\x80\\x94 abbreviated word \\`abc\\` (write the full word)\\n"',
        '    ;;',
        '  *)',
        '    printf "%s:1: \\`caf\\xc3\\xa9\\` \\xe2\\x80\\x94 abbreviated word \\`abc\\` (write the full word)\\n" "$targetFile"',
        '    ;;',
        'esac',
        '',
        'exit 1',
        '',
      ].join('\n'),
    );
    chmodSync(stubPath, 0o755);

    return stubPath;
  }

  it('keeps a pre-existing multibyte finding from reading as new when only its AFTER read is chunk-split', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const semgrepStub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const nodeStub = writeMultibyteFullWordStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'example.ts');
    writeFileSync(targetFile, 'export const value = 0;\n');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: semgrepStub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_NODE_BIN: nodeStub,
      }),
    );

    expect(result.status).toBe(0);
  });
});

// Rule 11: the REAL blank-line-separation.js checker against the mirrored
// tree — only Semgrep is stubbed clean here, the same convention as the
// rules 4/5/6 describe block above.
describe('runNodeChecks (rule 11: blank-line-separation)', () => {
  it('denies an edit that adds a return with no blank line above (kiko-blank-line-separation)', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', {
        file_path: targetFile,
        content: [
          'export function foo(value: number): number {',
          '  const doubled = value * 2;',
          '  return doubled;',
          '}',
          '',
        ].join('\n'),
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('kiko-blank-line-separation');
    expect(reason).toContain('return doubled;');
  });

  it('allows renaming an identifier inside an already-unseparated return (M1)', () => {
    // M1: the diff key must be the violation's KIND (return/if/for/while/
    // jsx), not the statement text itself — otherwise editing the text of an
    // EXISTING unseparated statement (renaming a variable it returns) reads
    // as a brand-new violation and denies an edit that changes nothing about
    // the separation the rule enforces.
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'example.ts');
    writeFileSync(
      targetFile,
      [
        'export function foo(value: number): number {',
        '  const total = value * 2;',
        '  return total;',
        '}',
        '',
      ].join('\n'),
    );

    const result = runGuard(
      payloadFor('Edit', {
        file_path: targetFile,
        old_string: 'return total;',
        new_string: 'return sum;',
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(0);
  });
});

// Rule 12: the REAL screen-imports.js checker against the mirrored tree —
// only Semgrep is stubbed clean here, the same convention as rule 11 above.
// This rule is Node-checked, not Semgrep, because Semgrep cannot resolve a
// RELATIVE specifier ('../../b/y') against the importing file's own path
// (spec deviation 1) — deciding "screen-a" vs "screen-b" requires exactly
// that resolution.
describe('runNodeChecks (rule 12: no-cross-screen-import)', () => {
  it('denies an edit that adds a cross-screen import (kiko-no-cross-screen-import)', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'screens', 'a', 'forms', 'x.tsx');

    const result = runGuard(
      payloadFor('Write', {
        file_path: targetFile,
        content: "import { Thing } from '../../b/y';\n",
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('kiko-no-cross-screen-import');
    expect(reason).toContain('../../b/y');
  });
});

// The override protocol: a rule-id-specific comment naming the rule and
// carrying OVERRIDE(<reason>) — `nosemgrep: <id> OVERRIDE(reason) why` for
// Semgrep rules, `kiko-override: <id> OVERRIDE(reason) why` for Node-checked
// rules — placed on the finding's own line or the line directly above it.
// Semgrep runs with --disable-nosem (see runSemgrep), so the guard alone
// decides; a bare comment with no OVERRIDE(...) never suppresses a finding,
// exactly like an unexplained Biome ignore comment.
describe('override protocol (nosemgrep / kiko-override)', () => {
  it('allows a new finding with `// nosemgrep: <id> OVERRIDE(reason) why` on the line above', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'new-file.ts');
    const afterContent = [
      '// nosemgrep: kiko-no-switch OVERRIDE(reason) legacy fallthrough kept intentionally',
      'switch (x) {',
      '};',
      '',
    ].join('\n');
    const needle = 'switch (x) {';
    const offsetStart = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/new-file.ts',
            line: 2,
            offsetStart,
            offsetEnd: offsetStart + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(0);
  });

  it('allows a new finding with the override on the same line', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'new-file.ts');
    const afterContent = [
      'switch (x) { // nosemgrep: kiko-no-switch OVERRIDE(reason) legacy fallthrough kept intentionally',
      '};',
      '',
    ].join('\n');
    const needle = 'switch (x) {';
    const offsetStart = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/new-file.ts',
            line: 1,
            offsetStart,
            offsetEnd: offsetStart + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(0);
  });

  it('allows a new finding with a block-comment `/* nosemgrep: <id> OVERRIDE(...) */` override', () => {
    // I2: the only comment form JSX allows (`{/* ... */}`) must justify a
    // finding exactly like the `//` line-comment form does.
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'new-file.ts');
    const afterContent = [
      '/* nosemgrep: kiko-no-switch OVERRIDE(reason) legacy fallthrough kept intentionally */',
      'switch (x) {',
      '};',
      '',
    ].join('\n');
    const needle = 'switch (x) {';
    const offsetStart = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/new-file.ts',
            line: 2,
            offsetStart,
            offsetEnd: offsetStart + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(0);
  });

  it('denies a new finding under a bare nosemgrep comment with no OVERRIDE(...)', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'new-file.ts');
    // Split across `+` so this fixture's own bare override comment never
    // appears contiguous in THIS file's source text — that exact shape is
    // what npm run check:overrides itself flags as unjustified.
    const bareOverrideComment = `${'// nosem'}grep: kiko-no-switch`;
    const afterContent = [bareOverrideComment, 'switch (x) {', '};', ''].join('\n');
    const needle = 'switch (x) {';
    const offsetStart = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/new-file.ts',
            line: 2,
            offsetStart,
            offsetEnd: offsetStart + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('bare');
    expect(reason).toContain('kiko-no-switch');
  });

  it('denies an override naming a different rule id', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'new-file.ts');
    const afterContent = [
      '// nosemgrep: kiko-other-rule OVERRIDE(reason) unrelated justification',
      'switch (x) {',
      '};',
      '',
    ].join('\n');
    const needle = 'switch (x) {';
    const offsetStart = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: afterContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/new-file.ts',
            line: 2,
            offsetStart,
            offsetEnd: offsetStart + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('kiko-no-switch');
  });

  it('allows a Node-rule finding with `// kiko-override: kiko-import-order OVERRIDE(...) why`', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'example.ts');

    // import-order.js's own finding is always pinned to line 1 (it flags the
    // leading header as a whole, not one statement — see
    // parseImportOrderCheckerOutput), and a comment TRAILING an import
    // statement breaks that checker's own statement-end parsing, so the
    // override comment has to be its own line ABOVE the import block, which
    // import-order.js already treats as a pinned "block prefix" of the first
    // group rather than part of any import statement.
    const result = runGuard(
      payloadFor('Write', {
        file_path: targetFile,
        content: [
          '// kiko-override: kiko-import-order OVERRIDE(reason) legacy ordering kept intentionally',
          "import { local } from './local';",
          '',
          "import React from 'react';",
          '',
          'export const value = 1;',
          '',
        ].join('\n'),
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(0);
  });

  it('denies a bare kiko-override comment with no OVERRIDE(...)', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const targetFile = join(project, 'src', 'example.ts');

    // Split across `+`, same reason as bareOverrideComment above.
    const bareOverrideComment = `${'// kiko-over'}ride: kiko-import-order`;
    const result = runGuard(
      payloadFor('Write', {
        file_path: targetFile,
        content: [
          bareOverrideComment,
          "import { local } from './local';",
          '',
          "import React from 'react';",
          '',
          'export const value = 1;',
          '',
        ].join('\n'),
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('kiko-import-order');
    expect(reason).toContain('bare');
  });

  it('denies when an edit deletes a justified override that suppressed a BEFORE finding', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'example.ts');
    const overrideLine =
      '// nosemgrep: kiko-no-switch OVERRIDE(reason) legacy fallthrough kept intentionally\n';
    const beforeContent = `${overrideLine}switch (x) {\n};\n`;
    const afterContent = 'switch (x) {\n};\n';
    writeFileSync(targetFile, beforeContent);
    const needle = 'switch (x) {';
    const beforeOffsetStart = beforeContent.indexOf(needle);
    const afterOffsetStart = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Edit', { file_path: targetFile, old_string: overrideLine, new_string: '' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_BEFORE: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'before/src/example.ts',
            line: 2,
            offsetStart: beforeOffsetStart,
            offsetEnd: beforeOffsetStart + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/example.ts',
            line: 1,
            offsetStart: afterOffsetStart,
            offsetEnd: afterOffsetStart + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(2);
  });

  it('denies when an edit adds a bare override above a pre-existing finding', () => {
    // I1: the finding itself is NOT new (it exists in both before and
    // after), but the bare override the edit adds above it never suppresses
    // anything — check:security still honours it as a blanket comment, so
    // leaving it un-flagged just because the underlying finding is old would
    // let a bare override slip past this guard entirely.
    const project = createTempDirectory('kiko-prewrite-project-');
    const stub = writeFindingsStub(project);
    const rules = writeRulesStub(project);
    mkdirSync(join(project, 'src'), { recursive: true });
    const targetFile = join(project, 'src', 'example.ts');
    const bareOverrideComment = `${'// nosem'}grep: kiko-no-switch`;
    const beforeContent = 'switch (x) {\n};\n';
    const afterContent = `${bareOverrideComment}\nswitch (x) {\n};\n`;
    writeFileSync(targetFile, beforeContent);
    const needle = 'switch (x) {';
    const beforeOffsetStart = beforeContent.indexOf(needle);
    const afterOffsetStart = afterContent.indexOf(needle);

    const result = runGuard(
      payloadFor('Edit', {
        file_path: targetFile,
        old_string: 'switch (x) {',
        new_string: `${bareOverrideComment}\nswitch (x) {`,
      }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: stub,
        KIKO_PREWRITE_RULES: rules,
        STUB_RESULTS_BEFORE: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'before/src/example.ts',
            line: 1,
            offsetStart: beforeOffsetStart,
            offsetEnd: beforeOffsetStart + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
        STUB_RESULTS_AFTER: JSON.stringify([
          rawResult({
            checkId: 'rules.kiko-no-switch',
            path: 'after/src/example.ts',
            line: 2,
            offsetStart: afterOffsetStart,
            offsetEnd: afterOffsetStart + needle.length,
            fix: 'use ts-pattern match(...).exhaustive()',
            skill: 'kiko-code-style › No switch',
          }),
        ]),
      }),
    );

    expect(result.status).toBe(2);
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('bare');
    expect(reason).toContain('kiko-no-switch');
  });
});

// Task 20 (speed measurement): on a large real .tsx file, the 4 spawned Node
// checkers (import-order, full-word-identifiers, blank-line-separation,
// screen-imports) running one after another via spawnSync pushed p50/p95
// past the 3s target. The mitigation is to run them concurrently instead
// (spawn, not spawnSync) — same results, since each checker only ever reads
// the SAME mirrored file and reports its own findings independently of the
// others. This stub sleeps a fixed duration per invocation so the test can
// tell "ran one after another" (roughly 4x the sleep) from "ran together"
// (roughly ONE sleep) by wall-clock alone, without depending on real
// checker runtimes that could vary by machine.
describe('runNodeChecks concurrency (Task 20 speed mitigation)', () => {
  function writeSleepingNodeStub(directory: string): string {
    const stubPath = join(directory, 'node-sleep-stub.sh');
    writeFileSync(
      stubPath,
      ['#!/usr/bin/env bash', 'sleep "$NODE_STUB_SLEEP_SECONDS"', 'exit 0', ''].join('\n'),
    );
    chmodSync(stubPath, 0o755);

    return stubPath;
  }

  const cleanComponentContent = [
    "import type { FC } from 'react';",
    "import { Text } from 'react-native';",
    '',
    'const ExampleComponent: FC = () => {',
    '  return <Text>Example</Text>;',
    '};',
    '',
    'export default ExampleComponent;',
    '',
  ].join('\n');

  it('runs the 4 spawned AFTER-tree Node checkers concurrently, not one after another', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const semgrepStub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const nodeStub = writeSleepingNodeStub(project);
    const targetFile = join(project, 'src', 'component', 'component.tsx');

    const startTime = Date.now();
    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: cleanComponentContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: semgrepStub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_NODE_BIN: nodeStub,
        NODE_STUB_SLEEP_SECONDS: '1',
      }),
    );
    const durationMilliseconds = Date.now() - startTime;

    expect(result.status).toBe(0);
    // Sequential: 4 * 1s of stub sleep alone is >= 4000ms. Concurrent: the
    // whole AFTER-tree Node-check phase takes roughly ONE sleep.
    expect(durationMilliseconds).toBeGreaterThanOrEqual(900);
    expect(durationMilliseconds).toBeLessThan(2500);
  });

  it('runs Semgrep concurrently with the AFTER-tree Node checkers, not one after the other', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const semgrepStub = writeSemgrepStub(project);
    const rules = writeRulesStub(project);
    const nodeStub = writeSleepingNodeStub(project);
    const targetFile = join(project, 'src', 'component', 'component.tsx');

    const startTime = Date.now();
    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: cleanComponentContent }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_SEMGREP_BIN: semgrepStub,
        KIKO_PREWRITE_RULES: rules,
        KIKO_PREWRITE_NODE_BIN: nodeStub,
        NODE_STUB_SLEEP_SECONDS: '1',
        STUB_SLEEP: '1',
      }),
    );
    const durationMilliseconds = Date.now() - startTime;

    expect(result.status).toBe(0);
    // Sequential: Semgrep's own 1s sleep, THEN the (already-concurrent) 1s
    // Node-check phase, is roughly 2000ms. Concurrent: both phases overlap,
    // so the whole guard invocation takes roughly ONE sleep.
    expect(durationMilliseconds).toBeGreaterThanOrEqual(900);
    expect(durationMilliseconds).toBeLessThan(1800);
  });
});

// I2: Promise.all rejects the moment its FIRST promise rejects, without
// waiting for its still-running siblings — so a fast rejection (Semgrep's
// own `fs.accessSync` throwing synchronously on an unreadable rules file,
// before it even spawns) let `run`'s fail-closed catch/finally rmSync the
// shared mkdtemp root while the 4 spawned Node checkers, real child
// processes still mid-flight, were reading files under it. This describe
// block never configures a Semgrep binary at all: an unreadable rules file
// makes runSemgrep throw before it would ever spawn one.
describe('temp root lifetime vs a fast-rejecting sibling (I2)', () => {
  function writeExistenceCheckingNodeStub(directory: string, markerPath: string): string {
    const stubPath = join(directory, 'node-existence-stub.sh');
    writeFileSync(
      stubPath,
      [
        '#!/usr/bin/env bash',
        'targetFile="$2"',
        'sleep 0.3',
        'if [ -f "$targetFile" ]; then',
        `  printf 'existed\\n' >> "${markerPath}"`,
        'else',
        `  printf 'missing\\n' >> "${markerPath}"`,
        'fi',
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(stubPath, 0o755);

    return stubPath;
  }

  it('lets a slower Node checker finish reading its mirrored file before the temp root is removed', () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const missingRules = join(project, 'rules', 'semgrep-prewrite.yml');
    const marker = join(project, 'marker.txt');
    const nodeStub = writeExistenceCheckingNodeStub(project, marker);
    const targetFile = join(project, 'src', 'example.ts');

    const result = runGuard(
      payloadFor('Write', { file_path: targetFile, content: 'export const value = 1;\n' }),
      baseEnv({
        CLAUDE_PROJECT_DIR: project,
        KIKO_PREWRITE_RULES: missingRules,
        KIKO_PREWRITE_NODE_BIN: nodeStub,
      }),
    );

    expect(result.status).toBe(2);
    const markerContent = readFileSync(marker, 'utf8');
    expect(markerContent).not.toContain('missing');
    expect(markerContent).toContain('existed');
  });
});

// Task 21b: harness/kiko/hooks/hooks.json wires this script onto PreToolUse
// for Edit/Write/MultiEdit, alongside the existing Bash matcher
// (kill-guard.sh), through the plugin's own dispatch.sh — every entry reads
// "${CLAUDE_PLUGIN_ROOT}/hooks/dispatch.sh <script-name>" rather than a
// hardcoded "${CLAUDE_PROJECT_DIR}/scripts/checks/<script-name>", so a
// subagent whose CLAUDE_PROJECT_DIR is a DIFFERENT checkout than the file it
// is editing still reaches THAT file's own worktree script (see
// harness/kiko/hooks/dispatch.sh's own header and
// __tests__/hook-dispatch.test.ts for the dispatcher's own behavior). These
// tests parse the real hooks.json and execute the wired command string
// itself via `bash -c`, so a wiring regression (a typo in the command, a
// missing matcher, the dispatcher path dropped) fails here even though
// every other describe block above already covers the script's own
// behavior.
describe('PreToolUse wiring in harness/kiko/hooks/hooks.json', () => {
  const hooksJsonPath = join(__dirname, '../harness/kiko/hooks/hooks.json');
  const repoRoot = join(__dirname, '..');
  const pluginRoot = join(repoRoot, 'harness', 'kiko');

  function readHooksConfig(): {
    hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
  } {
    return JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
  }

  function preToolUseCommand(matcher: string): string {
    const hooksConfig = readHooksConfig();
    const matcherEntry = hooksConfig.hooks.PreToolUse.find((entry) => entry.matcher === matcher);

    if (!matcherEntry) throw new Error(`no PreToolUse matcher for ${matcher}`);

    return matcherEntry.hooks[0].command;
  }

  it('keeps the existing Bash matcher alongside a new Edit|Write|MultiEdit matcher', () => {
    const hooksConfig = readHooksConfig();
    const matchers = hooksConfig.hooks.PreToolUse.map((entry) => entry.matcher);

    expect(matchers).toContain('Bash');
    expect(matchers).toContain('Edit|Write|MultiEdit');
  });

  it('exits 0 with empty stdout when the resolved root has no guard script', () => {
    const command = preToolUseCommand('Edit|Write|MultiEdit');
    const missingProject = createTempDirectory('kiko-prewrite-wiring-');

    // Malformed (empty) stdin resolves neither a file_path nor a cwd, so the
    // dispatcher falls back to CLAUDE_PROJECT_DIR — this exercises that same
    // fallback path, landing on a root with no scripts/checks/ at all.
    const result = spawnSync('bash', ['-c', command], {
      input: '',
      encoding: 'utf8',
      env: baseEnv({ CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: missingProject }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('reaches the guard script for a file in this repo', () => {
    const command = preToolUseCommand('Edit|Write|MultiEdit');
    const targetFile = join(repoRoot, 'README.md');

    // A non-.ts/.tsx target lets the real guard allow the write without
    // ever invoking semgrep — this alone proves the wired command reached
    // scripts/checks/pre-write-guard.sh, not that semgrep behaves. The
    // dispatcher resolves the root from this repo's own `git rev-parse
    // --show-toplevel`, not from CLAUDE_PROJECT_DIR.
    const allowResult = spawnSync('bash', ['-c', command], {
      input: payloadFor('Write', { file_path: targetFile, content: 'hello' }),
      encoding: 'utf8',
      env: baseEnv({ CLAUDE_PLUGIN_ROOT: pluginRoot }),
    });

    expect(allowResult.status).toBe(0);

    // A malformed stdin payload cannot resolve a file_path, so the
    // dispatcher falls back to CLAUDE_PROJECT_DIR here; the guard itself
    // then denies before it ever reaches semgrep, so this is safe to run
    // unstubbed against the real repo too.
    const denyResult = spawnSync('bash', ['-c', command], {
      input: '{not valid json',
      encoding: 'utf8',
      env: baseEnv({ CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: repoRoot }),
    });

    expect(denyResult.status).toBe(2);
    const parsed = JSON.parse(denyResult.stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
  });
});
