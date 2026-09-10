import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// scripts/checks/mutation.sh prints a Jenkins-style ETA from the history of
// COMPLETED runs and writes a user-watchable progress log. The ETA/history
// logic lives as PURE bash helpers in scripts/checks/_lib.sh so it can be unit
// tested here without ever invoking Stryker: these source _lib.sh in a bash
// subprocess with an isolated TMPDIR (the same out-of-repo state dir the real
// wrapper uses is keyed under TMPDIR), append/read history records, and assert
// the formatter's exact output. No real mutation run is involved.
const LIB = join(__dirname, '../scripts/checks/_lib.sh');

const NO_HISTORY = 'No mutation history yet — no estimate available.';

const freshTmp = (): string => mkdtempSync(join(tmpdir(), 'kiko-eta-'));

// Run a snippet with _lib.sh sourced. TMPDIR is isolated per call so the
// per-worktree state dir (and thus the history file) starts clean.
const sh = (script: string, tmp: string): string => {
  const result = spawnSync('bash', ['-c', `source "${LIB}"\n${script}`], {
    env: { ...process.env, TMPDIR: tmp },
    encoding: 'utf8',
  });
  return result.stdout.trim();
};

describe('_lib.sh harness_fmt_duration (pure)', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(sh('harness_fmt_duration 45', freshTmp())).toBe('45s');
  });

  it('formats a whole-minute duration as minutes only', () => {
    expect(sh('harness_fmt_duration 60', freshTmp())).toBe('1m');
    expect(sh('harness_fmt_duration 420', freshTmp())).toBe('7m');
  });

  it('formats a minute-and-seconds duration as "Nm Ss"', () => {
    expect(sh('harness_fmt_duration 90', freshTmp())).toBe('1m 30s');
  });

  it('treats a missing or non-numeric argument as zero, never crashing', () => {
    expect(sh('harness_fmt_duration', freshTmp())).toBe('0s');
    expect(sh('harness_fmt_duration abc', freshTmp())).toBe('0s');
  });
});

describe('_lib.sh harness_mutation history + estimate (pure)', () => {
  it('reports no estimate when there is no history file yet', () => {
    const tmp = freshTmp();
    expect(
      sh('harness_mutation_estimate_line "$(harness_mutation_history_file /some/root)"', tmp),
    ).toBe(NO_HISTORY);
  });

  it('appends a record and estimates from it (scaled to last run, with count and date)', () => {
    const tmp = freshTmp();
    const out = sh(
      [
        'root=/x/y',
        'harness_mutation_history_append "$root" 2026-09-10T12:00:00Z 420 120 73.4',
        'harness_mutation_estimate_line "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      tmp,
    );
    expect(out).toBe('Estimated ~7m (last run: 7m over 120 mutants on 2026-09-10)');
  });

  it('averages the last few runs for the estimate while showing the most recent in parens', () => {
    const tmp = freshTmp();
    const out = sh(
      [
        'root=/x/avg',
        'harness_mutation_history_append "$root" 2026-09-10T10:00:00Z 120 100 70',
        'harness_mutation_history_append "$root" 2026-09-10T11:00:00Z 240 110 71',
        'harness_mutation_history_append "$root" 2026-09-10T12:00:00Z 360 120 72',
        'harness_mutation_estimate_line "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      tmp,
    );
    // avg(120,240,360) = 240s = ~4m; last run = 360s = 6m over 120 mutants.
    expect(out).toBe('Estimated ~4m (last run: 6m over 120 mutants on 2026-09-10)');
  });

  it('omits the mutant count when it was not parseable for the last run', () => {
    const tmp = freshTmp();
    const out = sh(
      [
        'root=/x/nocount',
        'harness_mutation_history_append "$root" 2026-09-11T00:00:00Z 360 "" ""',
        'harness_mutation_estimate_line "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      tmp,
    );
    expect(out).toBe('Estimated ~6m (last run: 6m on 2026-09-11)');
  });

  it('ignores a 0-duration record (clock skew) so it never drags the average', () => {
    const tmp = freshTmp();
    const out = sh(
      [
        'root=/x/skew',
        // A backward clock jump logged a 0s run between two real ones.
        'harness_mutation_history_append "$root" 2026-09-10T10:00:00Z 180 100 70',
        'harness_mutation_history_append "$root" 2026-09-10T11:00:00Z 0 0 0',
        'harness_mutation_history_append "$root" 2026-09-10T12:00:00Z 420 120 72',
        'harness_mutation_estimate_line "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      tmp,
    );
    // The 0s record is filtered: avg(180,420) = 300s = ~5m, and the last VALID
    // run (420s = 7m over 120 mutants) feeds the parenthetical — not the 0s row.
    expect(out).toBe('Estimated ~5m (last run: 7m over 120 mutants on 2026-09-10)');
  });

  it('still estimates from a lone positive record with no valid neighbours', () => {
    const tmp = freshTmp();
    const out = sh(
      [
        'root=/x/lone',
        'harness_mutation_history_append "$root" 2026-09-10T09:00:00Z 0 0 0',
        'harness_mutation_history_append "$root" 2026-09-10T10:00:00Z 300 90 68',
        'harness_mutation_estimate_line "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      tmp,
    );
    expect(out).toBe('Estimated ~5m (last run: 5m over 90 mutants on 2026-09-10)');
  });

  it('reports no estimate (never crashes) when the history file is corrupt', () => {
    const tmp = freshTmp();
    const out = sh(
      [
        'root=/x/corrupt',
        'f="$(harness_mutation_history_file "$root")"',
        'printf "garbage with no numeric duration\\nalso junk\\n" > "$f"',
        'harness_mutation_estimate_line "$f"',
      ].join('\n'),
      tmp,
    );
    expect(out).toBe(NO_HISTORY);
  });
});
