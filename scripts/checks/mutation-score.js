#!/usr/bin/env node

// Scores a CHANGE SET from Stryker's JSON reporter output (stryker.conf.json's
// "json" reporter, default path reports/mutation/mutation.json), not the
// whole accumulated incremental report that Stryker's own "All files" row and
// break threshold cover.
//
// The score covers ONLY the files `scripts/checks/mutation.sh` passed to
// `--mutate` for THIS run, using the formula Stryker's own "All files" row uses
// (mutation-testing-metrics' countFileMetrics):
//
//   score = (killed + timeout) / (killed + timeout + survived + noCoverage) * 100
//
// RuntimeError, CompileError, Ignored, and Pending mutants are excluded from
// both the numerator and the denominator, same as Stryker itself: they are a
// tooling/skip status, not a pass/fail signal on the code.
//
// Gate: FAIL when the report's own recorded scope (config.mutate) is not
// exactly the changed-file list given here, when the change-set score is below
// CHANGE_SET_THRESHOLD, or when any single graded file is below PER_FILE_FLOOR.
// The scope check proves the report belongs to this run, so a file with no
// entry in report.files is a file that has no mutants (Stryker writes only
// files that have some), which is nothing to grade, not a failure.

const fs = require('node:fs');

const CHANGE_SET_THRESHOLD = 75;
const PER_FILE_FLOOR = 60;

// Declaration-only files: Stryker instruments them, but the mutants there flip
// declaration literals (column names, types, defaults) that ARE the file's
// content rather than logic a test could pin with a real assertion. They are
// excluded from both the change-set score and the per-file floor. This is the
// ONE allowlist in this script — do not add an entry without a concrete,
// verifiable reason, and mirror it in docs/harness/documented-exceptions.md
// (same standing rule as every other suppression in this repo; see CLAUDE.md's
// "Override protocol"). Keyed by the exact path mutation.sh passes
// (repo-root-relative, forward slashes).
const EXCLUDED_FILES = new Map([
  [
    'src/db/schema.ts',
    'Drizzle declaration file: its string-literal mutants (column names) are the schema itself, not logic.',
  ],
]);

const STATUS_FIELDS = new Map([
  ['Killed', 'killed'],
  ['Timeout', 'timeout'],
  ['Survived', 'survived'],
  ['NoCoverage', 'noCoverage'],
]);

const emptyCounts = () => ({ killed: 0, timeout: 0, survived: 0, noCoverage: 0 });

// The one score function, shared by a single file and the change set. A tally
// with no graded mutants has no score: `null` means "ungraded", not zero.
const withScore = (counts) => {
  const detected = counts.killed + counts.timeout;
  const total = detected + counts.survived + counts.noCoverage;

  return { ...counts, score: total > 0 ? (detected / total) * 100 : null };
};

const tallyFile = (fileResult) => {
  const counts = emptyCounts();

  for (const mutant of fileResult.mutants ?? []) {
    const field = STATUS_FIELDS.get(mutant.status);

    if (field !== undefined) {
      counts[field] += 1;
    }
  }

  return withScore(counts);
};

const rowFor = (path, report) => {
  if (EXCLUDED_FILES.has(path)) {
    return { path, kind: 'excluded', reason: EXCLUDED_FILES.get(path) };
  }

  const fileResult = report.files?.[path];

  if (fileResult === undefined) {
    return { path, kind: 'unmutated' };
  }

  const tally = tallyFile(fileResult);

  return { path, kind: tally.score === null ? 'ungraded' : 'graded', ...tally };
};

// Only graded rows contribute; an excluded, unmutated, or ungraded row adds
// nothing to the change-set score.
const aggregate = (rows) =>
  withScore(
    rows
      .filter((row) => row.kind === 'graded')
      .reduce((totals, row) => {
        for (const field of STATUS_FIELDS.values()) {
          totals[field] += row[field];
        }

        return totals;
      }, emptyCounts()),
  );

const formatScore = (row) => {
  if (row.kind === 'excluded') return `excluded (${row.reason})`;
  if (row.kind === 'unmutated') return 'n/a (no mutants)';
  if (row.kind === 'ungraded') return 'n/a (no graded mutants)';

  return row.score.toFixed(2);
};

const formatCounts = (row) =>
  row.kind === 'graded' || row.kind === 'ungraded'
    ? `killed=${row.killed} timeout=${row.timeout} survived=${row.survived} noCoverage=${row.noCoverage}`
    : '';

// Renders the per-file table, the change-set total, and the thresholds, on
// BOTH a pass and a fail, so a human sees the full picture either way.
const renderReport = (rows, total) => {
  const lines = rows.map((row) =>
    `${row.path}: ${formatScore(row)} ${formatCounts(row)}`.trimEnd(),
  );
  const totalLine =
    total.score === null
      ? 'CHANGE SET TOTAL: n/a (no graded mutants)'
      : `CHANGE SET TOTAL: ${total.score.toFixed(2)} killed=${total.killed} timeout=${total.timeout} survived=${total.survived} noCoverage=${total.noCoverage}`;
  const gateLine = `GATE: change set >= ${CHANGE_SET_THRESHOLD}, each file >= ${PER_FILE_FLOOR}`;

  return [...lines, totalLine, gateLine].join('\n');
};

// The scope Stryker recorded for its own run, compared with the changed-file
// list as sets: the report belongs to this run only when they are equal.
const scopeMismatch = (report, changedFiles) => {
  const recorded = new Set(report.config?.mutate ?? []);
  const expected = new Set(changedFiles);

  return [
    ...changedFiles
      .filter((path) => !recorded.has(path))
      .map((path) => `  changed but not in the report's scope: ${path}`),
    ...[...recorded]
      .filter((path) => !expected.has(path))
      .map((path) => `  in the report's scope but not changed: ${path}`),
  ];
};

const scoreChangeSet = (report, changedFiles) => {
  const mismatch = scopeMismatch(report, changedFiles);

  if (mismatch.length > 0) {
    return {
      passed: false,
      rendered: [
        'REPORT SCOPE MISMATCH: the report does not belong to this run (its recorded config.mutate differs from the changed files).',
        ...mismatch,
      ].join('\n'),
    };
  }

  const rows = changedFiles.map((path) => rowFor(path, report));
  const total = aggregate(rows);
  const belowFloor = rows.some((row) => row.kind === 'graded' && row.score < PER_FILE_FLOOR);
  const belowThreshold = total.score !== null && total.score < CHANGE_SET_THRESHOLD;

  return { passed: !belowFloor && !belowThreshold, rendered: renderReport(rows, total) };
};

const [reportPath, ...changedFiles] = process.argv.slice(2);

if (!reportPath) {
  process.stderr.write('usage: mutation-score.js <report.json> <changed-file>...\n');
  process.exit(2);
}

let report;

try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  process.stderr.write(`could not read or parse ${reportPath}: ${error.message}\n`);
  process.exit(2);
}

if (changedFiles.length === 0) {
  process.stdout.write('CHANGE SET TOTAL: n/a (no changed files given)\n');
  process.exit(0);
}

const { passed, rendered } = scoreChangeSet(report, changedFiles);

process.stdout.write(`${rendered}\n`);
process.exit(passed ? 0 : 1);
