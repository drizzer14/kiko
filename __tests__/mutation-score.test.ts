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

const writeReport = (directory: string, files: Record<string, Record<string, number>>): string => {
  const reportPath = join(directory, 'mutation.json');
  const reportBody = {
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

  it('fails and names a changed file that is MISSING from the report entirely', () => {
    const reportPath = writeReport(directory, { 'src/a.ts': { Killed: 100 } });

    const result = run(reportPath, ['src/a.ts', 'src/never-mutated.ts']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('src/never-mutated.ts: MISSING FROM REPORT');
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

// The exact per-file status counts below were read directly from a real Stryker
// incremental report (base 3d032770, tip 0cc210fb) via the schema's own
// `files[path].mutants[].status` field — not hand-invented — so this proves the
// scorer's table and gate against a REAL run's numbers, reproduced here as
// status-count fixtures rather than committing the ~190-file, multi-MB report.
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

describe('mutation-score.js against the real 2026-10-03 window (base 3d032770, tip 0cc210fb)', () => {
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
    // The lowest file in this window (statistics.screen.tsx, 73.41) still
    // clears the 60 per-file floor, and the 80.99 total clears the 75
    // change-set threshold, so this real window PASSES the new gate.
    expect(result.stdout).toContain('src/screens/statistics/statistics.screen.tsx: 73.41');
    expect(result.stdout).toContain('src/transactions/repo/transactions.repo.ts: 85.21');
    expect(result.stdout).toContain('CHANGE SET TOTAL: 80.99');
    expect(result.code).toBe(0);
  });
});
