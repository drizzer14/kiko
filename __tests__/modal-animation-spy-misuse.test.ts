import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';

// Jest records a hook defined inside a test as an error on that test instead of throwing, so the
// misuse of src/test-support/modal-animation-spy.ts can only be seen as a failing test. Running a
// probe suite in a child Jest is the one way to assert that failure from a passing test.
const ROOT = join(__dirname, '..');
const JEST = join(ROOT, 'node_modules/jest/bin/jest.js');
const HELPER = join(ROOT, 'src/test-support/modal-animation-spy');

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'modal-spy-misuse-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const runProbe = (body: string): SpawnSyncReturns<string> => {
  writeFileSync(
    join(directory, 'probe.test.tsx'),
    `import { spyOnModalAnimationPerTest } from '${HELPER}';\n\n${body}\n`,
  );

  return spawnSync(
    process.execPath,
    [JEST, '--roots', directory, '--testPathPattern', 'probe.test.tsx'],
    { encoding: 'utf8', cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0' } },
  );
};

describe('spyOnModalAnimationPerTest misuse', () => {
  it('passes when it is called at describe level', () => {
    const result = runProbe(
      `describe('probe', () => {
        spyOnModalAnimationPerTest('probe-modal');

        it('runs', () => {});
      });`,
    );

    expect(result.stderr).toContain('1 passed');
    expect(result.status).toBe(0);
  });

  it('fails the test that calls it inside a test, naming the hook Jest rejected', () => {
    const result = runProbe(
      `describe('probe', () => {
        it('registers late', () => {
          spyOnModalAnimationPerTest('probe-modal');
        });
      });`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Hooks cannot be defined inside tests. Hook of type "beforeEach" is nested within "registers late".',
    );
    expect(result.stderr).toContain(
      'Hooks cannot be defined inside tests. Hook of type "afterEach" is nested within "registers late".',
    );
  });

  it('fails the test that calls it inside a hook', () => {
    const result = runProbe(
      `describe('probe', () => {
        beforeEach(() => {
          spyOnModalAnimationPerTest('probe-modal');
        });

        it('runs', () => {});
      });`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Hooks cannot be defined inside tests.');
    expect(result.stderr).toContain('is nested within "runs".');
  });
});
