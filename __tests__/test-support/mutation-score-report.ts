import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// The scorer is spawned as a real script against a report fixture on disk (the
// __tests__/deps-ranges.test.ts pattern), rather than requiring its internals.
export const SCRIPT = join(__dirname, '../../scripts/checks/mutation-score.js');

export type CliResult = { code: number; stdout: string; stderr: string };

export const run = (reportPath: string, changedFiles: string[]): CliResult => {
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

// Every scope entry is `path:start-end`. A fixture mutant sits on line 1, so this range holds it.
export const ranged = (...paths: string[]): string[] => paths.map((path) => `${path}:1-9`);

// Builds a fileResult in the real mutation-testing-report-schema shape (a flat
// `mutants` array of `{ status, location }` objects) by EXPANDING a status -> count map,
// so these tests exercise the same shape Stryker's own json reporter writes,
// without committing a multi-hundred-KB report fixture.
export const fileResult = (counts: Record<string, number>) => ({
  mutants: Object.entries(counts).flatMap(([status, count]) =>
    Array.from({ length: count }, () => ({
      status,
      location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    })),
  ),
});

// `config.mutate` is where Stryker's report records the scope of its own run;
// it defaults to the files that carry mutants, and `scope` overrides it for the
// files Stryker wrote no entry for (it omits a file with zero mutants).
export const writeReport = (
  directory: string,
  files: Record<string, Record<string, number>>,
  scope: string[] = ranged(...Object.keys(files)),
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
