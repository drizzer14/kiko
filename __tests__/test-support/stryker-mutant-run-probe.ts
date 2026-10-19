import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { installedRunnerDirectory } from './stryker-jest-runner';

export type ProbeCall = {
  // Everything the fake Jest adapter saw while the run was in flight.
  testNamePattern: string | undefined;
  selectedDuringRun: string[] | string;
  rejected: boolean;
  selectedAfterRun: string;
};

export type ProbeScenario = {
  method: 'mutantRun' | 'dryRun';
  testFilter?: string[];
  hitLimit?: number;
  failing?: boolean;
  // A Set left on the global by an earlier, crashed call.
  leftover?: string[];
};

// The runner is an ES module, which Jest's CommonJS pipeline cannot import, so each scenario runs
// in a plain Node process against a fake Jest adapter: no Jest, no Stryker, milliseconds per run.
const CHILD_SOURCE = `
import { pathToFileURL } from 'node:url';

const GLOBAL_NAME = '__kikoStrykerSelectedTestIds__';
const [runnerFile, scenarioJson] = process.argv.slice(1);
const scenario = JSON.parse(scenarioJson);
const { JestTestRunner } = await import(pathToFileURL(runnerFile).href);

const describeGlobal = (value) =>
  value instanceof Set ? [...value] : typeof value;

let seen;
const adapter = {
  run: async (settings) => {
    seen = {
      testNamePattern: settings.testNamePattern,
      selectedDuringRun: describeGlobal(globalThis[GLOBAL_NAME]),
    };
    if (scenario.failing) throw new Error('jest exploded');
    return { results: { numRuntimeErrorTestSuites: 0, testResults: [] } };
  },
};
const log = { debug() {}, trace() {}, isTraceEnabled: () => false };
const runner = new JestTestRunner(
  log,
  { jest: { enableFindRelatedTests: false } },
  adapter,
  { loadConfig: async () => ({ testEnvironment: 'node' }) },
  { getVersion: () => '29.7.0' },
  '__stryker__',
);
await runner.init();

if (scenario.leftover) globalThis[GLOBAL_NAME] = new Set(scenario.leftover);

let rejected = false;
try {
  if (scenario.method === 'dryRun') {
    await runner.dryRun({ coverageAnalysis: 'off', files: [] });
  } else {
    await runner.mutantRun({
      activeMutant: { id: '1' },
      sandboxFileName: 'x.ts',
      testFilter: scenario.testFilter,
      hitLimit: scenario.hitLimit,
      disableBail: false,
    });
  }
} catch {
  rejected = true;
}

process.stdout.write(
  JSON.stringify({ ...seen, rejected, selectedAfterRun: describeGlobal(globalThis[GLOBAL_NAME]) }),
);
`;

export const probeRunner = (scenario: ProbeScenario): ProbeCall => {
  const runnerFile = join(installedRunnerDirectory(), 'dist/src/jest-test-runner.js');
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', CHILD_SOURCE, runnerFile, JSON.stringify(scenario)],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(`probe failed (${result.status}): ${result.stderr}`);
  }

  return JSON.parse(result.stdout) as ProbeCall;
};
