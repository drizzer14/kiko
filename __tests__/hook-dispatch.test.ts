import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// harness/kiko/hooks/dispatch.sh is the plugin's own hook dispatcher: every
// hooks.json entry now invokes `dispatch.sh <script-name>` instead of a
// hardcoded `${CLAUDE_PROJECT_DIR}/scripts/checks/<script-name>`. The
// dispatcher resolves the EDITED file's own worktree (or the payload's own
// `cwd` for a tool-less hook) and runs THAT worktree's script, so a subagent
// started in one checkout but editing a file that lives in another worktree
// never runs the coordinator's copy of the rules against a file it does not
// own. See dispatch.sh's own header comment for the full design and
// docs/superpowers/specs/2026-09-25-pre-write-guard-design.md ("Trigger and
// wiring") for why.
const DISPATCH = join(__dirname, '../harness/kiko/hooks/dispatch.sh');

const createdPaths: string[] = [];

function createTempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  createdPaths.push(directory);

  return directory;
}

function initGitRepository(prefix: string): string {
  const directory = createTempDirectory(prefix);
  const result = spawnSync('git', ['init', '--quiet', directory], { encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`git init failed: ${result.stderr}`);
  }

  return directory;
}

// A stub scripts/checks/<name>.sh that proves WHICH root's copy ran (by
// recording its own CLAUDE_PROJECT_DIR and the exact stdin bytes it
// received into a marker file) and exits with a caller-chosen code and
// stdout/stderr, so the dispatcher's own pass-through can be asserted
// byte-for-byte.
function writeStubScript(
  repositoryRoot: string,
  scriptName: string,
  markerFile: string,
  options: { exitCode?: number; stdoutText?: string; stderrText?: string } = {},
): void {
  const exitCode = options.exitCode ?? 0;
  const stdoutText = options.stdoutText ?? 'stub stdout';
  const stderrText = options.stderrText ?? 'stub stderr';
  const checksDirectory = join(repositoryRoot, 'scripts', 'checks');
  mkdirSync(checksDirectory, { recursive: true });
  const scriptPath = join(checksDirectory, scriptName);
  writeFileSync(
    scriptPath,
    [
      '#!/usr/bin/env bash',
      'stdinBytes="$(cat)"',
      `{ printf 'CLAUDE_PROJECT_DIR=%s\\n' "$CLAUDE_PROJECT_DIR"; printf 'STDIN=%s\\n' "$stdinBytes"; } > "${markerFile}"`,
      `printf '%s' "${stdoutText}"`,
      `printf '%s' "${stderrText}" >&2`,
      `exit ${exitCode}`,
      '',
    ].join('\n'),
  );
  chmodSync(scriptPath, 0o755);
}

function payloadForFile(filePath: string, content = 'stub content'): string {
  return JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath, content } });
}

function payloadForCwd(cwd: string): string {
  return JSON.stringify({ cwd });
}

function runDispatch(
  scriptName: string,
  input: string,
  env: NodeJS.ProcessEnv,
): SpawnSyncReturns<string> {
  return spawnSync('bash', [DISPATCH, scriptName], { input, encoding: 'utf8', env });
}

