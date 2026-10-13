import {
  mkdirSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import {
  writeFile,
  runWithStub,
  mutatedFiles,
  twelveLines,
  mutateEntries,
  writeExecutable,
  writeStrykerStub,
  mutationStateFile,
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

const stateFile = (temporaryDirectory: string, kind: 'history' | 'files'): string =>
  mutationStateFile(projectRoot(temporaryDirectory), temporaryDirectory, kind);

// Lines that parse as no record at all, in either TSV: wrong field counts, text and negative
// numbers, a number too big for a double, and a blank row.
const HOSTILE_ROWS = [
  'garbage',
  'a\tb',
  '\t\t\t\t\t',
  '2026-09-10T10:00:00Z\tsrc/changed.ts\t-5\tnan',
  '2026-09-10T10:00:00Z\t300\t1e999\t70\t99999999999999999999999\tmany',
  '2026-09-10T10:00:00Z\tsrc/changed.ts\t1e999\t9999999999999999999999',
].join('\n');

const seedHostileRows = (temporaryDirectory: string): void => {
  for (const kind of ['history', 'files'] as const) {
    writeFileSync(stateFile(temporaryDirectory, kind), `${HOSTILE_ROWS}\n`);
  }
};

// A stub that sleeps (so the run has a strictly-positive duration the history records), prints
// the given Stryker lines, writes a passing report, and exits 0.
const stubPrinting = (lines: string[]): string =>
  [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$$" >> "$KIKO_STUB_CALLS"',
    'sleep 1',
    ...lines.map((line) => `echo "${line}"`),
    PASSING_REPORT_FOR_CHANGED_FILE,
    'exit 0',
  ].join('\n');

const runPrinting = (temporaryDirectory: string, lines: string[]) =>
  runWithStub(
    writeStrykerStub(temporaryDirectory, stubPrinting(lines)),
    temporaryDirectory,
    join(temporaryDirectory, 'calls'),
  );

const lastRecord = (temporaryDirectory: string): string[] =>
  readFileSync(stateFile(temporaryDirectory, 'history'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-1)[0]
    .split('\t');

const DRY_RUN_LINE =
  'Initial test run succeeded. Ran 9294 tests in 2 minutes 18 seconds (net 101106 ms, overhead 37176 ms).';

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
    // The core regression: a passing run must reach stdout live, not capture
    // the output into a variable and print nothing.
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
    const historyFile = stateFile(temporaryDirectory, 'history');
    expect(existsSync(historyFile)).toBe(true);
    // Record shape: iso<TAB>duration<TAB>count<TAB>score<TAB>tested<TAB>timedOut — a
    // strictly-positive duration.
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

// ---------------------------------------------------------------------------
// Changed lines: the gate hands Stryker `path:start-end` entries for the lines
// the branch added (git diff -U0), never the whole file.
// ---------------------------------------------------------------------------

// `prepare` runs after the repository is committed and before the wrapper starts, so it can set
// the user-level git state (config, attributes) the wrapper's own git calls must not trust.
const runOnChangedLines = (
  featureFiles: Record<string, string | null>,
  baseFiles: Record<string, string>,
  prepare: (root: string) => void = () => undefined,
  environment: Record<string, string> = {},
) => {
  const { root, script } = buildMutationRepository(
    mkdtempSync(join(tmpdir(), 'kiko-mutrepo-')),
    featureFiles,
    baseFiles,
  );

  prepare(root);

  return runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main', ...environment });
};

const gitConfig =
  (...configArguments: string[]) =>
  (root: string): void => {
    spawnSync('git', ['config', ...configArguments], { cwd: root });
  };

const writeAttributes =
  (body: string) =>
  (root: string): void => {
    appendFileSync(join(root, '.git/info/attributes'), body);
  };

describe('scripts/checks/mutation.sh changed lines', () => {
  it('hands Stryker one range per hunk of a modified file, never the plain path', () => {
    const result = runOnChangedLines(
      {
        'src/x.ts': twelveLines({
          3: 'export const changed3 = 0;',
          4: 'export const changed4 = 0;',
          10: 'export const changed10 = 0;',
        }),
      },
      { 'src/x.ts': twelveLines() },
    );

    expect(result.code).toBe(0);
    expect(mutateEntries(result.stubArguments)).toEqual(['src/x.ts:3-4', 'src/x.ts:10-10']);
  });

  it('hands Stryker the whole of a new file as one range', () => {
    const result = runOnChangedLines({ 'src/new.ts': twelveLines() }, {});

    expect(mutateEntries(result.stubArguments)).toEqual(['src/new.ts:1-12']);
  });

  it('skips a file that only lost lines, and passes without Stryker when it is the only one', () => {
    const lines = twelveLines().split('\n');
    lines.splice(4, 1);

    const result = runOnChangedLines(
      { 'src/x.ts': lines.join('\n') },
      { 'src/x.ts': twelveLines() },
    );

    expect(result.code).toBe(0);
    expect(result.stubArguments).toBeNull();
    expect(result.stdout).toContain('skipped (no added lines): src/x.ts');
    expect(result.stdout).toContain('nothing to mutate: no changed source file has added lines.');
  });

  it('leaves a file that only lost lines out of the entries of the other changed files', () => {
    const lines = twelveLines().split('\n');
    lines.splice(4, 1);

    const result = runOnChangedLines(
      { 'src/x.ts': lines.join('\n'), 'src/y.ts': twelveLines({ 2: 'export const edited = 0;' }) },
      { 'src/x.ts': twelveLines(), 'src/y.ts': twelveLines() },
    );

    expect(result.code).toBe(0);
    expect(mutateEntries(result.stubArguments)).toEqual(['src/y.ts:2-2']);
    expect(result.stdout).toContain('skipped (no added lines): src/x.ts');
  });

  it('skips a file that was only moved, because a pure rename adds no line', () => {
    const result = runOnChangedLines(
      { 'src/old.ts': null, 'src/moved.ts': twelveLines() },
      { 'src/old.ts': twelveLines() },
    );

    expect(result.code).toBe(0);
    expect(result.stubArguments).toBeNull();
    expect(result.stdout).toContain('skipped (no added lines): src/moved.ts');
  });

  it('hands Stryker only the edited line of a moved file', () => {
    const result = runOnChangedLines(
      { 'src/old.ts': null, 'src/moved.ts': twelveLines({ 6: 'export const edited = 0;' }) },
      { 'src/old.ts': twelveLines() },
    );

    expect(mutateEntries(result.stubArguments)).toEqual(['src/moved.ts:6-6']);
  });

  it('still reads a moved file as a rename when the user config turns rename detection off', () => {
    const result = runOnChangedLines(
      { 'src/old.ts': null, 'src/moved.ts': twelveLines({ 6: 'export const edited = 0;' }) },
      { 'src/old.ts': twelveLines() },
      gitConfig('diff.renames', 'false'),
    );

    expect(mutateEntries(result.stubArguments)).toEqual(['src/moved.ts:6-6']);
  });

  it('keeps two hunks separate when the user config sets diff.interHunkContext', () => {
    const result = runOnChangedLines(
      {
        'src/x.ts': twelveLines({
          3: 'export const changed3 = 0;',
          6: 'export const changed6 = 0;',
        }),
      },
      { 'src/x.ts': twelveLines() },
      gitConfig('diff.interHunkContext', '3'),
    );

    expect(mutateEntries(result.stubArguments)).toEqual(['src/x.ts:3-3', 'src/x.ts:6-6']);
  });

  it('still reads the edited lines of a file the user attributes mark as binary', () => {
    const result = runOnChangedLines(
      { 'src/x.ts': twelveLines({ 6: 'export const edited = 0;' }) },
      { 'src/x.ts': twelveLines() },
      writeAttributes('*.ts -diff\n'),
    );

    expect(result.code).toBe(0);
    expect(mutateEntries(result.stubArguments)).toEqual(['src/x.ts:6-6']);
  });

  it('still reads the real edited lines when a diff driver converts the text', () => {
    // The driver drops the first two lines, so a converted diff would number line 6 as line 4.
    const result = runOnChangedLines(
      { 'src/x.ts': twelveLines({ 6: 'export const edited = 0;' }) },
      { 'src/x.ts': twelveLines() },
      (root) => {
        writeAttributes('*.ts diff=dropper\n')(root);
        gitConfig('diff.dropper.textconv', 'sed 1,2d')(root);
      },
    );

    expect(mutateEntries(result.stubArguments)).toEqual(['src/x.ts:6-6']);
  });

  it('builds the entries when mutation-ranges.js prints a warning to stderr and exits 0', () => {
    const preload = join(mkdtempSync(join(tmpdir(), 'kiko-preload-')), 'warn.js');
    writeFileSync(preload, "process.stderr.write('(node) a warning on stderr\\n');\n");

    const result = runOnChangedLines(
      { 'src/x.ts': twelveLines({ 6: 'export const edited = 0;' }) },
      { 'src/x.ts': twelveLines() },
      undefined,
      { NODE_OPTIONS: `--require=${preload}` },
    );

    expect(result.code).toBe(0);
    expect(mutateEntries(result.stubArguments)).toEqual(['src/x.ts:6-6']);
  });

  it('refuses with a block and never starts Stryker when the changed-line diff fails', () => {
    // A git wrapper that fails only for the -U0 diff, so the file-name lists before it succeed.
    const shimDirectory = mkdtempSync(join(tmpdir(), 'kiko-git-shim-'));
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    writeExecutable(
      join(shimDirectory, 'git'),
      `#!/bin/sh\ncase "$*" in *-U0*) exit 1 ;; esac\nexec "${realGit}" "$@"\n`,
    );

    const result = runOnChangedLines(
      { 'src/x.ts': twelveLines({ 6: 'export const edited = 0;' }) },
      { 'src/x.ts': twelveLines() },
      undefined,
      { PATH: `${shimDirectory}:${process.env.PATH}` },
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Could not read the changed lines');
    expect(result.stubArguments).toBeNull();
  });

  it('refuses with a block when it cannot create the temporary file for the reader', () => {
    const { script } = buildMutationRepository(
      mkdtempSync(join(tmpdir(), 'kiko-mutrepo-')),
      { 'src/x.ts': twelveLines({ 6: 'export const edited = 0;' }) },
      { 'src/x.ts': twelveLines() },
    );

    const result = runWithArgumentStub(
      script,
      { KIKO_MUTATION_BASE: 'main', TMPDIR: join(tmpdir(), 'kiko-missing-directory') },
      ['--list'],
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Could not create a temporary file');
  });

  it('refuses with a block, showing its stderr, when mutation-ranges.js fails', () => {
    const result = runOnChangedLines(
      { 'src/x.ts': twelveLines({ 6: 'export const edited = 0;' }) },
      { 'src/x.ts': twelveLines() },
      (root) => {
        writeFile(
          root,
          'scripts/checks/mutation-ranges.js',
          "process.stderr.write('RANGES-SCRIPT-BROKE\\n');\nprocess.exit(3);\n",
        );
      },
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('mutation-ranges.js could not read the changed lines');
    expect(result.stderr).toContain('RANGES-SCRIPT-BROKE');
    expect(result.stubArguments).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Timeout-aware ETA: the counts a run records, and the estimates they feed.
// ---------------------------------------------------------------------------

const EARLY_PROGRESS =
  'Mutation testing 10% (elapsed: ~1m, remaining: ~9m) 11/110 tested (1 survived, 4 timed out)';
const LATE_PROGRESS =
  'Mutation testing 50% (elapsed: ~5m, remaining: ~5m) 55/110 tested (5 survived, 20 timed out)';

describe('scripts/checks/mutation.sh timeout counts in the history', () => {
  it('records the counts of the last progress line, not of a test title after it', () => {
    const temporaryDirectory = freshTemporaryDirectory();

    const result = runPrinting(temporaryDirectory, [
      EARLY_PROGRESS,
      LATE_PROGRESS,
      '  ✓ tallies the rules 1/2/3 case',
    ]);

    expect(result.code).toBe(0);
    // iso, duration, mutants, score, tested, timed out.
    expect(lastRecord(temporaryDirectory).slice(2)).toEqual(['110', '', '55', '20']);
  });

  it('leaves the timed-out field empty for a counter without a timeout clause', () => {
    const temporaryDirectory = freshTemporaryDirectory();

    runPrinting(temporaryDirectory, ['10/500 tested']);

    expect(lastRecord(temporaryDirectory).slice(2)).toEqual(['500', '', '10', '']);
  });

  it.each([
    ['passes', stubBody(0), 0],
    ['fails', stubBody(1), 2],
  ])(
    'keeps the exit code of a run that %s when both TSV files hold only hostile rows',
    (_title, body, exitCode) => {
      const temporaryDirectory = freshTemporaryDirectory();
      seedHostileRows(temporaryDirectory);

      const result = runWithStub(
        writeStrykerStub(temporaryDirectory, body),
        temporaryDirectory,
        join(temporaryDirectory, 'calls'),
      );

      expect(result.code).toBe(exitCode);
      expect(result.stdout).toContain('No mutation history yet');
    },
  );

  it.each(['history', 'files'] as const)(
    'keeps the exit code when %s.tsv cannot be written',
    (kind) => {
      const temporaryDirectory = freshTemporaryDirectory();
      mkdirSync(stateFile(temporaryDirectory, kind));

      const result = runPrinting(temporaryDirectory, [LATE_PROGRESS]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('CHANGE SET TOTAL: 100.00');
    },
  );
});

describe('scripts/checks/mutation.sh timeout-aware estimate', () => {
  const writeConcurrency = (temporaryDirectory: string): void => {
    writeFile(projectRoot(temporaryDirectory), 'stryker.conf.json', '{ "concurrency": 2 }\n');
  };

  it('splits the estimate by the fitted costs and the share of the changed file', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    // 2 s per normal mutant, 40 s per timed-out one (the fit), rate = median(2, 21) = 11.5.
    seedHistory(temporaryDirectory, [
      '2026-09-10T10:00:00Z 200 100 70 100 0',
      '2026-09-10T11:00:00Z 2100 100 70 100 50',
    ]);
    appendFileSync(
      stateFile(temporaryDirectory, 'files'),
      '2026-09-10T10:00:00Z\tsrc/changed.ts\t200\t50\n',
    );
    writeConcurrency(temporaryDirectory);

    const result = runPrinting(temporaryDirectory, [
      'Mutation testing 2% (elapsed: ~10s, remaining: ~9m) 10/500 tested (0 survived, 0 timed out)',
    ]);

    // 500 * (0.75 * 2 + 0.25 * 40) = 5750 s.
    expect(result.stdout).toContain(
      'Estimated ~95m 50s for 500 mutants (~2s/mutant, 25% timeouts at ~40s each, from history)',
    );
  });

  it('updates the estimate from this run share with the configured floor when no fit exists', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    seedHistory(temporaryDirectory, ['2026-09-10T10:00:00Z 600 300 70']);
    writeConcurrency(temporaryDirectory);

    const result = runPrinting(temporaryDirectory, [
      DRY_RUN_LINE,
      'Mutation testing 10% (elapsed: ~1m, remaining: ~9m) 100/1000 tested (9 survived, 40 timed out)',
    ]);

    expect(result.stdout).toContain(
      'Estimated ~33m 20s for 1000 mutants (~2s/mutant from history)',
    );
    // floor = 2 + (5000 + 37176) / 1000 / 2 = 23.088; 900 * (0.6 * 2 + 0.4 * 23.088) = 9391.68 s.
    expect(result.stdout).toContain('Estimate at 10%: ~156m 32s remaining (40% timeouts so far)');
  });

  it('keeps the estimate lines out of the progress log', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    seedHistory(temporaryDirectory, ['2026-09-10T10:00:00Z 600 300 70']);

    const result = runPrinting(temporaryDirectory, [LATE_PROGRESS]);
    const logPath = /tail -f (\S+)/.exec(result.stdout)?.[1] ?? '';

    expect(result.stdout).toContain('Estimated ~');
    expect(readFileSync(logPath, 'utf8')).not.toContain('Estimate');
  });
});

describe('scripts/checks/mutation.sh --list timeout share', () => {
  const listWith = (fileRows: string[]) => {
    const { root, script } = buildMutationRepository(
      mkdtempSync(join(tmpdir(), 'kiko-mutrepo-')),
      {
        'src/alpha.ts': twelveLines({
          3: 'export const edited3 = 0;',
          4: 'export const edited4 = 0;',
        }),
        'src/beta.ts': twelveLines({ 6: 'export const edited6 = 0;' }),
      },
      { 'src/alpha.ts': twelveLines(), 'src/beta.ts': twelveLines() },
    );
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiko-mutation-state-'));

    if (fileRows.length > 0) {
      appendFileSync(
        mutationStateFile(root, temporaryDirectory, 'files'),
        `${fileRows.join('\n')}\n`,
      );
    }

    return runWithArgumentStub(script, { KIKO_MUTATION_BASE: 'main', TMPDIR: temporaryDirectory }, [
      '--list',
    ]);
  };

  it('prints the line-weighted share of the changed files after the count', () => {
    // alpha 10% over 2 lines, beta 40% over 1 line: (2 * 10 + 1 * 40) / 3 = 20.
    const result = listWith([
      '2026-09-10T10:00:00Z\tsrc/alpha.ts\t100\t10',
      '2026-09-10T10:00:00Z\tsrc/beta.ts\t100\t40',
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'changed lines: 3\nmutable files: 2 (cap 30)\ntimeout share (history): 20.0% (2 of 2 files)\n',
    );
  });

  it('prints none when no history exists', () => {
    const result = listWith([]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('mutable files: 2 (cap 30)\ntimeout share (history): none\n');
  });
});
