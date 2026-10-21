import { join } from 'node:path';
import { symlinkSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { copyKillGuard } from './test-support/copy-kill-guard';

// kill-guard.sh runs kill-guard.js, and a failure while node LOADS the guard (a sibling module
// that is missing, a syntax error) happens outside the guard's own try/catch. The hook must
// deny then, as it does for an error thrown while judging a command, because a guard that
// cannot load cannot clear anything. The two documented allows stay: node missing, and a payload
// that is malformed (the malformed row also lives in kill-guard.test.ts).
const payloadFor = (command: string): string => JSON.stringify({ tool_input: { command } });

const runHook = (
  hook: string,
  payload: string,
  environment: NodeJS.ProcessEnv = process.env,
): SpawnSyncReturns<string> =>
  spawnSync('/bin/bash', [hook], { input: payload, encoding: 'utf8', env: environment });

const copiedHook = (omit: readonly string[] = []): string => {
  const repository = createTemporaryDirectory('kiko-kill-guard-load-');

  return join(copyKillGuard(repository, omit), 'kill-guard.sh');
};

const permissionReason = (result: SpawnSyncReturns<string>): string => {
  const { hookSpecificOutput } = JSON.parse(result.stdout);
  expect(hookSpecificOutput.hookEventName).toBe('PreToolUse');
  expect(hookSpecificOutput.permissionDecision).toBe('deny');

  return hookSpecificOutput.permissionDecisionReason;
};

afterEach(() => {
  removeTemporaryDirectories();
});

describe('scripts/checks/kill-guard.sh when kill-guard.js cannot load', () => {
  it('judges a command normally from an intact copy', () => {
    const hook = copiedHook();

    const denied = runHook(hook, payloadFor('git stash'));
    const allowed = runHook(hook, payloadFor('ls'));

    expect(denied.status).toBe(0);
    expect(permissionReason(denied)).not.toContain('could not load');
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toBe('');
  });

  it('denies a command when a module kill-guard.js requires is missing', () => {
    const result = runHook(copiedHook(['kill-guard-main-moves.js']), payloadFor('git stash'));

    expect(result.status).toBe(0);
    const reason = permissionReason(result);
    expect(reason).toContain('kill-guard could not load');
    expect(reason).toContain('DETAILS:');
    expect(reason).toContain('Cannot find module');
    expect(reason).toContain('WHY IT MATTERS:');
    expect(reason).toContain('HOW TO FIX:');
    expect(reason).toContain('DO NOT:');
  });

  it('denies a harmless command too, because nothing could be judged', () => {
    const result = runHook(copiedHook(['kill-guard-main-moves.js']), payloadFor('ls'));

    expect(result.status).toBe(0);
    expect(permissionReason(result)).toContain('kill-guard could not load');
  });

  it('denies a command when kill-guard.js has a syntax error', () => {
    const hook = copiedHook();
    writeFileSync(join(hook, '..', 'kill-guard.js'), 'const = ;\n');

    const result = runHook(hook, payloadFor('git stash'));

    expect(result.status).toBe(0);
    const reason = permissionReason(result);
    expect(reason).toContain('kill-guard could not load');
    expect(reason).toContain('SyntaxError');
  });

  it('still allows a malformed payload when the guard loads', () => {
    const result = runHook(copiedHook(), '{not json');

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('still allows when node is not installed', () => {
    const hook = copiedHook();
    const binaries = createTemporaryDirectory('kiko-kill-guard-no-node-');
    const dirname = spawnSync('which', ['dirname'], { encoding: 'utf8' }).stdout.trim();
    symlinkSync(dirname, join(binaries, 'dirname'));

    const result = runHook(hook, payloadFor('git stash'), { PATH: binaries });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});
