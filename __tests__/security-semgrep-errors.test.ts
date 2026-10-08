import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

// scripts/checks/security.sh must fail closed when Semgrep could not
// evaluate a rule: a rule Timeout (reported at level "warn", exit 0) or any
// "error"-level entry in errors[] silently drops that rule for that file,
// which would otherwise read as a clean scan. A stub `semgrep` placed first
// on PATH stands in for the real binary so the test controls errors[].
const SCRIPT = join(__dirname, '../scripts/checks/security.sh');

const createdPaths: string[] = [];

function createTempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  createdPaths.push(directory);

  return directory;
}

function runWithSemgrepOutput(semgrepOutput: string) {
  const stubDirectory = createTempDirectory('kiko-security-stub-');
  const targetDirectory = createTempDirectory('kiko-security-target-');
  writeFileSync(join(stubDirectory, 'semgrep-output.json'), semgrepOutput);
  const stubPath = join(stubDirectory, 'semgrep');
  writeFileSync(
    stubPath,
    [
      '#!/usr/bin/env bash',
      `cat "${join(stubDirectory, 'semgrep-output.json')}"`,
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(stubPath, 0o755);

  return spawnSync('bash', [SCRIPT, targetDirectory], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubDirectory}:${process.env.PATH}` },
  });
}

function semgrepJson(errors: Record<string, unknown>[]): string {
  return JSON.stringify({ results: [], errors, paths: { scanned: [] } });
}

afterEach(() => {
  while (createdPaths.length > 0) {
    const directory = createdPaths.pop();

    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('scripts/checks/security.sh Semgrep errors[]', () => {
  it('fails when a rule timed out (level "warn", type "Timeout")', () => {
    const result = runWithSemgrepOutput(
      semgrepJson([
        {
          code: 2,
          level: 'warn',
          type: 'Timeout',
          rule_id: 'rules.kiko-worklet-directive-required',
          message: 'Timeout when running rules.kiko-worklet-directive-required on src/slow.tsx',
          path: 'src/slow.tsx',
        },
      ]),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Timeout when running rules.kiko-worklet-directive-required');
  });

  it('fails on an "error"-level entry', () => {
    const result = runWithSemgrepOutput(
      semgrepJson([
        {
          code: 7,
          level: 'error',
          type: 'Rule parse error',
          message: 'Invalid pattern for TypeScript',
        },
      ]),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Invalid pattern for TypeScript');
  });

  it('fails when Semgrep output is not JSON', () => {
    const result = runWithSemgrepOutput('not json');

    expect(result.status).toBe(2);
  });

  it('stays green on a non-Timeout warning', () => {
    const result = runWithSemgrepOutput(
      semgrepJson([
        {
          code: 3,
          level: 'warn',
          type: 'Syntax error',
          message: 'Syntax error at line unsupported.foo:1',
          path: 'unsupported.foo',
        },
      ]),
    );

    expect(result.status).toBe(0);
  });
});
