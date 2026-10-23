import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './test-support/temporary-directory';

// scripts/checks/security.sh re-scans, once and single-threaded, only the (file, rule) pairs
// Semgrep reported as a Timeout, so a one-off stall under load does not block a merge, while a
// pair that stalls again, any other error, or a broad stall (more than 10 pairs) still fails.
// A fake `semgrep` on PATH answers each call from a prepared JSON and records the call, so the
// test sees which arguments and which rule definitions every call used.
const SCRIPT = join(__dirname, '../scripts/checks/security.sh');
const US = '\u001f';
const MAXIMUM_RESCANNED_PAIRS = 10;
const TIMED_OUT_RULE = 'kiko-worklet-directive-required';
const OTHER_RULE = 'kiko-no-keychain-secret-into-usestate';
const CONFIG_COUNT_OF_FIRST_SCAN = 5;

afterEach(() => {
  removeTemporaryDirectories();
});

const timeoutEntry = (file: string, rule = TIMED_OUT_RULE) => ({
  code: 3,
  level: 'warn',
  type: 'Timeout',
  rule_id: `rules.${rule}`,
  message: `Timeout when running rules.${rule} on ${file}`,
  path: file,
});

const reportOf = (errors: Record<string, unknown>[]): string =>
  JSON.stringify({ results: [], errors, paths: { scanned: [] } });

type Call = { args: string[] };

const configArguments = (call?: Call): string[] =>
  (call?.args ?? []).filter((_argument, index) => call?.args[index - 1] === '--config');

