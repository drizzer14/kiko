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
      'printf \'%s\' \'{"results":[],"errors":[],"paths":{"scanned":[]}}\'',
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
      'printf \'%s\' \'{"results":[],"errors":[],"paths":{"scanned":[]}}\'',
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(stubPath, 0o755);
  mkdirSync(captureDirectory, { recursive: true });
  return stubPath;
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
  it("denies via the wrapper's own JSON when node exits with an unexpected code", () => {
    const project = createTempDirectory('kiko-prewrite-project-');
    const fakeBinDirectory = join(project, 'fake-bin');
    mkdirSync(fakeBinDirectory);
    const fakeNodePath = join(fakeBinDirectory, 'node');
    writeFileSync(fakeNodePath, "#!/usr/bin/env bash\nprintf 'boom' >&2\nexit 42\n");
    chmodSync(fakeNodePath, 0o755);

    const result = runGuard(
      '{}',
      baseEnv({ PATH: `${fakeBinDirectory}:${process.env.PATH ?? ''}` }),
    );

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('exit 42');
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
