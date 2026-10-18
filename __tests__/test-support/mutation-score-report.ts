import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// The scorer is spawned as a real script against a report fixture on disk (the
// __tests__/deps-ranges.test.ts pattern), rather than requiring its internals.
export const SCRIPT = join(__dirname, '../../scripts/checks/mutation-score.js');

export type CliResult = { code: number; stdout: string; stderr: string };

export const runArguments = (scriptArguments: string[]): CliResult => {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...scriptArguments], {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };

    return { code: failure.status, stdout: failure.stdout, stderr: failure.stderr };
  }
};

export const run = (reportPath: string, changedFiles: string[]): CliResult =>
  runArguments([reportPath, ...changedFiles]);

export const runRerunCandidates = (reportPath: string, entries: string[]): CliResult =>
  runArguments(['--rerun-candidates', reportPath, ...entries]);

// Every scope entry is `path:start-end`. A fixture mutant sits on line 1, so this range holds it.
export const ranged = (...paths: string[]): string[] => paths.map((path) => `${path}:1-9`);

// Builds a fileResult in the real mutation-testing-report-schema shape (a flat
// `mutants` array of `{ status, location }` objects) by EXPANDING a status -> count map,
// so these tests exercise the same shape Stryker's own json reporter writes,
// without committing a multi-hundred-KB report fixture.
export const fileResult = (counts: Record<string, number>) => ({
  mutants: Object.entries(counts)
    .flatMap(([status, count]) => Array.from({ length: count }, () => status))
    .map((status, position) => ({
      id: String(position),
      status,
      location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    })),
});

// One mutant of a real report, reduced to what the scorer reads: its id, status, and lines.
export type ShapedMutant = [identifier: string, status: string, start: number, end: number];

// A report built from mutants with the ids and lines a real run wrote, for the modes that name
// mutants (a status -> count map cannot place a mutant outside a range).
export const writeShapedReport = (
  directory: string,
  scope: string[],
  files: Record<string, ShapedMutant[]>,
): string => {
  const reportPath = join(directory, 'mutation.json');
  const reportBody = {
    config: { mutate: scope },
    files: Object.fromEntries(
      Object.entries(files).map(([path, mutants]) => [
        path,
        {
          mutants: mutants.map(([identifier, status, start, end]) => ({
            id: identifier,
            status,
            location: { start: { line: start, column: 1 }, end: { line: end, column: 2 } },
          })),
        },
      ]),
    ),
  };
  writeFileSync(reportPath, JSON.stringify(reportBody));

  return reportPath;
};

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
