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
const sh = (script: string, temporaryDirectory: string, input = ''): string => {
  const result = spawnSync('bash', ['-c', `source "${LIB}"\n${script}`], {
    env: { ...process.env, TMPDIR: temporaryDirectory },
    encoding: 'utf8',
    input,
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

const DRY_RUN_LINE =
  'Initial test run succeeded. Ran 9294 tests in 2 minutes 18 seconds (net 101106 ms, overhead 37176 ms).';

const REAL_PROGRESS_LINE =
  'Mutation testing 94% (elapsed: ~9h 22m, remaining: ~31m) 1117/1130 tested (56 survived, 435 timed out)';

// Stryker's append-only progress reporter prints one of these every 10 seconds.
const progressLine = (tested: number, mutants: number, timedOut: number): string =>
  `Mutation testing ${Math.floor((tested / mutants) * 100)}% (elapsed: ~1m, remaining: ~2m) ${tested}/${mutants} tested (7 survived, ${timedOut} timed out)`;

// One history record: iso, duration, mutant count, score, tested, timed out.
const record = (duration: number, count: number, tested: number, timedOut: number): string =>
  `2026-09-10T10:00:00Z ${duration} ${count} 70 ${tested} ${timedOut}`;

const withHistory = (records: string[], command: string): string =>
  [
    'root=/x/records',
    ...records.map((fields) => `harness_mutation_history_append "$root" ${fields}`),
    command,
  ].join('\n');

describe('_lib.sh harness_mutation_run_counts (pure)', () => {
  it('reads the mutant, tested, and timed-out counts from the last progress line', () => {
    const log = [
      DRY_RUN_LINE,
      progressLine(113, 1130, 44),
      REAL_PROGRESS_LINE,
      '  ✓ tallies the rules 1/2/3 case',
    ].join('\n');

    expect(sh('harness_mutation_run_counts', freshTemporaryDirectory(), `${log}\n`)).toBe(
      '1130 1117 435',
    );
  });

  it('leaves the timed-out field empty when the counter has no timeout clause', () => {
    const out = sh(
      [
        "IFS=' ' read -r mutants tested timed_out < <(harness_mutation_run_counts)",
        'printf "[%s][%s][%s]" "$mutants" "$tested" "$timed_out"',
      ].join('\n'),
      freshTemporaryDirectory(),
      '10/500 tested\n',
    );

    expect(out).toBe('[500][10][]');
  });

  it('prints nothing when no line is a tested counter', () => {
    expect(
      sh(
        'harness_mutation_run_counts',
        freshTemporaryDirectory(),
        'rules 1/2/3\n7/9 untested\nno counter at all\n',
      ),
    ).toBe('');
  });
});

describe('_lib.sh mutation state location', () => {
  it('keeps one history file for a repository and its linked worktree', () => {
    const out = sh(
      [
        'repository="$TMPDIR/repository"',
        'git init -q "$repository"',
        'git -C "$repository" -c user.email=a@b.c -c user.name=n commit -q --allow-empty -m base',
        'git -C "$repository" worktree add -q "$TMPDIR/linked" -b linked',
        'printf "%s\\n%s\\n" "$(harness_mutation_history_file "$repository")" "$(harness_mutation_history_file "$TMPDIR/linked")"',
        'printf "%s\\n" "$(harness_state_dir "$(git -C "$repository" rev-parse --path-format=absolute --git-common-dir)")/mutation/history.tsv"',
      ].join('\n'),
      freshTemporaryDirectory(),
    ).split('\n');

    expect(out[0]).toBe(out[1]);
    expect(out[0]).toBe(out[2]);
  });

  it('keys a root outside any git repository by the root itself', () => {
    const out = sh(
      [
        'printf "%s\\n" "$(harness_mutation_history_file /x/plain)"',
        'printf "%s\\n" "$(harness_state_dir /x/plain)/mutation/history.tsv"',
      ].join('\n'),
      freshTemporaryDirectory(),
    ).split('\n');

    expect(out[0]).toBe(out[1]);
  });

  it('puts the per-file history beside the run history', () => {
    const out = sh(
      [
        'root=/x/beside',
        'printf "%s\\n" "$(dirname "$(harness_mutation_history_file "$root")")"',
        'printf "%s\\n" "$(dirname "$(harness_mutation_files_file "$root")")"',
        'basename "$(harness_mutation_files_file "$root")"',
      ].join('\n'),
      freshTemporaryDirectory(),
    ).split('\n');

    expect(out[0]).toBe(out[1]);
    expect(out[2]).toBe('files.tsv');
  });

  it('appends a history record of six tab-separated fields', () => {
    const out = sh(
      withHistory(
        ['2026-09-10T10:00:00Z 300 150 68 140 21', '2026-09-10T11:00:00Z 300 150 68'],
        'awk -F"\\t" \'{ printf "%d|%s|%s\\n", NF, $5, $6 }\' "$(harness_mutation_history_file "$root")"',
      ),
      freshTemporaryDirectory(),
    );

    expect(out).toBe('6|140|21\n6||');
  });
});

describe('_lib.sh harness_mutation_files_append', () => {
  it('writes one row per graded file with its tested and timed-out counts', () => {
    const scorerOutput = [
      'src/alpha.ts: 83.33 killed=8 timeout=2 survived=2 noCoverage=1',
      'src/beta.ts: n/a (no mutants)',
      'src/gamma.ts: excluded (declaration only)',
      'src/delta.ts: n/a (no graded mutants) killed=0 timeout=0 survived=0 noCoverage=0',
      'src/epsilon.ts: 100.00 killed=5 timeout=0 survived=0 noCoverage=0',
      'CHANGE SET TOTAL: 90.00 killed=13 timeout=2 survived=2 noCoverage=1',
      'GATE: change set >= 75, each file >= 60',
    ].join('\n');

    const out = sh(
      [
        'root=/x/rows',
        'harness_mutation_files_append "$root" 2026-10-13T08:00:00Z',
        'cat "$(harness_mutation_files_file "$root")"',
      ].join('\n'),
      freshTemporaryDirectory(),
      `${scorerOutput}\n`,
    );

    expect(out).toBe(
      '2026-10-13T08:00:00Z\tsrc/alpha.ts\t12\t2\n2026-10-13T08:00:00Z\tsrc/epsilon.ts\t5\t0',
    );
  });
});

describe('_lib.sh harness_mutation_costs (pure)', () => {
  const costs = (records: string[]): string =>
    sh(
      withHistory(records, 'harness_mutation_costs "$(harness_mutation_history_file "$root")"'),
      freshTemporaryDirectory(),
    );

  it('fits the cost of a normal mutant and of a timed-out one', () => {
    // 2 s per normal mutant and 40 s per timed-out one:
    // 100 normal = 200; 50 normal + 50 timed out = 2100; 150 normal + 50 timed out = 2300.
    expect(
      costs([record(200, 100, 100, 0), record(2100, 100, 100, 50), record(2300, 200, 100, 25)]),
    ).toBe('2 40');
  });

  it('ignores records that lack the tested and timed-out fields', () => {
    expect(
      costs([
        '2026-09-10T09:00:00Z 9000 100 70',
        record(200, 100, 100, 0),
        record(2100, 100, 100, 50),
      ]),
    ).toBe('2 40');
    expect(costs(['2026-09-10T09:00:00Z 9000 100 70', record(200, 100, 100, 0)])).toBe('');
  });

  it('counts only the last 10 qualifying records', () => {
    // The oldest record is an outlier; the next five carry no timeouts and the last five carry
    // half timeouts, so a window of 5 sees one share only (no fit) and a window of 11 is skewed.
    const records = [
      record(99999, 100, 100, 0),
      ...Array.from({ length: 5 }, () => record(200, 100, 100, 0)),
      ...Array.from({ length: 5 }, () => record(2100, 100, 100, 50)),
    ];

    expect(costs(records)).toBe('2 40');
  });

  it.each([
    ['no history file at all', []],
    ['a single record', [record(200, 100, 100, 0)]],
    ['no timeout in any record', [record(200, 100, 100, 0), record(400, 200, 200, 0)]],
    ['every mutant timed out', [record(2000, 100, 100, 100), record(4000, 200, 200, 200)]],
    [
      'one timeout share in every record',
      [record(2100, 100, 100, 50), record(4200, 200, 200, 100), record(6300, 300, 300, 150)],
    ],
    ['a negative timeout cost', [record(200, 100, 100, 0), record(50, 100, 100, 50)]],
    ['more timed out than tested', [record(200, 100, 10, 20), record(300, 100, 10, 30)]],
    ['nothing tested', [record(200, 100, 0, 0), record(300, 100, 0, 0)]],
    [
      'fields that are not numbers',
      ['x 200 100 70 abc 1', '2026-09-10T10:00:00Z 300 100 70 10 many'],
    ],
    ['a zero duration', [record(0, 100, 100, 0), record(0, 100, 100, 50)]],
    [
      'timeout shares of 40% and 42% with 4% noise in one duration',
      // True costs 2 s and 40 s would give 17200 and 16164; the second duration is 4% lower, which
      // an unguarded fit reads as a timed-out mutant costing barely more than a normal one.
      [record(17200, 1000, 1000, 400), record(15500, 900, 900, 378)],
    ],
  ])('prints nothing for %s', (_title, records) => {
    expect(costs(records)).toBe('');
  });

  it('fits the costs of two records whose timeout shares are 32% and 48%', () => {
    // 100 * (0.68 * 2 + 0.32 * 40) = 1416 and 100 * (0.52 * 2 + 0.48 * 40) = 2024.
    expect(costs([record(1416, 100, 100, 32), record(2024, 100, 100, 48)])).toBe('2 40');
  });

  it('prints nothing for two records whose timeout shares are 33% and 47%', () => {
    // 100 * (0.67 * 2 + 0.33 * 40) = 1454 and 100 * (0.53 * 2 + 0.47 * 40) = 1986. The shares are
    // 14 points apart (sin squared 0.0814 of the angle between the two columns, under 0.1).
    expect(costs([record(1454, 100, 100, 33), record(1986, 100, 100, 47)])).toBe('');
  });

  it('fits the costs of two records whose timeout shares are 10% and 40%', () => {
    // 200 * (0.9 * 2 + 0.1 * 40) = 1160 and 150 * (0.6 * 2 + 0.4 * 40) = 2580.
    expect(costs([record(1160, 200, 200, 20), record(2580, 150, 150, 60)])).toBe('2 40');
  });
});

describe('_lib.sh harness_mutation_run_share (pure)', () => {
  const runShare = (records: string[]): string =>
    sh(
      withHistory(records, 'harness_mutation_run_share "$(harness_mutation_history_file "$root")"'),
      freshTemporaryDirectory(),
    );

  it('prints the percent of tested mutants that timed out over the records', () => {
    // 30 + 90 = 120 timed out of 100 + 300 = 400 tested.
    expect(runShare([record(500, 100, 100, 30), record(1500, 300, 300, 90)])).toBe('30');
  });

  it('keeps the fraction of a share that does not divide evenly', () => {
    expect(runShare([record(500, 100, 300, 100)])).toBe('33.3333');
  });

  it('counts only the last 5 records that carry the two fields', () => {
    const records = [
      record(900, 100, 100, 100),
      ...Array.from({ length: 5 }, (_unused, index) => record(900, 100, 100, 10 + index)),
      '2026-09-10T12:00:00Z 900 100 70',
    ];

    // 10 + 11 + 12 + 13 + 14 = 60 timed out of 500 tested.
    expect(runShare(records)).toBe('12');
  });

  it.each([
    ['no history file at all', []],
    ['records without the tested and timed-out fields', ['2026-09-10T09:00:00Z 9000 100 70']],
    ['nothing tested', [record(200, 100, 0, 0)]],
    ['more timed out than tested', [record(200, 100, 10, 20)]],
  ])('prints nothing for %s', (_title, records) => {
    expect(runShare(records)).toBe('');
  });
});

describe('_lib.sh harness_mutation_timeout_share (pure)', () => {
  type FileRow = [path: string, tested: number, timedOut: number];

  const share = (
    input: Array<[path: string, lines: number]>,
    fileRows: FileRow[],
    historyRecords: string[] = [],
  ): string =>
    sh(
      [
        'root=/x/share',
        'files="$(harness_mutation_files_file "$root")"',
        ...fileRows.map(
          ([path, tested, timedOut]) =>
            `printf '2026-09-10T10:00:00Z\\t%s\\t%s\\t%s\\n' ${path} ${tested} ${timedOut} >> "$files"`,
        ),
        ...historyRecords.map((fields) => `harness_mutation_history_append "$root" ${fields}`),
        'harness_mutation_timeout_share "$files" "$(harness_mutation_history_file "$root")"',
      ].join('\n'),
      freshTemporaryDirectory(),
      input.map(([path, lines]) => `${path}\t${lines}\n`).join(''),
    );

  it('weights each file share by its changed lines', () => {
    // alpha 10% over 30 lines and beta 50% over 10 lines: (30*10 + 10*50) / 40 = 20.
    expect(
      share(
        [
          ['src/alpha.ts', 30],
          ['src/beta.ts', 10],
        ],
        [
          ['src/alpha.ts', 100, 10],
          ['src/beta.ts', 200, 100],
        ],
      ),
    ).toBe('20.0 2 2');
  });

  it('counts only the last 3 records of a file', () => {
    // alpha: the 100% record is outside the window; (10 + 20 + 30) / 300 = 20%.
    // (30*20 + 10*50) / 40 = 27.5.
    expect(
      share(
        [
          ['src/alpha.ts', 30],
          ['src/beta.ts', 10],
        ],
        [
          ['src/alpha.ts', 100, 100],
          ['src/alpha.ts', 100, 10],
          ['src/alpha.ts', 100, 20],
          ['src/alpha.ts', 100, 30],
          ['src/beta.ts', 200, 100],
        ],
      ),
    ).toBe('27.5 2 2');
  });

  it('gives a file without history the run-level share of the last 5 runs', () => {
    // Run level over the last 5 records: (5 + 10 + 15 + 20 + 30) / 500 = 16%; the first record
    // (1000 of 1000) is outside the window. (30*10 + 20*16) / 50 = 12.4.
    expect(
      share(
        [
          ['src/alpha.ts', 30],
          ['src/gamma.ts', 20],
        ],
        [['src/alpha.ts', 100, 10]],
        [
          record(900, 100, 1000, 1000),
          record(900, 100, 100, 5),
          record(900, 100, 100, 10),
          record(900, 100, 100, 15),
          record(900, 100, 100, 20),
          record(900, 100, 100, 30),
        ],
      ),
    ).toBe('12.4 2 2');
  });

  it('leaves out a file without history when no run level share exists', () => {
    expect(
      share(
        [
          ['src/alpha.ts', 30],
          ['src/gamma.ts', 20],
        ],
        [['src/alpha.ts', 100, 10]],
        ['2026-09-10T09:00:00Z 900 100 70'],
      ),
    ).toBe('10.0 1 2');
  });

  it.each([
    ['no history of any kind', [['src/alpha.ts', 30]], []],
    ['a file with no changed lines', [['src/alpha.ts', 0]], [['src/alpha.ts', 100, 10]]],
    ['no file at all', [], [['src/alpha.ts', 100, 10]]],
  ] as Array<[string, Array<[string, number]>, FileRow[]]>)(
    'prints nothing for %s',
    (_title, input, fileRows) => {
      expect(share(input, fileRows)).toBe('');
    },
  );
});

describe('_lib.sh harness_mutation_eta_filter (pure)', () => {
  const quoted = (argument: string): string => `'${argument}'`;

  const filtered = (filterArguments: string[], input: string[]): string[] =>
    sh(
      `harness_mutation_eta_filter ${filterArguments.map(quoted).join(' ')}`,
      freshTemporaryDirectory(),
      `${input.join('\n')}\n`,
    ).split('\n');

  const SPLIT = ['2', '3', '40', '25', '5000', '2'];
  const RATE_ONLY = ['2', '', '', '', '5000', '2'];
  const estimates = (output: string[]): string[] => output.filter((line) => /^Estimate/.test(line));

  it('passes every input line through unchanged', () => {
    const input = ['first', 'rules 1/2/3', progressLine(10, 100, 2), 'last'];

    expect(filtered(SPLIT, input).filter((line) => !/^Estimate/.test(line))).toEqual(input);
  });

  it('prints the split initial line from the fitted costs and the file share', () => {
    // 500 * (0.75 * 3 + 0.25 * 40) = 6125 s.
    expect(estimates(filtered(SPLIT, [progressLine(10, 500, 2)]))).toEqual([
      'Estimated ~102m 5s for 500 mutants (~3s/mutant, 25% timeouts at ~40s each, from history)',
    ]);
  });

  it('prints the plain initial line when only the rate is known', () => {
    expect(estimates(filtered(['2', '', '', '', '', ''], ['10/500 tested']))).toEqual([
      'Estimated ~16m 40s for 500 mutants (~2s/mutant from history)',
    ]);
  });

  it('prints the plain initial line when a share exists but no timeout cost can be known', () => {
    expect(
      estimates(filtered(['2', '', '', '25', '5000', '2'], [progressLine(10, 500, 2)])),
    ).toEqual(['Estimated ~16m 40s for 500 mutants (~2s/mutant from history)']);
  });

  it('never triggers on a slash pair that is not a tested counter', () => {
    const input = ['rules 1/2/3 keeps the order', '7/9 untested'];

    expect(filtered(SPLIT, input)).toEqual(input);
  });

  it('falls back to the configured floor for the timeout cost when no fit exists', () => {
    // floor = 2 + (5000 + 37176) / 1000 / 2 = 23.088 s; q = 40 / 100;
    // remaining = 900 * (0.6 * 2 + 0.4 * 23.088) = 9391.68 s.
    expect(estimates(filtered(RATE_ONLY, [DRY_RUN_LINE, progressLine(100, 1000, 40)]))).toEqual([
      'Estimated ~33m 20s for 1000 mutants (~2s/mutant from history)',
      'Estimate at 10%: ~156m 32s remaining (40% timeouts so far)',
    ]);
  });

  it('splits the initial line with the floor when a share exists but no fit does', () => {
    // 1000 * (0.75 * 2 + 0.25 * 23.088) = 7272 s.
    expect(
      estimates(
        filtered(['2', '', '', '25', '5000', '2'], [DRY_RUN_LINE, progressLine(10, 1000, 2)]),
      ),
    ).toEqual([
      'Estimated ~121m 12s for 1000 mutants (~2s/mutant, 25% timeouts at ~23.088s each, from history)',
    ]);
  });

  it('counts the timeouts once when the history rate already holds a timeout share', () => {
    // rate 17.2 s/mutant over history runs at 40% timeouts, floor = (5000 + 37176) / 1000 / 2 =
    // 21.088 s: a = 17.2 - 0.4 * 21.088 = 8.7648 s, b = a + 21.088 = 29.8528 s, and a run at
    // 40% costs 1000 * (0.6 * 8.7648 + 0.4 * 29.8528) = 17200 s, the history rate times M.
    // At 40% with q = 160 / 400 the remaining 600 mutants cost 600 * 17.2 = 10320 s.
    expect(
      estimates(
        filtered(
          ['17.2', '', '', '40', '5000', '2', '40'],
          [DRY_RUN_LINE, progressLine(400, 1000, 160)],
        ),
      ),
    ).toEqual([
      'Estimated ~286m 40s for 1000 mutants (~8.7648s/mutant, 40% timeouts at ~29.8528s each, from history)',
      'Estimate at 40%: ~172m remaining (40% timeouts so far)',
    ]);
  });

  it('keeps the rate times the mutant count at a run share below the history share', () => {
    // rate 10, history share 25%, floor 21.088 s: a = 10 - 0.25 * 21.088 = 4.728 s and
    // b = 25.816 s; a run at 10% costs 500 * (0.9 * 4.728 + 0.1 * 25.816) = 3418.4 s, less than
    // the 5000 s of the rate times 500 because this run has fewer timeouts than the history.
    expect(
      estimates(
        filtered(['10', '', '', '10', '5000', '2', '25'], [DRY_RUN_LINE, progressLine(10, 500, 2)]),
      ),
    ).toEqual([
      'Estimated ~56m 58s for 500 mutants (~4.728s/mutant, 10% timeouts at ~25.816s each, from history)',
    ]);
  });

  it('falls back to the plain rate when the history share leaves no positive normal cost', () => {
    // rate 2, history share 50%, floor 21.088 s: a = 2 - 10.544 is negative, so the timed-out cost
    // is unknown and the estimate is the rate times the mutant count, with no update.
    expect(
      estimates(
        filtered(
          ['2', '', '', '25', '5000', '2', '50'],
          [DRY_RUN_LINE, progressLine(100, 1000, 40)],
        ),
      ),
    ).toEqual(['Estimated ~33m 20s for 1000 mutants (~2s/mutant from history)']);
  });

  it('uses the fitted costs and ignores the history share when a fit exists', () => {
    expect(
      estimates(filtered(['2', '3', '40', '25', '5000', '2', '40'], [progressLine(10, 500, 2)])),
    ).toEqual([
      'Estimated ~102m 5s for 500 mutants (~3s/mutant, 25% timeouts at ~40s each, from history)',
    ]);
  });

  it('prints no floor update without a concurrency or without the dry-run line', () => {
    const counter = progressLine(100, 1000, 40);

    expect(estimates(filtered(['2', '', '', '', '5000', ''], [DRY_RUN_LINE, counter]))).toEqual([
      'Estimated ~33m 20s for 1000 mutants (~2s/mutant from history)',
    ]);
    expect(estimates(filtered(RATE_ONLY, [counter]))).toEqual([
      'Estimated ~33m 20s for 1000 mutants (~2s/mutant from history)',
    ]);
  });

  it('prints one update per 10% boundary even when the counter repeats', () => {
    // At 10%: q = 40 / 100, 900 * (0.6 * 3 + 0.4 * 40) = 16020 s.
    // At 20%: q = 100 / 200, 800 * (0.5 * 3 + 0.5 * 40) = 17200 s.
    expect(
      estimates(
        filtered(SPLIT, [
          progressLine(100, 1000, 40),
          progressLine(150, 1000, 60),
          progressLine(200, 1000, 100),
          progressLine(205, 1000, 105),
        ]),
      ).slice(1),
    ).toEqual([
      'Estimate at 10%: ~267m remaining (40% timeouts so far)',
      'Estimate at 20%: ~286m 40s remaining (50% timeouts so far)',
    ]);
  });

  it('waits for 20 tested mutants before the first update', () => {
    // At 20 of 100: q = 15 / 20, 80 * (0.25 * 3 + 0.75 * 40) = 2460 s.
    expect(
      estimates(filtered(SPLIT, [progressLine(10, 100, 8), progressLine(20, 100, 15)])).slice(1),
    ).toEqual(['Estimate at 20%: ~41m remaining (75% timeouts so far)']);
  });

  it('prints no update when the counter has no timeout clause', () => {
    expect(estimates(filtered(SPLIT, ['300/1000 tested'])).length).toBe(1);
  });

  it('takes the update share from the counter, not from the history share', () => {
    // History share 5%; the counter says 50 of 100. 900 * (0.5 * 3 + 0.5 * 40) = 19350 s.
    expect(
      estimates(filtered(['2', '3', '40', '5', '5000', '2'], [progressLine(100, 1000, 50)])),
    ).toEqual([
      'Estimated ~80m 50s for 1000 mutants (~3s/mutant, 5% timeouts at ~40s each, from history)',
      'Estimate at 10%: ~322m 30s remaining (50% timeouts so far)',
    ]);
  });

  it.each([
    ['text for every argument', ['abc', 'x', 'y', 'z', 'w', 'v']],
    ['no rate', ['', '', '', '', '', '']],
    ['a negative rate', ['-2', '3', '40', '25', '5000', '2']],
    ['a zero rate and zero costs', ['0', '0', '0', '0', '0', '0']],
    ['costs without a rate', ['', '3', '40', '25', '5000', '2']],
  ])(
    'passes every line through, prints no estimate, and exits 0 for %s',
    (_title, filterArguments) => {
      const input = [DRY_RUN_LINE, progressLine(100, 1000, 40), 'tail line'];

      const out = sh(
        [
          `harness_mutation_eta_filter ${filterArguments.map(quoted).join(' ')}`,
          'printf "status=%s" "$?"',
        ].join('\n'),
        freshTemporaryDirectory(),
        `${input.join('\n')}\n`,
      ).split('\n');

      expect(out).toEqual([...input, 'status=0']);
    },
  );
});
