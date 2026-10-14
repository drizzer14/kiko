import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type SpawnSyncReturns, spawn, spawnSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';

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

function initGitRepository(prefix: string): string {
  const directory = createTemporaryDirectory(prefix);
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

function payloadForBashCommand(cwd: string, command: string): string {
  return JSON.stringify({ cwd, tool_input: { command } });
}

// A fake `git` (prepended onto PATH) that fails EVERY `rev-parse
// --show-toplevel` call with a genuine, OTHER git error (deliberately
// avoiding the literal substring "not a git repository" in its own message,
// since the dispatcher's own check is a plain substring match) so the
// dispatcher's fallback-to-CLAUDE_PROJECT_DIR path can be proven to trigger
// ONLY on the "not a git repository" case, never on a real git failure
// (which the guard must instead treat as a dispatcher crash). Any other
// git subcommand (git init in the test setup, or a real `git` call the
// dispatcher itself never issues on this path) passes through to the real
// binary so the rest of each test's setup keeps working.
function writeFakeGitOtherFailure(directory: string, realGitPath: string): string {
  const fakeGitPath = join(directory, 'git');
  writeFileSync(
    fakeGitPath,
    [
      '#!/usr/bin/env bash',
      'sawRevParse=0',
      'sawShowToplevel=0',
      'for argument in "$@"; do',
      '  if [ "$argument" = "rev-parse" ]; then sawRevParse=1; fi',
      '  if [ "$argument" = "--show-toplevel" ]; then sawShowToplevel=1; fi',
      'done',
      'if [ "$sawRevParse" = "1" ] && [ "$sawShowToplevel" = "1" ]; then',
      "  printf 'fatal: a bespoke test git failure (permission denied)\\n' >&2",
      '  exit 129',
      'fi',
      `exec "${realGitPath}" "$@"`,
      '',
    ].join('\n'),
  );
  chmodSync(fakeGitPath, 0o755);

  return fakeGitPath;
}

// Proves the subdirectory-cwd case end to end, not just a stub — copies
// the REAL kill-guard.sh/kill-guard.js pair (kill-guard.sh only ever
// `require`s its own sibling kill-guard.js, so the pair is self-contained)
// into a disposable repo, so the dispatcher's cwd resolution is exercised
// against the exact script the hook wires today.
function copyRealKillGuardScript(repositoryRoot: string): void {
  const checksDirectory = join(repositoryRoot, 'scripts', 'checks');
  mkdirSync(checksDirectory, { recursive: true });
  const realChecksDirectory = join(__dirname, '../scripts/checks');
  copyFileSync(join(realChecksDirectory, 'kill-guard.sh'), join(checksDirectory, 'kill-guard.sh'));
  copyFileSync(join(realChecksDirectory, 'kill-guard.js'), join(checksDirectory, 'kill-guard.js'));
  chmodSync(join(checksDirectory, 'kill-guard.sh'), 0o755);
}

function runDispatch(
  scriptName: string,
  input: string,
  env: NodeJS.ProcessEnv,
): SpawnSyncReturns<string> {
  return spawnSync('bash', [DISPATCH, scriptName], { input, encoding: 'utf8', env });
}

afterEach(() => {
  removeTemporaryDirectories();
});

describe('harness/kiko/hooks/dispatch.sh', () => {
  // A resolved root is only trusted when it shares CLAUDE_PROJECT_DIR's
  // OWN git-common-dir (i.e. the same repository, or a linked worktree of
  // it) — an UNRELATED repository (a different .git entirely, as these two
  // disposable repos are) must fall back to CLAUDE_PROJECT_DIR instead,
  // so a Write into a repo that merely happens to sit on disk near the
  // session's own project cannot run THAT repo's scripts/checks/* against
  // CLAUDE_PROJECT_DIR's rules — the exact case this bound closes.
  it("falls back to CLAUDE_PROJECT_DIR's own script for a file in an UNRELATED repository", () => {
    const unrelatedRepository = initGitRepository('kiko-dispatch-unrelated-');
    const projectRepository = initGitRepository('kiko-dispatch-project-');
    const unrelatedMarker = join(unrelatedRepository, 'marker.txt');
    const projectMarker = join(projectRepository, 'marker.txt');
    writeStubScript(unrelatedRepository, 'fast.sh', unrelatedMarker);
    writeStubScript(projectRepository, 'fast.sh', projectMarker);
    const targetFile = join(unrelatedRepository, 'src', 'example.ts');
    mkdirSync(join(unrelatedRepository, 'src'), { recursive: true });

    const result = runDispatch('fast.sh', payloadForFile(targetFile), {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectRepository,
    });

    expect(result.status).toBe(0);
    expect(existsSync(unrelatedMarker)).toBe(false);
    expect(existsSync(projectMarker)).toBe(true);
    const marker = readFileSync(projectMarker, 'utf8');
    // The unrelated-repository fallback assigns CLAUDE_PROJECT_DIR verbatim (no git rev-parse
    // involved, unlike a resolved root), matching the existing "falls back
    // to CLAUDE_PROJECT_DIR when the file_path directory is outside any
    // git repo" test's own raw-path comparison below.
    expect(marker).toContain(`CLAUDE_PROJECT_DIR=${projectRepository}`);
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
    // cwd resolves through `git rev-parse --show-toplevel`, which
    // realpath-resolves a macOS /tmp -> /private/tmp symlink, so compare
    // against the realpath the same way the file_path-based tests do.
    expect(readFileSync(marker, 'utf8')).toContain(
      `CLAUDE_PROJECT_DIR=${realpathSync(repository)}`,
    );
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
    const outsideDirectory = createTemporaryDirectory('kiko-dispatch-plain-dir-');
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
    const fakeBinDirectory = createTemporaryDirectory('kiko-dispatch-fake-bin-');
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
    const fakeBinDirectory = createTemporaryDirectory('kiko-dispatch-fake-bin-fast-');
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
    const fakeBinDirectory = createTemporaryDirectory('kiko-dispatch-fake-bin-kill-');
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

  // A Bash/Stop payload's `cwd` used AS-IS, with no git-root resolution,
  // would make a subdirectory cwd (e.g. `<root>/ios`) look for
  // `<root>/ios/scripts/checks/kill-guard.sh`, which never exists, so the
  // dispatcher would silently no-op (exit 0, empty stdout) instead of
  // finding the REAL script one level up at the repo root — the kill-guard
  // would fail OPEN on exactly the payload shape kill-guard.test.ts's own
  // BLOCKED_COMMANDS prove it must deny. This copies the real kill-guard.sh/
  // kill-guard.js pair so the behavior is proven end to end, not just
  // against a stub.
  it('resolves a subdirectory cwd up to its own git root, so a banned command still denies', () => {
    const repository = initGitRepository('kiko-dispatch-cwd-subdir-');
    copyRealKillGuardScript(repository);
    const subdirectory = join(repository, 'ios');
    mkdirSync(subdirectory, { recursive: true });

    const result = runDispatch(
      'kill-guard.sh',
      payloadForBashCommand(subdirectory, 'pkill -f "cat"'),
      { ...process.env },
    );

    expect(result.status).toBe(0);
    const stdout = result.stdout.trim();
    expect(stdout).not.toBe('');
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('falls back to CLAUDE_PROJECT_DIR when cwd is outside any git repository', () => {
    const fallbackRepository = initGitRepository('kiko-dispatch-cwd-nogit-fallback-');
    const marker = join(fallbackRepository, 'marker.txt');
    writeStubScript(fallbackRepository, 'kill-guard.sh', marker);
    const outsideDirectory = createTemporaryDirectory('kiko-dispatch-cwd-plain-dir-');

    const result = runDispatch('kill-guard.sh', payloadForCwd(outsideDirectory), {
      ...process.env,
      CLAUDE_PROJECT_DIR: fallbackRepository,
    });

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, 'utf8')).toContain(`CLAUDE_PROJECT_DIR=${fallbackRepository}`);
  });

  // A git failure that is NOT "not a git repository" (the git binary
  // itself misbehaving, a corrupt .git, a permission error) must not fall
  // back to CLAUDE_PROJECT_DIR the same as a genuine non-repo directory —
  // for a main-rooted session that would silently ALLOW a write the guard
  // should deny. Only "not a git repository" may fall back; any
  // OTHER git failure must deny for pre-write-guard.sh and keep each other
  // hook's own kept semantics.
  describe('a git failure OTHER than "not a git repository"', () => {
    const realGitPath = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();

    it('denies (deny JSON, exit 2) for pre-write-guard.sh', () => {
      const fakeBinDirectory = createTemporaryDirectory('kiko-dispatch-fake-git-deny-');
      writeFakeGitOtherFailure(fakeBinDirectory, realGitPath);

      const result = runDispatch('pre-write-guard.sh', payloadForFile('/tmp/whatever-i2.ts'), {
        ...process.env,
        PATH: `${fakeBinDirectory}:${process.env.PATH}`,
      });

      expect(result.status).toBe(2);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
      expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(result.stderr.trim()).not.toBe('');
    });

    it('follows its kept fail-open semantics (exit 0, no output) for fast.sh', () => {
      const fakeBinDirectory = createTemporaryDirectory('kiko-dispatch-fake-git-fast-');
      writeFakeGitOtherFailure(fakeBinDirectory, realGitPath);

      const result = runDispatch('fast.sh', payloadForFile('/tmp/whatever-i2.ts'), {
        ...process.env,
        PATH: `${fakeBinDirectory}:${process.env.PATH}`,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });

    it("follows kill-guard.sh's own always-allow semantics for a cwd-based payload", () => {
      const fakeBinDirectory = createTemporaryDirectory('kiko-dispatch-fake-git-kill-');
      writeFakeGitOtherFailure(fakeBinDirectory, realGitPath);
      const cwdDirectory = createTemporaryDirectory('kiko-dispatch-fake-git-kill-cwd-');

      const result = runDispatch('kill-guard.sh', payloadForCwd(cwdDirectory), {
        ...process.env,
        PATH: `${fakeBinDirectory}:${process.env.PATH}`,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    });
  });

  // A hook timeout kills only the dispatcher's own PID — running the
  // target script as a CHILD process (`bash "$targetScript" < "$stdinFile"`)
  // would orphan a still-running script (a real risk for medium.sh, which holds
  // medium.lock for a long time) instead of taking it down with it. Once
  // dispatch.sh execs the target, the target INHERITS the dispatcher's own
  // PID (there is no separate child process at all), which this proves by
  // comparing the PID node's own `spawn` observed for the dispatcher
  // against the PID the target script recorded for itself via `$$`.
  it("execs the target script (same PID as the dispatcher itself), so a kill can't orphan it", async () => {
    const repository = initGitRepository('kiko-dispatch-exec-pid-');
    const marker = join(repository, 'marker.txt');
    const checksDirectory = join(repository, 'scripts', 'checks');
    mkdirSync(checksDirectory, { recursive: true });
    const scriptPath = join(checksDirectory, 'fast.sh');
    writeFileSync(
      scriptPath,
      [
        '#!/usr/bin/env bash',
        'cat > /dev/null',
        `printf '%s' "$$" > "${marker}"`,
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(scriptPath, 0o755);
    const targetFile = join(repository, 'src', 'example.ts');
    mkdirSync(join(repository, 'src'), { recursive: true });

    const child = spawn('bash', [DISPATCH, 'fast.sh'], { env: { ...process.env } });
    child.stdin?.write(payloadForFile(targetFile));
    child.stdin?.end();
    const exitCode: number | null = await new Promise((resolve) => {
      child.on('exit', (code) => resolve(code));
    });

    expect(exitCode).toBe(0);
    const recordedPid = readFileSync(marker, 'utf8').trim();
    expect(recordedPid).toBe(String(child.pid));
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

  // The script-name validation is one validity check with one shared
  // error message, so every rejection reason reads identically regardless
  // of WHICH shape of argument tripped it.
  it('rejects every invalid script-name shape with the SAME error message wording', () => {
    const slashResult = runDispatch('../evil.sh', '{}', { ...process.env });
    const suffixResult = runDispatch('no-suffix', '{}', { ...process.env });

    // Both messages share the identical wording MINUS the offending
    // argument itself (which necessarily differs) — proving one shared
    // message template, not one bespoke message per rejection reason.
    const messageTemplate = (stderr: string, scriptName: string): string =>
      stderr.trim().replace(scriptName, '<script-name>');
    expect(messageTemplate(slashResult.stderr, '../evil.sh')).toBe(
      messageTemplate(suffixResult.stderr, 'no-suffix'),
    );
  });

  it('accepts a plain, well-formed script-name argument', () => {
    const repository = initGitRepository('kiko-dispatch-validname-');
    const marker = join(repository, 'marker.txt');
    writeStubScript(repository, 'medium.sh', marker);

    const result = runDispatch('medium.sh', payloadForCwd(repository), { ...process.env });

    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });
});
