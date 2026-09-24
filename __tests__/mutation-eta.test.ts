import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// scripts/checks/mutation.sh prints a human ETA for a run that is about to start,
// derived from the history of COMPLETED runs, and writes a user-watchable progress
// log. The ETA is based on a PER-MUTANT RATE (seconds per mutant) from history,
// because a flat average of whole-run DURATIONS is meaningless: diff-scoped runs
// vary from a few dozen mutants to thousands. The rate logic lives as a PURE bash
// helper (harness_mutation_rate) in scripts/checks/_lib.sh so it can be unit tested
// here without ever invoking Stryker: these source _lib.sh in a bash subprocess
// with an isolated TMPDIR (the same out-of-repo state dir the real wrapper uses is
// keyed under TMPDIR), append/read history records, and assert the exact output.
const LIB = join(__dirname, '../scripts/checks/_lib.sh');

const freshTemporaryDirectory = (): string => mkdtempSync(join(tmpdir(), 'kiko-eta-'));

// Run a snippet with _lib.sh sourced. TMPDIR is isolated per call so the
// per-worktree state dir (and thus the history file) starts clean.
const sh = (script: string, temporaryDirectory: string): string => {
  const result = spawnSync('bash', ['-c', `source "${LIB}"\n${script}`], {
    env: { ...process.env, TMPDIR: temporaryDirectory },
    encoding: 'utf8',
  });
  return result.stdout.trim();
};

describe('_lib.sh harness_fmt_duration (pure)', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(sh('harness_fmt_duration 45', freshTemporaryDirectory())).toBe('45s');
  });

  it('formats a whole-minute duration as minutes only', () => {
    expect(sh('harness_fmt_duration 60', freshTemporaryDirectory())).toBe('1m');
    expect(sh('harness_fmt_duration 420', freshTemporaryDirectory())).toBe('7m');
  });

  it('formats a minute-and-seconds duration as "Nm Ss"', () => {
    expect(sh('harness_fmt_duration 90', freshTemporaryDirectory())).toBe('1m 30s');
  });

  it('treats a missing or non-numeric argument as zero, never crashing', () => {
    expect(sh('harness_fmt_duration', freshTemporaryDirectory())).toBe('0s');
    expect(sh('harness_fmt_duration abc', freshTemporaryDirectory())).toBe('0s');
  });
});

describe('_lib.sh harness_mutation_rate (pure)', () => {
  it('prints nothing when there is no history file yet', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    expect(
      sh('harness_mutation_rate "$(harness_mutation_history_file /some/root)"', temporaryDirectory),
    ).toBe('');
  });

  it('prints nothing (never crashes) when the history file is corrupt', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const out = sh(
      [
        'root=/x/corrupt',
        'f="$(harness_mutation_history_file "$root")"',
        'printf "garbage with no numeric fields\\nalso junk\\n" > "$f"',
        'harness_mutation_rate "$f"',
      ].join('\n'),
      temporaryDirectory,
    );
    expect(out).toBe('');
  });

  it('prints nothing for old-format records that have a duration but no count', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    // An old 2-field-ish record: duration present, count field empty. No rate is
    // computable from it (it would divide by an empty/zero count), so it is skipped.
    const out = sh(
      [
        'root=/x/nocount',
        'harness_mutation_history_append "$root" 2026-09-11T00:00:00Z 360 "" ""',
        'harness_mutation_rate "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      temporaryDirectory,
    );
    expect(out).toBe('');
  });

  it('excludes 0-duration (clock skew) and 0-count records; a lone valid record still yields its rate', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const out = sh(
      [
        'root=/x/lone',
        // 0-duration (clock skew) and 0-count records are both invalid.
        'harness_mutation_history_append "$root" 2026-09-10T09:00:00Z 0 90 68',
        'harness_mutation_history_append "$root" 2026-09-10T09:30:00Z 420 0 68',
        // A single valid record: rate = 300 / 150 = 2 seconds/mutant.
        'harness_mutation_history_append "$root" 2026-09-10T10:00:00Z 300 150 68',
        'harness_mutation_rate "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      temporaryDirectory,
    );
    expect(out).toBe('2');
  });

  it('prints the MEDIAN seconds-per-mutant over the valid records', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const out = sh(
      [
        'root=/x/median',
        // rates: 600/300=2, 120/100=1.2, 900/300=3 -> sorted 1.2,2,3 -> median 2.
        'harness_mutation_history_append "$root" 2026-09-10T10:00:00Z 600 300 70',
        'harness_mutation_history_append "$root" 2026-09-10T11:00:00Z 120 100 71',
        'harness_mutation_history_append "$root" 2026-09-10T12:00:00Z 900 300 72',
        'harness_mutation_rate "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      temporaryDirectory,
    );
    expect(out).toBe('2');
  });

  it('averages the two middle rates for an even count of valid records', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    const out = sh(
      [
        'root=/x/even',
        // rates: 600/300=2, 120/100=1.2 -> even count -> (1.2+2)/2 = 1.6.
        'harness_mutation_history_append "$root" 2026-09-10T10:00:00Z 600 300 70',
        'harness_mutation_history_append "$root" 2026-09-10T11:00:00Z 120 100 71',
        'harness_mutation_rate "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      temporaryDirectory,
    );
    expect(out).toBe('1.6');
  });

  it('normalizes a very large run by its mutant count (this round: ~5574 mutants)', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    // A single record using this round's REAL data point: ~5574 mutants at a
    // 72.58% mutation score. Its rate is duration / mutantCount, so a huge run
    // contributes a comparable per-mutant rate, not a huge whole-run duration.
    // 2787 / 5574 = 0.5 seconds/mutant.
    const out = sh(
      [
        'root=/x/big',
        'harness_mutation_history_append "$root" 2026-09-11T00:00:00Z 2787 5574 72.58',
        'harness_mutation_rate "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      temporaryDirectory,
    );
    expect(out).toBe('0.5');
  });

  it('uses only the last up-to-5 valid records', () => {
    const temporaryDirectory = freshTemporaryDirectory();
    // Six valid records; the FIRST (rate 100) must fall outside the 5-record
    // window. The last five have rates 1,2,3,4,5 -> median 3.
    const out = sh(
      [
        'root=/x/window',
        'harness_mutation_history_append "$root" 2026-09-10T01:00:00Z 1000 10 70',
        'harness_mutation_history_append "$root" 2026-09-10T02:00:00Z 100 100 70',
        'harness_mutation_history_append "$root" 2026-09-10T03:00:00Z 200 100 70',
        'harness_mutation_history_append "$root" 2026-09-10T04:00:00Z 300 100 70',
        'harness_mutation_history_append "$root" 2026-09-10T05:00:00Z 400 100 70',
        'harness_mutation_history_append "$root" 2026-09-10T06:00:00Z 500 100 70',
        'harness_mutation_rate "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      temporaryDirectory,
    );
    expect(out).toBe('3');
  });
});
