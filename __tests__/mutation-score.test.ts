import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';

// scripts/checks/mutation-score.js scores a CHANGE SET (not Stryker's own
// whole-incremental-report "All files" row) from its JSON reporter output:
// killed+timeout over killed+timeout+survived+noCoverage, restricted to the
// files THIS run mutated. These spawn the real script against a report
// fixture on disk (the __tests__/deps-ranges.test.ts pattern), rather than
// requiring its internals directly.
const SCRIPT = join(__dirname, '../scripts/checks/mutation-score.js');

type CliResult = { code: number; stdout: string; stderr: string };

const run = (reportPath: string, changedFiles: string[]): CliResult => {
  try {
    const stdout = execFileSync('node', [SCRIPT, reportPath, ...changedFiles], {
      encoding: 'utf8',
    });

    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };

    return { code: failure.status, stdout: failure.stdout, stderr: failure.stderr };
  }
};

// Builds a fileResult in the real mutation-testing-report-schema shape (a flat
// `mutants` array of `{ status }` objects) by EXPANDING a status -> count map,
// so these tests exercise the same shape Stryker's own json reporter writes,
// without committing a multi-hundred-KB report fixture.
const fileResult = (counts: Record<string, number>) => ({
  mutants: Object.entries(counts).flatMap(([status, count]) =>
    Array.from({ length: count }, () => ({ status })),
  ),
});

// `config.mutate` is where Stryker's report records the scope of its own run;
// it defaults to the files that carry mutants, and `scope` overrides it for the
// files Stryker wrote no entry for (it omits a file with zero mutants).
const writeReport = (
  directory: string,
  files: Record<string, Record<string, number>>,
  scope: string[] = Object.keys(files),
): string => {
  const reportPath = join(directory, 'mutation.json');
  const reportBody = {
    config: { mutate: scope },
    files: Object.fromEntries(
      Object.entries(files).map(([path, counts]) => [path, fileResult(counts)]),
    ),
  };
  writeFileSync(reportPath, JSON.stringify(reportBody));

  return reportPath;
};

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'kiko-mutation-score-'));
});

describe('mutation-score.js: the per-file and change-set formula', () => {
  it('scores killed+timeout over killed+timeout+survived+noCoverage', () => {
    const reportPath = writeReport(directory, {
      'src/a.ts': { Killed: 7, Timeout: 1, Survived: 1, NoCoverage: 1 },
    });

    const result = run(reportPath, ['src/a.ts']);

    // (7+1) / (7+1+1+1) * 100 = 80.00
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('src/a.ts: 80.00');
    expect(result.stdout).toContain('CHANGE SET TOTAL: 80.00');
  });

  it('prints its own thresholds so a wrapper never restates them', () => {
    const reportPath = writeReport(directory, { 'src/a.ts': { Killed: 1 } });

    const result = run(reportPath, ['src/a.ts']);

    expect(result.stdout).toContain('GATE: change set >= 75, each file >= 60');
  });

  it('excludes RuntimeError, CompileError, Ignored, and Pending from both sides of the ratio', () => {
    const reportPath = writeReport(directory, {
      'src/a.ts': {
        Killed: 9,
        Survived: 1,
        RuntimeError: 5,
        CompileError: 5,
        Ignored: 5,
        Pending: 5,
      },
    });

    const result = run(reportPath, ['src/a.ts']);

    expect(result.stdout).toContain('src/a.ts: 90.00');
  });

  it('reports a file with zero graded mutants as ungraded, not a zero score', () => {
    const reportPath = writeReport(directory, { 'src/a.ts': { RuntimeError: 3 } });

    const result = run(reportPath, ['src/a.ts']);

    // Nothing to grade: this must not fail the gate and must not read as 0%.
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('src/a.ts: n/a (no graded mutants)');
    expect(result.stdout).toContain('CHANGE SET TOTAL: n/a (no graded mutants)');
  });
});

