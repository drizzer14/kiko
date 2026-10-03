import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';

import {
  runWithStub,
  mutatedFiles,
  writeStrykerStub,
  runWithArgumentStub,
  buildMutationRepository,
  PASSING_REPORT_FOR_CHANGED_FILE,
} from './test-support/mutation-repository';

// scripts/checks/mutation.sh (the check:deep mutation step) must STREAM Stryker's
// output to stdout live while preserving the exit code AND the structured failure
// block. It is manual and NOT hook-wired, so the "silent on success" hook
// contract does not apply — a passing run's output is meant to reach stdout.
//
// The real Stryker run takes minutes, so these drive the wrapper against a fast
// STUB binary via the KIKO_MUTATION_BIN seam, and point TMPDIR at a fresh dir so
// the content-dedup skip and the single-flight lock start clean.
const LIB = join(__dirname, '../scripts/checks/_lib.sh');

// The wrapper computes ROOT as scripts/checks/../.. — this project — and keys
// its history file under TMPDIR by a hash of that ROOT, so pre-seeded history
// must use the same root.
const projectRoot = (temporaryDirectory: string): string => join(temporaryDirectory, 'project');

// Append history records for the project root under the given isolated TMPDIR by
// sourcing _lib.sh, so a subsequent wrapper run in that TMPDIR reads them. Each
// record is "<iso> <dur> <count> <score>". This does NOT rely on a prior wrapper
// run (content-dedup would skip an identical second run).
const seedHistory = (temporaryDirectory: string, records: string[]): void => {
  const root = projectRoot(temporaryDirectory);
  const script = [
    `source "${LIB}"`,
    ...records.map((r) => `harness_mutation_history_append "${root}" ${r}`),
  ].join('\n');
  spawnSync('bash', ['-c', script], {
    env: { ...process.env, TMPDIR: temporaryDirectory },
    encoding: 'utf8',
  });
};

// Overwrite the history file for the project root under the given TMPDIR with
// corrupt content (no numeric fields), so harness_mutation_rate yields nothing
// and the wrapper must still gate correctly.
const seedCorruptHistory = (temporaryDirectory: string): void => {
  const script = [
    `source "${LIB}"`,
    `f="$(harness_mutation_history_file "${projectRoot(temporaryDirectory)}")"`,
    'printf "garbage\\nno numeric fields here\\n" > "$f"',
  ].join('\n');
  spawnSync('bash', ['-c', script], {
    env: { ...process.env, TMPDIR: temporaryDirectory },
    encoding: 'utf8',
  });
};

// A stub that records each invocation (so a dedup test can count calls), prints
// two distinctive lines, then exits with the given code.
const stubBody = (exitCode: number): string =>
  [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$$" >> "$KIKO_STUB_CALLS"',
    'echo "STRYKER-STREAM-LINE-1"',
    'echo "STRYKER-STREAM-LINE-2"',
    // Written whether this stub passes or fails: the change-set gate is only
    // reached on an exit-0 Stryker, so it is harmless, unread noise on exit 1.
    PASSING_REPORT_FOR_CHANGED_FILE,
    `exit ${exitCode}`,
  ].join('\n');

// The project changes one source file against `main`, so the streaming tests
// run the wrapper's default diff scope over that one file.
const freshTemporaryDirectory = (): string => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiko-mut-'));
  buildMutationRepository(projectRoot(temporaryDirectory), {
    'src/changed.ts': 'export const changed = 1;\n',
  });

  return temporaryDirectory;
};

const callCount = (callLog: string): number =>
  readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length;