afterEach(() => {
  while (createdPaths.length > 0) {
    const directory = createdPaths.pop();

    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('harness/kiko/hooks/dispatch.sh', () => {
  it("runs the target file's OWN worktree script, not CLAUDE_PROJECT_DIR's", () => {
    const wrongRepository = initGitRepository('kiko-dispatch-wrong-');
    const rightRepository = initGitRepository('kiko-dispatch-right-');
    const wrongMarker = join(wrongRepository, 'marker.txt');
    const rightMarker = join(rightRepository, 'marker.txt');
    writeStubScript(wrongRepository, 'fast.sh', wrongMarker);
    writeStubScript(rightRepository, 'fast.sh', rightMarker);
    const targetFile = join(rightRepository, 'src', 'example.ts');
    mkdirSync(join(rightRepository, 'src'), { recursive: true });

    const result = runDispatch('fast.sh', payloadForFile(targetFile), {
      ...process.env,
      CLAUDE_PROJECT_DIR: wrongRepository,
    });

    expect(result.status).toBe(0);
    expect(existsSync(wrongMarker)).toBe(false);
    expect(existsSync(rightMarker)).toBe(true);
    const marker = readFileSync(rightMarker, 'utf8');
    // `git rev-parse --show-toplevel` resolves symlinks (macOS's /tmp ->
    // /private/tmp among them), so compare against the realpath, the same
    // way pre-write-guard.js itself resolves both sides before comparing.
    expect(marker).toContain(`CLAUDE_PROJECT_DIR=${realpathSync(rightRepository)}`);
  });

  it('is a no-op (exit 0, no output) when the resolved root has no such script', () => {
    const repository = initGitRepository('kiko-dispatch-absent-');
    const targetFile = join(repository, 'src', 'example.ts');
    mkdirSync(join(repository, 'src'), { recursive: true });

    const result = runDispatch('fast.sh', payloadForFile(targetFile), { ...process.env });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('resolves a new file under a not-yet-created directory via the nearest existing parent', () => {
    const repository = initGitRepository('kiko-dispatch-newdir-');
    const marker = join(repository, 'marker.txt');
    writeStubScript(repository, 'fast.sh', marker);
    const targetFile = join(repository, 'src', 'brand-new-folder', 'nested', 'example.ts');

    const result = runDispatch('fast.sh', payloadForFile(targetFile), { ...process.env });

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, 'utf8')).toContain(
      `CLAUDE_PROJECT_DIR=${realpathSync(repository)}`,
    );
  });

  it('passes stdin through byte-identical (no trailing-newline normalization)', () => {
    const repository = initGitRepository('kiko-dispatch-stdin-');
    const marker = join(repository, 'marker.txt');
    const echoScriptPath = join(repository, 'scripts', 'checks', 'fast.sh');
    mkdirSync(join(repository, 'scripts', 'checks'), { recursive: true });
    writeFileSync(
      echoScriptPath,
      ['#!/usr/bin/env bash', `cat > "${marker}"`, 'exit 0', ''].join('\n'),
    );
    chmodSync(echoScriptPath, 0o755);
    const targetFile = join(repository, 'src', 'example.ts');
    mkdirSync(join(repository, 'src'), { recursive: true });
    const exactPayload = `${payloadForFile(targetFile)}\n\n\t `;

    const result = runDispatch('fast.sh', exactPayload, { ...process.env });

    expect(result.status).toBe(0);
    expect(readFileSync(marker, 'utf8')).toBe(exactPayload);
  });

  it.each([0, 2, 5])('passes exit code %i and stdout/stderr through unchanged', (exitCode) => {
    const repository = initGitRepository(`kiko-dispatch-exit-${exitCode}-`);
    const marker = join(repository, 'marker.txt');
    writeStubScript(repository, 'fast.sh', marker, {
      exitCode,
      stdoutText: `stdout-for-${exitCode}`,
      stderrText: `stderr-for-${exitCode}`,
    });
    const targetFile = join(repository, 'src', 'example.ts');
    mkdirSync(join(repository, 'src'), { recursive: true });

    const result = runDispatch('fast.sh', payloadForFile(targetFile), { ...process.env });

    expect(result.status).toBe(exitCode);
    expect(result.stdout).toBe(`stdout-for-${exitCode}`);
    expect(result.stderr).toBe(`stderr-for-${exitCode}`);
  });

  it("resolves a Bash/Stop-style payload's root from its own cwd field", () => {
    const repository = initGitRepository('kiko-dispatch-cwd-');
    const marker = join(repository, 'marker.txt');
    writeStubScript(repository, 'kill-guard.sh', marker);

    const result = runDispatch('kill-guard.sh', payloadForCwd(repository), { ...process.env });

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, 'utf8')).toContain(`CLAUDE_PROJECT_DIR=${repository}`);
  });

  it('falls back to CLAUDE_PROJECT_DIR when neither file_path nor cwd resolves (empty payload)', () => {
    const repository = initGitRepository('kiko-dispatch-fallback-empty-');
    const marker = join(repository, 'marker.txt');
    writeStubScript(repository, 'medium.sh', marker);

    const result = runDispatch('medium.sh', '{}', {
      ...process.env,
      CLAUDE_PROJECT_DIR: repository,
    });

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, 'utf8')).toContain(`CLAUDE_PROJECT_DIR=${repository}`);
  });

  it('falls back to CLAUDE_PROJECT_DIR when the file_path directory is outside any git repo', () => {
    const fallbackRepository = initGitRepository('kiko-dispatch-fallback-nogit-');
    const marker = join(fallbackRepository, 'marker.txt');
    writeStubScript(fallbackRepository, 'fast.sh', marker);
    const outsideDirectory = createTempDirectory('kiko-dispatch-plain-dir-');
    const targetFile = join(outsideDirectory, 'example.ts');

    const result = runDispatch('fast.sh', payloadForFile(targetFile), {
      ...process.env,
      CLAUDE_PROJECT_DIR: fallbackRepository,
    });

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, 'utf8')).toContain(`CLAUDE_PROJECT_DIR=${fallbackRepository}`);
  });

  it('denies (deny JSON, exit 2) for pre-write-guard.sh when the dispatcher itself cannot even buffer stdin', () => {
    const fakeBinDirectory = createTempDirectory('kiko-dispatch-fake-bin-');
    writeFileSync(
      join(fakeBinDirectory, 'mktemp'),
      ['#!/usr/bin/env bash', 'exit 1', ''].join('\n'),
    );
    chmodSync(join(fakeBinDirectory, 'mktemp'), 0o755);

    const result = runDispatch('pre-write-guard.sh', payloadForFile('/tmp/whatever.ts'), {
      ...process.env,
      PATH: `${fakeBinDirectory}:${process.env.PATH}`,
    });

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(result.stderr.trim()).not.toBe('');
  });

  it('follows its kept fail-open semantics (exit 0, no output) for fast.sh on the same dispatcher crash', () => {
    const fakeBinDirectory = createTempDirectory('kiko-dispatch-fake-bin-fast-');
    writeFileSync(
      join(fakeBinDirectory, 'mktemp'),
      ['#!/usr/bin/env bash', 'exit 1', ''].join('\n'),
    );
    chmodSync(join(fakeBinDirectory, 'mktemp'), 0o755);

    const result = runDispatch('fast.sh', payloadForFile('/tmp/whatever.ts'), {
      ...process.env,
      PATH: `${fakeBinDirectory}:${process.env.PATH}`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it("follows kill-guard.sh's own always-allow semantics on the same dispatcher crash", () => {
    const fakeBinDirectory = createTempDirectory('kiko-dispatch-fake-bin-kill-');
    writeFileSync(
      join(fakeBinDirectory, 'mktemp'),
      ['#!/usr/bin/env bash', 'exit 1', ''].join('\n'),
    );
    chmodSync(join(fakeBinDirectory, 'mktemp'), 0o755);

    const result = runDispatch('kill-guard.sh', payloadForCwd('/tmp'), {
      ...process.env,
      PATH: `${fakeBinDirectory}:${process.env.PATH}`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it.each(['../evil.sh', 'a/b.sh', 'no-suffix', '', 'evil..sh', 'has space.sh'])(
    'rejects the invalid script-name argument: %s',
    (scriptName) => {
      const result = runDispatch(scriptName, '{}', { ...process.env });

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).not.toBe('');
    },
  );

  it('accepts a plain, well-formed script-name argument', () => {
    const repository = initGitRepository('kiko-dispatch-validname-');
    const marker = join(repository, 'marker.txt');
    writeStubScript(repository, 'medium.sh', marker);

    const result = runDispatch('medium.sh', payloadForCwd(repository), { ...process.env });

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });
});
