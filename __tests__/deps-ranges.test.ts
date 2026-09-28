import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// scripts/checks/deps-ranges.js mechanizes the pin-exact-dependency-versions
// rule: no range spec (^, ~, *, x, >, <, ||, or a space-separated range) in
// package.json's dependencies, devDependencies, or overrides blocks. Spawns
// the real script against a fixture package.json on disk (the
// __tests__/import-order.test.ts pattern), rather than importing the
// script's internals directly.
const SCRIPT = join(__dirname, '../scripts/checks/deps-ranges.js');

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'deps-ranges-test-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const runCheck = (packageJson: object): SpawnSyncReturns<string> => {
  const file = join(directory, 'package.json');

  writeFileSync(file, JSON.stringify(packageJson));

  return spawnSync('node', [SCRIPT, file], { encoding: 'utf8' });
};

describe('scripts/checks/deps-ranges.js', () => {
  it('passes a package.json whose every dependency, devDependency, and override is an exact pin', () => {
    const result = runCheck({
      dependencies: { react: '19.2.3' },
      devDependencies: { typescript: '6.0.3' },
      overrides: {
        ajv: '8.18.0',
        '@esbuild-kit/core-utils': { esbuild: '0.25.12' },
      },
    });

    expect(result.status).toBe(0);
  });

  it('fails a caret range in dependencies', () => {
    const result = runCheck({ dependencies: { react: '^19.2.3' } });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('dependencies.react: ^19.2.3');
  });

  it('fails a tilde range in devDependencies', () => {
    const result = runCheck({ devDependencies: { typescript: '~6.0.3' } });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('devDependencies.typescript: ~6.0.3');
  });

  it('fails a wildcard range', () => {
    const result = runCheck({ dependencies: { react: '19.2.*' } });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('dependencies.react: 19.2.*');
  });

  it('fails a comparator range', () => {
    const result = runCheck({ dependencies: { react: '>=19.2.3' } });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('dependencies.react: >=19.2.3');
  });

  it('fails an alternation of ranges', () => {
    const result = runCheck({ dependencies: { react: '19.2.3 || 19.2.4' } });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('dependencies.react: 19.2.3 || 19.2.4');
  });

  it('fails a space-separated comparator range', () => {
    const result = runCheck({ dependencies: { react: '1.0.0 - 2.0.0' } });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('dependencies.react: 1.0.0 - 2.0.0');
  });

  it('fails a range spec nested inside a scoped override', () => {
    const result = runCheck({
      overrides: { '@esbuild-kit/core-utils': { esbuild: '^0.25.12' } },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('overrides.@esbuild-kit/core-utils.esbuild: ^0.25.12');
  });

  it('fails a range spec on a plain (non-nested) override', () => {
    const result = runCheck({ overrides: { esbuild: '^0.25.12' } });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('overrides.esbuild: ^0.25.12');
  });
});