describe('scripts/checks/mutation.sh streaming', () => {
  it('streams the Stryker output to stdout on a PASSING run (not swallowed)', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const callLog = join(temporaryDirectory, 'calls');
    const bin = writeStrykerStub(temporaryDirectory, stubBody(0));

    const result = runWithStub(bin, temporaryDirectory, callLog);

    expect(result.code).toBe(0);
    // The core regression: a passing run used to capture the output into a
    // variable and print nothing. It must now reach stdout live.
    expect(result.stdout).toContain('STRYKER-STREAM-LINE-1');
    expect(result.stdout).toContain('STRYKER-STREAM-LINE-2');
  });

  it('prints the tail -f watch command and writes the streamed output to that progress log', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const callLog = join(temporaryDirectory, 'calls');
    const bin = writeStrykerStub(temporaryDirectory, stubBody(0));

    const result = runWithStub(bin, temporaryDirectory, callLog);

    expect(result.code).toBe(0);
    // The wrapper prints the exact command a human runs to watch the run live.
    expect(result.stdout).toContain('Watch live progress:  tail -f ');
    const match = result.stdout.match(/Watch live progress: {2}tail -f (\S+)/);
    expect(match).not.toBeNull();
    const logPath = (match as RegExpMatchArray)[1];
    // It is a stable, tailable file (under the mutation state dir), and the
    // streamed Stryker output was tee'd into it — so `tail -f` shows the run.
    expect(logPath).toContain('/mutation/progress.log');
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, 'utf8')).toContain('STRYKER-STREAM-LINE-1');
  });

  it('prints the no-history estimate on the first run and records that completed run', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const callLog = join(temporaryDirectory, 'calls');
    // Sleep ~1s so the run has a strictly-positive duration: the wrapper's
    // clock-skew guard refuses to record a 0s run, so an instant stub would
    // (correctly) leave no history. This exercises the record-on-completion path.
    const bin = writeStrykerStub(
      temporaryDirectory,
      [
        '#!/usr/bin/env bash',
        'printf "%s\\n" "$$" >> "$KIKO_STUB_CALLS"',
        'sleep 1',
        'echo "STRYKER-STREAM-LINE-1"',
        PASSING_REPORT_FOR_CHANGED_FILE,
        'exit 0',
      ].join('\n'),
    );

    const result = runWithStub(bin, temporaryDirectory, callLog);

    expect(result.code).toBe(0);
    // With no prior runs the wrapper says so plainly rather than inventing an ETA.
    expect(result.stdout).toContain('No mutation history yet');
    // A completed positive-duration run is appended to the history TSV so the
    // NEXT run can estimate.
    const match = result.stdout.match(/Watch live progress: {2}tail -f (\S+)/);
    expect(match).not.toBeNull();
    const historyFile = (match as RegExpMatchArray)[1].replace('progress.log', 'history.tsv');
    expect(existsSync(historyFile)).toBe(true);
    // Record shape: iso<TAB>duration<TAB>count<TAB>score — a strictly-positive duration.
    const duration = Number(readFileSync(historyFile, 'utf8').split('\t')[1]);
    expect(duration).toBeGreaterThan(0);
  });

  it('prints the LIVE per-mutant ETA once Stryker reports the mutant count (not in the log)', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const callLog = join(temporaryDirectory, 'calls');
    // Seed two valid history records: rates 600/300=2 and 900/300=3 -> the
    // wrapper's per-mutant rate is their median (avg of two = 2.5 s/mutant).
    seedHistory(temporaryDirectory, [
      '2026-09-10T10:00:00Z 600 300 70',
      '2026-09-10T11:00:00Z 900 300 72',
    ]);
    // The stub reports an "N/M tested" counter (500 mutants) and sleeps ~1s so
    // the run has a positive duration. The filter must print the ETA line the
    // moment that counter appears.
    const bin = writeStrykerStub(
      temporaryDirectory,
      [
        '#!/usr/bin/env bash',
        'printf "%s\\n" "$$" >> "$KIKO_STUB_CALLS"',
        'echo "10/500 tested"',
        'sleep 1',
        PASSING_REPORT_FOR_CHANGED_FILE,
        'exit 0',
      ].join('\n'),
    );

    const result = runWithStub(bin, temporaryDirectory, callLog);

    expect(result.code).toBe(0);
    // The full ETA prints live, scaled by the run's ACTUAL mutant count (500).
    expect(result.stdout).toContain('Estimated ~');
    expect(result.stdout).toContain('for 500 mutants');
    // The ETA line is a stdout-only downstream stage — it must NOT pollute the
    // progress log, which stays pure Stryker output (tee'd before the filter).
    const match = result.stdout.match(/Watch live progress: {2}tail -f (\S+)/);
    expect(match).not.toBeNull();
    const logPath = (match as RegExpMatchArray)[1];
    expect(readFileSync(logPath, 'utf8')).not.toContain('Estimated ~');
    expect(readFileSync(logPath, 'utf8')).toContain('10/500 tested');
  });

  it('gates correctly on a CORRUPT history: no crash, no estimate, exit code unchanged (pass)', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const callLog = join(temporaryDirectory, 'calls');
    seedCorruptHistory(temporaryDirectory);
    const bin = writeStrykerStub(temporaryDirectory, stubBody(0));

    const result = runWithStub(bin, temporaryDirectory, callLog);

    // A malformed history never crashes the gate: a passing run still exits 0...
    expect(result.code).toBe(0);
    // ...and, with no usable rate, the wrapper says so plainly.
    expect(result.stdout).toContain('No mutation history yet');
  });

  it('gates correctly on a CORRUPT history: exit code unchanged (fail -> 2)', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const callLog = join(temporaryDirectory, 'calls');
    seedCorruptHistory(temporaryDirectory);
    const bin = writeStrykerStub(temporaryDirectory, stubBody(1));

    const result = runWithStub(bin, temporaryDirectory, callLog);

    // A malformed history never masks a real failure: a failing run still exits 2.
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('No mutation history yet');
  });

  it('streams the output, prints the failure block, and exits 2 on a FAILING run', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const callLog = join(temporaryDirectory, 'calls');
    const bin = writeStrykerStub(temporaryDirectory, stubBody(1));

    const result = runWithStub(bin, temporaryDirectory, callLog);

    expect(result.code).toBe(2);
    // Output is streamed to stdout (not only echoed inside the block)...
    expect(result.stdout).toContain('STRYKER-STREAM-LINE-1');
    // ...and the structured failure block still prints to stderr.
    expect(result.stderr).toContain('CHECK FAILED: Stryker');
    expect(result.stderr).toContain('STRYKER-STREAM-LINE-1');
  });

  it('records a pass so an identical second run is content-deduped (Stryker not re-run)', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const callLog = join(temporaryDirectory, 'calls');
    const bin = writeStrykerStub(temporaryDirectory, stubBody(0));

    const first = runWithStub(bin, temporaryDirectory, callLog);
    const second = runWithStub(bin, temporaryDirectory, callLog);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    // The single-flight + content-dedup machinery is preserved: the second,
    // identical run skips without invoking Stryker again.
    expect(callCount(callLog)).toBe(1);
  });

  it('does NOT record a skip on a FAILING run, so it re-runs next time', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const callLog = join(temporaryDirectory, 'calls');
    const bin = writeStrykerStub(temporaryDirectory, stubBody(1));

    runWithStub(bin, temporaryDirectory, callLog);
    runWithStub(bin, temporaryDirectory, callLog);

    // A skip is only recorded on a PASS, so a failing check always re-runs.
    expect(callCount(callLog)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Diff scoping: check:deep mutates only the source files THIS branch changed
// vs the merge-base with $KIKO_MUTATION_BASE, not the whole project. The
// wrapper runs against an argument-capturing stub, so the merge-base/diff/
// exclude/--mutate logic is exercised for real, deterministically.
// ---------------------------------------------------------------------------

const runOnFeature = (featureFiles: Record<string, string>) => {
  const { script } = buildMutationRepository(
    mkdtempSync(join(tmpdir(), 'kiko-mutrepo-')),
    featureFiles,
  );

  return runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main' });
};

describe('scripts/checks/mutation.sh diff scoping', () => {
  it('mutates only the source files changed vs the base, excluding tests, fixtures, locales, and .d.ts', () => {
    const result = runOnFeature({
      'src/changed.ts': 'export const b = 2;\n',
      'src/changed.test.ts': 'test("x", () => {});\n',
      'rules/fixtures/bad.ts': 'export const c = 3;\n',
      // Non-logic categories excluded from the mutate-set: i18n locale catalogs
      // (pure string-data) and type-only declarations (erased at compile).
      'src/i18n/locales/en.ts': 'export const en = { a: "A" };\n',
      'src/foo.d.ts': 'export type Foo = number;\n',
    });

    expect(result.code).toBe(0);
    expect(mutatedFiles(result.stubArguments)).toEqual(['src/changed.ts']);
  });

  it('passes cleanly without Stryker when the only changed mutable files are locales/.d.ts', () => {
    // ONLY excluded categories change — the filter empties the set, so the
    // "nothing to mutate, pass" early exit must still fire (stub never runs).
    const result = runOnFeature({
      'src/i18n/locales/en.ts': 'export const en = { a: "A" };\n',
      'src/foo.d.ts': 'export type Foo = number;\n',
    });

    expect(result.code).toBe(0);
    expect(result.stubArguments).toBeNull();
  });

  it('passes cleanly (exit 0) without invoking Stryker when nothing changed vs the base', () => {
    const result = runOnFeature({});

    expect(result.code).toBe(0);
    expect(result.stubArguments).toBeNull();
  });

  it('passes cleanly without Stryker when only test/fixture files changed', () => {
    const result = runOnFeature({ 'src/keep.test.ts': 'test("x", () => {});\n' });

    expect(result.code).toBe(0);
    expect(result.stubArguments).toBeNull();
  });

  // Barrels (**/index.ts) and pure-static *.styles.ts are dropped from the
  // diff-scoped mutate set, EXCEPT the logic-bearing re-includes
  // (bottom-sheet.styles.ts, entity-icon-tile.styles.ts). These must be
  // filtered out in mutation.sh's own grep because `--mutate` REPLACES the
  // config mutate[] (deepMerge replaces arrays), so the config negations do NOT
  // apply on the diff-scoped run.
  it('drops barrels and pure-static styles but keeps the logic-bearing re-includes', () => {
    const result = runOnFeature({
      // A logic-bearing source file so the changed set is never empty.
      'src/changed.ts': 'export const b = 2;\n',
      // Barrels (DROPPED, the i18n one too) and the i18n init module (KEPT).
      'src/foo/index.ts': "export * from './foo';\n",
      'src/i18n/index.ts': "export * from './init';\n",
      'src/i18n/init/init.ts': 'export const init = () => 1;\n',
      // Styles: a pure-static one (DROPPED) and the 2 logic re-includes (KEPT).
      'src/foo/foo.styles.ts': 'export const s = {};\n',
      'src/design-system/components/bottom-sheet/bottom-sheet.styles.ts': 'export const s = {};\n',
      'src/design-system/components/entity-icon-tile/entity-icon-tile.styles.ts':
        'export const s = {};\n',
    });

    expect(result.code).toBe(0);
    expect(new Set(mutatedFiles(result.stubArguments))).toEqual(
      new Set([
        'src/changed.ts',
        'src/i18n/init/init.ts',
        'src/design-system/components/bottom-sheet/bottom-sheet.styles.ts',
        'src/design-system/components/entity-icon-tile/entity-icon-tile.styles.ts',
      ]),
    );
  });

  it('passes cleanly without Stryker when the only changed mutable files are barrels/styles', () => {
    // ONLY a plain barrel and a pure-static style change — the filter empties the
    // set, so the "nothing to mutate, pass" early exit must still fire.
    const result = runOnFeature({
      'src/foo/index.ts': "export * from './foo';\n",
      'src/foo/foo.styles.ts': 'export const s = {};\n',
    });

    expect(result.code).toBe(0);
    expect(result.stubArguments).toBeNull();
  });
});