describe('mutation-score.js: the gate (75 change-set / 60 per-file floor)', () => {
  it('passes when the aggregate clears 75 and every file clears the 60 floor', () => {
    const reportPath = writeReport(directory, {
      'src/a.ts': { Killed: 90, Survived: 10 }, // 90
      'src/b.ts': { Killed: 61, Survived: 39 }, // 61
    });

    const result = run(reportPath, ['src/a.ts', 'src/b.ts']);

    expect(result.code).toBe(0);
    // (90+61)/200 * 100 == 75.5
    expect(result.stdout).toContain('CHANGE SET TOTAL: 75.50');
  });

  it('fails when the aggregate is below 75, even though every file clears the 60 floor', () => {
    const reportPath = writeReport(directory, {
      'src/a.ts': { Killed: 60, Survived: 40 }, // 60
      'src/b.ts': { Killed: 60, Survived: 40 }, // 60
    });

    const result = run(reportPath, ['src/a.ts', 'src/b.ts']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('CHANGE SET TOTAL: 60.00');
  });

  it('fails when a SINGLE file is below 60, even though the aggregate clears 75', () => {
    const reportPath = writeReport(directory, {
      'src/weak.ts': { Killed: 5, Survived: 95 }, // 5
      'src/strong.ts': { Killed: 995, Survived: 5 }, // 99.5
    });

    const result = run(reportPath, ['src/weak.ts', 'src/strong.ts']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('src/weak.ts: 5.00');
    // The aggregate alone clears 75 here, so only the per-file floor failed it.
    const [, totalLine] = /CHANGE SET TOTAL: (\d+\.\d\d)/.exec(result.stdout) ?? [];
    expect(Number(totalLine)).toBeGreaterThanOrEqual(75);
  });

  it('does not fail an in-scope file the report has no entry for (it has no mutants)', () => {
    const reportPath = writeReport(directory, { 'src/a.ts': { Killed: 100 } }, [
      'src/a.ts',
      'src/constant.ts',
    ]);

    const result = run(reportPath, ['src/a.ts', 'src/constant.ts']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('src/constant.ts: n/a (no mutants)');
    expect(result.stdout).toContain('CHANGE SET TOTAL: 100.00');
  });

  it('passes a change set whose every file has no mutants', () => {
    const reportPath = writeReport(directory, {}, ['src/constant.ts']);

    const result = run(reportPath, ['src/constant.ts']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('CHANGE SET TOTAL: n/a (no graded mutants)');
  });
});

describe('mutation-score.js: the report must belong to this run', () => {
  it('fails when a changed file is not in the scope the report recorded', () => {
    const reportPath = writeReport(directory, { 'src/a.ts': { Killed: 100 } });

    const result = run(reportPath, ['src/a.ts', 'src/never-mutated.ts']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('does not belong to this run');
    expect(result.stdout).toContain('src/never-mutated.ts');
  });

  it('fails when the report recorded a file this run did not mutate', () => {
    const reportPath = writeReport(directory, { 'src/a.ts': { Killed: 100 } }, [
      'src/a.ts',
      'src/other.ts',
    ]);

    const result = run(reportPath, ['src/a.ts']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('does not belong to this run');
    expect(result.stdout).toContain('src/other.ts');
  });

  it('fails when the report records no scope at all', () => {
    const reportPath = join(directory, 'mutation.json');
    writeFileSync(
      reportPath,
      JSON.stringify({ files: { 'src/a.ts': fileResult({ Killed: 100 }) } }),
    );

    const result = run(reportPath, ['src/a.ts']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('does not belong to this run');
  });

  it('accepts the recorded scope in any order', () => {
    const reportPath = writeReport(
      directory,
      { 'src/a.ts': { Killed: 100 }, 'src/b.ts': { Killed: 100 } },
      ['src/b.ts', 'src/a.ts'],
    );

    const result = run(reportPath, ['src/a.ts', 'src/b.ts']);

    expect(result.code).toBe(0);
  });
});

// A mutant with the location Stryker's json reporter writes: `[status, startLine, endLine]`.
type LocatedMutant = [status: string, startLine: number, endLine?: number];

// The scope entries are `path:start-end` for a changed-line range and a plain `path` for a whole
// file, exactly as mutation.sh passes them to --mutate; `config.mutate` records them verbatim.
const writeLocatedReport = (
  directory: string,
  files: Record<string, Array<LocatedMutant | string>>,
  scope: string[],
): string => {
  const reportPath = join(directory, 'mutation.json');
  const reportBody = {
    config: { mutate: scope },
    files: Object.fromEntries(
      Object.entries(files).map(([path, mutants]) => [
        path,
        {
          mutants: mutants.map((mutant) =>
            typeof mutant === 'string'
              ? { status: mutant }
              : {
                  status: mutant[0],
                  location: {
                    start: { line: mutant[1], column: 1 },
                    end: { line: mutant[2] ?? mutant[1], column: 2 },
                  },
                },
          ),
        },
      ]),
    ),
  };
  writeFileSync(reportPath, JSON.stringify(reportBody));

  return reportPath;
};

describe('mutation-score.js: changed-line ranges', () => {
  it('passes the scope check for a range report, whatever the order of the entries', () => {
    const reportPath = writeLocatedReport(
      directory,
      {
        'src/a.ts': [
          ['Killed', 2],
          ['Killed', 11],
        ],
      },
      ['src/a.ts:10-12', 'src/a.ts:1-5'],
    );

    const result = run(reportPath, ['src/a.ts:1-5', 'src/a.ts:10-12']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('src/a.ts: 100.00');
  });

  it('fails when the ranges differ, naming both entries', () => {
    const reportPath = writeLocatedReport(directory, { 'src/a.ts': [['Killed', 2]] }, [
      'src/a.ts:1-5',
    ]);

    const result = run(reportPath, ['src/a.ts:1-6']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('does not belong to this run');
    expect(result.stdout).toContain("changed but not in the report's scope: src/a.ts:1-6");
    expect(result.stdout).toContain("in the report's scope but not changed: src/a.ts:1-5");
  });

  it('fails when the report holds a plain path and the run holds a range for the same file', () => {
    const reportPath = writeLocatedReport(directory, { 'src/a.ts': [['Killed', 2]] }, ['src/a.ts']);

    const result = run(reportPath, ['src/a.ts:1-5']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('does not belong to this run');
  });

  it('does not let a carried-over out-of-range mutant lower the score', () => {
    // Incremental mode keeps an old mutant outside the ranges in files[path] with its old status.
    const reportPath = writeLocatedReport(
      directory,
      {
        'src/a.ts': [
          ['Killed', 3],
          ['Killed', 4],
          ['Survived', 20],
        ],
      },
      ['src/a.ts:3-4'],
    );

    const result = run(reportPath, ['src/a.ts:3-4']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('src/a.ts: 100.00 killed=2 timeout=0 survived=0 noCoverage=0');
    expect(result.stdout).toContain('CHANGE SET TOTAL: 100.00');
  });

  it('does not grade a mutant that starts inside a range and ends past it', () => {
    // Stryker itself creates a mutant only when its whole location is inside a range.
    const reportPath = writeLocatedReport(
      directory,
      {
        'src/a.ts': [
          ['Killed', 3, 4],
          ['Survived', 4, 6],
          ['Survived', 2, 3],
        ],
      },
      ['src/a.ts:3-4'],
    );

    const result = run(reportPath, ['src/a.ts:3-4']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('src/a.ts: 100.00 killed=1');
  });

  it('prints one row for a file with two ranges, counting the mutants of both', () => {
    const reportPath = writeLocatedReport(
      directory,
      {
        'src/a.ts': [
          ['Killed', 1],
          ['Killed', 2],
          ['Survived', 10],
          ['Killed', 11],
        ],
      },
      ['src/a.ts:1-2', 'src/a.ts:10-11'],
    );

    const result = run(reportPath, ['src/a.ts:1-2', 'src/a.ts:10-11']);

    expect(result.code).toBe(0);
    expect(result.stdout.split('\n').filter((line) => line.startsWith('src/a.ts:'))).toEqual([
      'src/a.ts: 75.00 killed=3 timeout=0 survived=1 noCoverage=0',
    ]);
  });

  it('grades every mutant of a file given as a plain path', () => {
    const reportPath = writeLocatedReport(
      directory,
      { 'src/a.ts': [['Killed', 1], ['Survived', 50], 'Survived'] },
      ['src/a.ts'],
    );

    const result = run(reportPath, ['src/a.ts']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('src/a.ts: 33.33 killed=1 timeout=0 survived=2 noCoverage=0');
  });

  it('reports a range that holds no mutant as ungraded and passes', () => {
    const reportPath = writeLocatedReport(directory, { 'src/a.ts': [['Survived', 20]] }, [
      'src/a.ts:3-4',
    ]);

    const result = run(reportPath, ['src/a.ts:3-4']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('src/a.ts: n/a (no graded mutants)');
    expect(result.stdout).toContain('CHANGE SET TOTAL: n/a (no graded mutants)');
  });

  it('exits 2 for a ranged file that has a mutant with no location', () => {
    const reportPath = writeLocatedReport(directory, { 'src/a.ts': [['Killed', 3], 'Killed'] }, [
      'src/a.ts:3-4',
    ]);

    const result = run(reportPath, ['src/a.ts:3-4']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('report mutant has no location');
    expect(result.stderr).toContain('src/a.ts');
  });

  it('still excludes src/db/schema.ts when it is given as a range', () => {
    const reportPath = writeLocatedReport(
      directory,
      {
        'src/db/schema.ts': [
          ['Survived', 1],
          ['Survived', 2],
        ],
        'src/a.ts': [['Killed', 1]],
      },
      ['src/db/schema.ts:1-9', 'src/a.ts:1-3'],
    );

    const result = run(reportPath, ['src/db/schema.ts:1-9', 'src/a.ts:1-3']);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/src\/db\/schema\.ts: excluded \(.+\)/);
    expect(result.stdout).toContain('CHANGE SET TOTAL: 100.00');
  });

  it.each([
    ['a range that ends before it starts', 'src/a.ts:5-3'],
    ['a range that starts at line 0', 'src/a.ts:0-3'],
  ])('exits 2 for %s', (_name, entry) => {
    const reportPath = writeLocatedReport(directory, { 'src/a.ts': [['Killed', 1]] }, [entry]);

    const result = run(reportPath, [entry]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(entry);
  });

  it('exits 2 when one file is given as a plain path and as a range', () => {
    const reportPath = writeLocatedReport(directory, { 'src/a.ts': [['Killed', 1]] }, [
      'src/a.ts',
      'src/a.ts:1-3',
    ]);

    const result = run(reportPath, ['src/a.ts', 'src/a.ts:1-3']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('src/a.ts');
  });
});

describe('mutation-score.js: the declaration-only exclusion allowlist', () => {
  it('excludes src/db/schema.ts from both the floor and the aggregate, whatever its score', () => {
    const reportPath = writeReport(directory, {
      'src/db/schema.ts': { Survived: 200 }, // would be 0% and fail the floor if graded
      'src/a.ts': { Killed: 100 },
    });

    const result = run(reportPath, ['src/db/schema.ts', 'src/a.ts']);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/src\/db\/schema\.ts: excluded \(.+\)/);
    // Excluded from the aggregate too: the total reflects only src/a.ts.
    expect(result.stdout).toContain('CHANGE SET TOTAL: 100.00');
  });
});

describe('mutation-score.js: CLI contract', () => {
  it('prints a usage message and exits 2 when no report path is given', () => {
    expect(() => execFileSync('node', [SCRIPT], { encoding: 'utf8' })).toThrow(
      expect.objectContaining({ status: 2 }),
    );
  });

  it('exits 2 when the report path does not exist or is not valid JSON', () => {
    const badPath = join(directory, 'not-json.json');
    writeFileSync(badPath, 'not json');

    expect(() => execFileSync('node', [SCRIPT, badPath, 'src/a.ts'], { encoding: 'utf8' })).toThrow(
      expect.objectContaining({ status: 2 }),
    );
  });

  it('exits 0 and prints a plain total when no changed files are given', () => {
    const reportPath = writeReport(directory, {});

    const stdout = execFileSync('node', [SCRIPT, reportPath], { encoding: 'utf8' });

    expect(stdout).toContain('CHANGE SET TOTAL: n/a (no changed files given)');
  });
});

// Per-file status counts read from a real Stryker report's
// `files[path].mutants[].status` field, reproduced as status-count fixtures
// rather than committing the multi-MB report.
const REAL_WINDOW_COUNTS: Record<string, Record<string, number>> = {
  'src/reminders/routing/route-response.ts': { Killed: 105, Survived: 7, NoCoverage: 1 },
  'src/screens/account-detail/account-detail.screen.tsx': {
    Killed: 161,
    Survived: 34,
    NoCoverage: 2,
  },
  'src/screens/forms/holding-form/holding-form.screen.tsx': {
    Killed: 302,
    Survived: 56,
    NoCoverage: 5,
    Timeout: 2,
  },
  'src/screens/forms/transaction-form/transaction-form.screen.tsx': {
    Killed: 861,
    Survived: 205,
    NoCoverage: 25,
    RuntimeError: 1,
  },
  'src/screens/home/home.screen.tsx': { Killed: 161, Survived: 33, NoCoverage: 5 },
  'src/screens/settings/reminders/reminders.screen.tsx': { Killed: 55, Survived: 3 },
  'src/screens/statistics/statistics.screen.tsx': { Killed: 301, Survived: 104, NoCoverage: 5 },
  'src/transactions/repo/transactions.repo.ts': {
    Killed: 455,
    Survived: 71,
    NoCoverage: 8,
    RuntimeError: 1,
  },
};

describe('mutation-score.js against the status counts of a real report', () => {
  it('computes each file score and the change-set total, and PASSES both gates', () => {
    const changedFiles = Object.keys(REAL_WINDOW_COUNTS);
    const reportPath = writeReport(directory, REAL_WINDOW_COUNTS);

    const result = run(reportPath, changedFiles);

    expect(result.stdout).toContain('src/reminders/routing/route-response.ts: 92.92');
    expect(result.stdout).toContain('src/screens/account-detail/account-detail.screen.tsx: 81.73');
    expect(result.stdout).toContain(
      'src/screens/forms/holding-form/holding-form.screen.tsx: 83.29',
    );
    expect(result.stdout).toContain(
      'src/screens/forms/transaction-form/transaction-form.screen.tsx: 78.92',
    );
    expect(result.stdout).toContain('src/screens/home/home.screen.tsx: 80.90');
    expect(result.stdout).toContain('src/screens/settings/reminders/reminders.screen.tsx: 94.83');
    // The lowest file (statistics.screen.tsx, 73.41) clears the 60 per-file
    // floor, and the 80.99 total clears the 75 change-set threshold.
    expect(result.stdout).toContain('src/screens/statistics/statistics.screen.tsx: 73.41');
    expect(result.stdout).toContain('src/transactions/repo/transactions.repo.ts: 85.21');
    expect(result.stdout).toContain('CHANGE SET TOTAL: 80.99');
    expect(result.code).toBe(0);
  });
});