// `answers[n]` is the JSON the fake prints on call n+1 (the last answer repeats).
const runWithFakeSemgrep = (
  makeAnswers: (files: string[]) => string[],
  fileCount: number,
): { status: number | null; stderr: string; calls: Call[]; files: string[] } => {
  const stubs = createTemporaryDirectory('kiko-rescan-stub-');
  const target = createTemporaryDirectory('kiko-rescan-target-');
  const files = Array.from({ length: fileCount }, (_unused, index) => join(target, `f${index}.ts`));

  for (const file of files) writeFileSync(file, 'export const x = 1;\n');

  const answers = makeAnswers(files);
  const calls = join(stubs, 'calls');

  mkdirSync(calls);
  answers.forEach((answer, index) => {
    writeFileSync(join(stubs, `answer-${index}.json`), answer);
  });

  const fake = [
    '#!/usr/bin/env bash',
    `dir="${stubs}"`,
    'n=$(ls "$dir/calls" | grep -c "^args-")',
    `printf '%s${US}' "$@" > "$dir/calls/args-$n"`,
    `last=${answers.length - 1}`,
    'index=$n; [ "$index" -gt "$last" ] && index=$last',
    'cat "$dir/answer-$index.json"',
    'exit 0',
    '',
  ].join('\n');

  writeFileSync(join(stubs, 'semgrep'), fake);
  chmodSync(join(stubs, 'semgrep'), 0o755);

  const result = spawnSync('bash', [SCRIPT, target], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs}:${process.env.PATH}` },
  });
  const recorded: Call[] = [];

  for (let index = 0; existsSync(join(calls, `args-${index}`)); index += 1) {
    recorded.push({
      args: readFileSync(join(calls, `args-${index}`), 'utf8')
        .split(US)
        .filter((argument) => argument !== ''),
    });
  }

  return { status: result.status, stderr: result.stderr, calls: recorded, files };
};

const CLEAN = reportOf([]);

describe('scripts/checks/security.sh re-scan of timed-out pairs', () => {
  it('re-scans the timed-out file once with --jobs 1, the same timer and the same --config arguments', () => {
    const { status, stderr, calls, files } = runWithFakeSemgrep(
      (paths) => [reportOf([timeoutEntry(paths[0] ?? '')]), CLEAN],
      1,
    );
    const [first, rescan] = calls;
    const file = files[0] ?? '';
    const jobsIndex = rescan?.args.indexOf('--jobs') ?? -1;
    const timerFlags = (call?: Call) => call?.args.filter((argument) => /timeout/.test(argument));

    expect({
      status,
      callCount: calls.length,
      warning:
        stderr.includes('WARNING') && stderr.includes(file) && stderr.includes(TIMED_OUT_RULE),
      jobs: rescan?.args[jobsIndex + 1],
      sameTimer: timerFlags(rescan)?.join(' ') === timerFlags(first)?.join(' '),
      json: rescan?.args.includes('--json'),
      targets: rescan?.args.filter(
        (argument, index) => argument.startsWith('/') && rescan.args[index - 1] !== '--config',
      ),
      configs: configArguments(rescan),
    }).toEqual({
      status: 0,
      callCount: 2,
      warning: true,
      jobs: '1',
      sameTimer: true,
      json: true,
      targets: [file],
      configs: configArguments(first),
    });
    expect(configArguments(first)).toHaveLength(CONFIG_COUNT_OF_FIRST_SCAN);
  });

  it('fails when the re-scan of the file reports a Timeout on a different rule', () => {
    const { status, calls } = runWithFakeSemgrep(
      (paths) => [
        reportOf([timeoutEntry(paths[0] ?? '')]),
        reportOf([timeoutEntry(paths[0] ?? '', OTHER_RULE)]),
      ],
      1,
    );

    expect({ status, callCount: calls.length }).toEqual({ status: 2, callCount: 2 });
  });

  it('re-scans a file once when two of its rules timed out', () => {
    const { status, calls } = runWithFakeSemgrep(
      (paths) => [
        reportOf([timeoutEntry(paths[0] ?? ''), timeoutEntry(paths[0] ?? '', OTHER_RULE)]),
        CLEAN,
      ],
      1,
    );

    expect({ status, callCount: calls.length }).toEqual({ status: 0, callCount: 2 });
  });

  it('fails with the current block when the pair times out again', () => {
    const { status, stderr, calls, files } = runWithFakeSemgrep(
      (paths) => [reportOf([timeoutEntry(paths[0] ?? '')])],
      1,
    );

    expect({ status, callCount: calls.length, blocked: stderr.includes('CHECK FAILED') }).toEqual({
      status: 2,
      callCount: 2,
      blocked: true,
    });
    expect(stderr).toContain(`Timeout when running rules.${TIMED_OUT_RULE} on ${files[0]}`);
  });

  it('fails on a non-Timeout error and makes no second call (green at once: today too)', () => {
    const { status, calls } = runWithFakeSemgrep(
      () => [
        reportOf([
          { code: 7, level: 'error', type: 'Rule parse error', message: 'Invalid pattern' },
        ]),
      ],
      1,
    );

    expect({ status, callCount: calls.length }).toEqual({ status: 2, callCount: 1 });
  });

  it('fails with no re-scan when 11 pairs timed out (green at once: today too)', () => {
    const { status, calls } = runWithFakeSemgrep(
      (paths) => [reportOf(paths.map((file) => timeoutEntry(file)))],
      MAXIMUM_RESCANNED_PAIRS + 1,
    );

    expect({ status, callCount: calls.length }).toEqual({ status: 2, callCount: 1 });
  });

  it('re-scans 10 pairs in 10 distinct files, one call per file, and warns for each when all pass', () => {
    const { status, stderr, calls, files } = runWithFakeSemgrep(
      (paths) => [reportOf(paths.map((file) => timeoutEntry(file))), CLEAN],
      MAXIMUM_RESCANNED_PAIRS,
    );
    const warnedFiles = files.filter((file) =>
      stderr.split('\n').some((line) => line.includes('WARNING') && line.includes(file)),
    );

    expect({ status, callCount: calls.length, warnedFiles }).toEqual({
      status: 0,
      callCount: MAXIMUM_RESCANNED_PAIRS + 1,
      warnedFiles: files,
    });
  });
});
