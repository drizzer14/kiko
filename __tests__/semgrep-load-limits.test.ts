import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';
import { readTextFile } from './test-support/read-text-file';

// Semgrep rule Timeouts under load blocked merges: the real-semgrep jest suites ran beside the rest
// of the suite on every core, and security.sh let Semgrep spawn its default thread count. The scan
// caps its jobs, and `make verify` runs the real-semgrep suites alone, in band, from one list.
const ROOT = join(__dirname, '..');
const SECURITY_SCRIPT = 'scripts/checks/security.sh';
const VERIFY_SCRIPT = join(ROOT, 'scripts/checks/verify.sh');
const SUITE_LIST = 'scripts/checks/semgrep-jest-suites.txt';
const THIS_SUITE = 'semgrep-load-limits.test.ts';
const JEST_BINARY = join(ROOT, 'node_modules/.bin/jest');
const ARGUMENT_SEPARATOR = '\u001f';

// A suite starts the real binary when it spawns `semgrep` itself, asks `which semgrep` before
// running a wrapper that does, or titles its describe block "(real semgrep)". Indirect rule: a
// suite that names a script reaching semgrep (pre-write-guard, fast.sh, security.sh,
// semgrep-rules.sh, guard-replay.sh) AND says in its own comments it runs "a real Semgrep" or
// "with the real Semgrep" (its other rows stub the binary). Every nested __tests__ folder is read.
const REAL_SEMGREP_MARKERS = [
  /spawnSync\(\s*'semgrep'/,
  /'which',\s*\['semgrep'\]/,
  /describe\([^)]*\(real semgrep\)/,
];
const SEMGREP_WRAPPER = /pre-write-guard|fast\.sh|security\.sh|semgrep-rules\.sh|guard-replay\.sh/;
const REAL_RUN_STATEMENT = /\b(?:with the|a) real Semgrep\b/i;

afterEach(() => {
  removeTemporaryDirectories();
});

const listedSuites = (): string[] =>
  existsSync(join(ROOT, SUITE_LIST))
    ? readTextFile(join(ROOT, SUITE_LIST))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
    : [];

const runsRealSemgrep = (text: string): boolean =>
  REAL_SEMGREP_MARKERS.some((marker) => marker.test(text)) ||
  (SEMGREP_WRAPPER.test(text) && REAL_RUN_STATEMENT.test(text));

const realSemgrepSuites = (): string[] =>
  readdirSync(join(ROOT, '__tests__'), { recursive: true })
    .map(String)
    .filter((name) => /\.test\.tsx?$/.test(name) && name !== THIS_SUITE)
    .filter((name) => runsRealSemgrep(readTextFile(join(ROOT, '__tests__', name))))
    .map((name) => `__tests__/${name}`)
    .sort();

const jestListing = (jestArguments: string[]): string[] => {
  const result = spawnSync(JEST_BINARY, [...jestArguments, '--listTests'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  return result.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.replace(`${ROOT}/`, ''))
    .sort();
};

// Runs the real verify.sh with `npm` and `npx` stubbed to record each jest call's arguments.
const jestCallsOfVerify = (): string[][] => {
  const stubs = createTemporaryDirectory('kiko-verify-stubs-');
  const log = join(stubs, 'jest-calls.log');
  const record = [
    '#!/usr/bin/env bash',
    'if [ "$1" = jest ]; then',
    `  shift; printf '%s${ARGUMENT_SEPARATOR}' "$@" >> "${log}"; printf '\\n' >> "${log}"`,
    'fi',
    'exit 0',
    '',
  ].join('\n');

  for (const name of ['npm', 'npx']) {
    writeFileSync(join(stubs, name), record);
    chmodSync(join(stubs, name), 0o755);
  }
  writeFileSync(log, '');
  spawnSync('bash', [VERIFY_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs}:${process.env.PATH}` },
  });

  return readTextFile(log)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split(ARGUMENT_SEPARATOR).filter((argument) => argument !== ''));
};

describe('scripts/checks/security.sh Semgrep jobs', () => {
  it('caps Semgrep at 6 jobs through a named constant', () => {
    const text = readTextFile(join(ROOT, SECURITY_SCRIPT));
    const name = /--jobs[ =]"?\$\{?(\w+)\}?"?/.exec(text)?.[1] ?? '';
    const jobs = new RegExp(`^(?:readonly )?${name}=["']?(\\d+)["']?`, 'm').exec(text)?.[1];

    expect({ isNamed: name !== '', jobs }).toEqual({ isNamed: true, jobs: '6' });
  });
});

describe('the shared real-semgrep jest suite list', () => {
  it('names exactly the suites that start the real semgrep', () => {
    expect(listedSuites()).toEqual(realSemgrepSuites());
  });

  it('lists only paths that exist', () => {
    const listed = listedSuites();

    expect(listed.length).toBeGreaterThan(0);
    expect(listed.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
  });
});

describe('scripts/checks/verify.sh stage 2', () => {
  it('runs jest twice, the second call in band over the listed suites', () => {
    const [first, second, ...rest] = jestCallsOfVerify();

    expect(rest).toEqual([]);
    expect(first).toBeDefined();
    expect(second).toEqual(expect.arrayContaining(['--runInBand', ...listedSuites()]));
  });

  it('covers every suite exactly once: 2a is all but the list, 2b is the list', () => {
    const [first = [], second = []] = jestCallsOfVerify();
    const everySuite = jestListing([]);
    const partA = jestListing(first);
    const partB = second.length === 0 ? [] : jestListing(second);
    const listed = listedSuites().sort();

    expect({ listed: listed.length > 0, secondCall: second.length > 0 }).toEqual({
      listed: true,
      secondCall: true,
    });
    expect({
      partA: partA.filter((suite) => listed.includes(suite)),
      partB,
      union: [...partA, ...partB].sort(),
    }).toEqual({ partA: [], partB: listed, union: everySuite });
  }, 120_000);
});

describe('scripts/checks/verify.sh stage 2a semgrep tripwire', () => {
  const jestPathsOfVerify = (): { paths: string[]; startPath: string } => {
    const stubs = createTemporaryDirectory('kiko-verify-paths-');
    const log = join(stubs, 'jest-paths.log');
    const record = [
      '#!/usr/bin/env bash',
      `if [ "$1" = jest ]; then printf '%s\\n' "$PATH" >> "${log}"; fi`,
      'exit 0',
      '',
    ].join('\n');

    for (const name of ['npm', 'npx']) {
      writeFileSync(join(stubs, name), record);
      chmodSync(join(stubs, name), 0o755);
    }

    writeFileSync(log, '');

    const startPath = `${stubs}:${process.env.PATH}`;

    spawnSync('bash', [VERIFY_SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: startPath },
    });

    return {
      paths: readTextFile(log)
        .split('\n')
        .filter((line) => line !== ''),
      startPath,
    };
  };

  it('puts a semgrep shim first on 2a PATH that names the list and exits 2', () => {
    const [partAPath = ''] = jestPathsOfVerify().paths;
    const shim = join(partAPath.split(':')[0] ?? '', 'semgrep');
    const result = spawnSync(shim, [], { encoding: 'utf8' });

    expect({ status: result.status, output: result.stdout + result.stderr }).toEqual({
      status: 2,
      output: expect.stringContaining(
        `a stage 2a suite ran the real semgrep: add it to ${SUITE_LIST}`,
      ),
    });
  });

  it('leaves the PATH of 2b untouched', () => {
    const { paths, startPath } = jestPathsOfVerify();

    expect(paths[1]).toBe(startPath);
  });
});

describe('scripts/checks/verify.sh with an unusable suite list', () => {
  const verifyWithList = (listText: string | undefined) => {
    const root = createTemporaryDirectory('kiko-verify-list-');
    const checks = join(root, 'scripts/checks');
    const stubs = join(root, 'stubs');

    mkdirSync(checks, { recursive: true });
    mkdirSync(stubs);
    copyFileSync(VERIFY_SCRIPT, join(checks, 'verify.sh'));

    if (listText !== undefined) writeFileSync(join(checks, 'semgrep-jest-suites.txt'), listText);

    for (const name of ['npm', 'npx', 'node']) {
      writeFileSync(join(stubs, name), '#!/bin/sh\nexit 0\n');
      chmodSync(join(stubs, name), 0o755);
    }

    return spawnSync('/bin/bash', [join(checks, 'verify.sh')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${stubs}:${process.env.PATH}` },
    });
  };

  it.each([
    ['empty', ''],
    ['comments only', '# nothing listed\n'],
    ['missing', undefined],
  ])('fails with a failure block and exit 2 when the list is %s', (_name, listText) => {
    const result = verifyWithList(listText);

    expect({ status: result.status, hasBlock: result.stderr.includes('✖') }).toEqual({
      status: 2,
      hasBlock: true,
    });
    expect(result.stderr).not.toContain('unbound variable');
  });
});
