#!/usr/bin/env node

// Scores a CHANGE SET — not the whole accumulated incremental report — from
// Stryker's JSON reporter output (stryker.conf.json's "json" reporter, default
// path reports/mutation/mutation.json).
//
// Stryker's own incremental mode accumulates mutant results across EVERY file
// it has ever mutated (reused + fresh): its "All files" row, and its own break
// threshold, cover that whole accumulated report (191 files, ~13k mutants), so
// a small reviewed change set barely moves it — every run in one window
// printed 80.6-81.6 regardless of what the change set itself looked like.
// This computes the score over ONLY the files `scripts/checks/mutation.sh`
// passed to `--mutate` for THIS run (the same changed-file list it already
// derives from KIKO_MUTATION_BASE), using the identical formula Stryker's own
// "All files" row uses (mutation-testing-metrics' countFileMetrics):
//
//   score = (killed + timeout) / (killed + timeout + survived + noCoverage) * 100
//
// RuntimeError, CompileError, Ignored, and Pending mutants are excluded from
// both the numerator and the denominator, same as Stryker itself — they are
// not a pass/fail signal on the code, they are a tooling/skip status.
//
// Gate: FAIL when the change-set score < CHANGE_SET_THRESHOLD, OR any single
// graded change-set file < PER_FILE_FLOOR, OR a changed file is missing from
// the report entirely (and not on the exclusion allowlist below) — a missing
// file means the report cannot vouch for it, which must never read as a pass.

const fs = require('node:fs');

const CHANGE_SET_THRESHOLD = 75;
const PER_FILE_FLOOR = 60;

// Declaration-only files: Stryker instruments them (there is runtime-reachable
// syntax for its mutators to touch), but every mutant there flips a type,
// column, or structural declaration literal with no behavioral branch a test
// could kill with a real assertion. A surviving mutant there reflects an
// absent GRADING TARGET, not a missing test, so these are excluded from both
// the change-set score and the per-file floor. This is the ONE allowlist in
// this script — do not add an entry without a concrete, verifiable reason,
// and mirror it in docs/harness/documented-exceptions.md (same standing rule
// as every other suppression in this repo; see CLAUDE.md's "Override
// protocol"). Keyed by the exact path mutation.sh passes (repo-root-relative,
// forward slashes).
const EXCLUDED_FILES = new Map([
  [
    'src/db/schema.ts',
    'Drizzle table/column declarations: every mutant flips a column type, default, or constraint literal with no runtime branch a test could kill.',
  ],
]);

// Prefix form for a directory of generated, structural snapshots rather than
// hand-written logic. Empty today (drizzle/migrations/meta/ does not exist
// yet in this project), kept so a future generated-snapshot directory under
// drizzle/migrations is excluded the moment it starts being mutated, rather
// than silently failing the floor the day it first appears.
const EXCLUDED_PREFIXES = [
  {
    prefix: 'drizzle/migrations/meta/',
    reason:
      'Generated Drizzle migration snapshots (structural JSON describing a prior schema state), not hand-written logic.',
  },
];

const exclusionReason = (path) => {
  const exact = EXCLUDED_FILES.get(path);

  if (exact !== undefined) {
    return exact;
  }

  return EXCLUDED_PREFIXES.find(({ prefix }) => path.startsWith(prefix))?.reason;
};

// Pure per-file status tally, restricted to the four statuses that count
// toward a mutation score (see the header formula). A file with zero graded
// mutants (every mutant Ignored/a tooling error, or the mutants array empty)
// has no score to compute — `score` is null, meaning "ungraded", not zero.
const tallyFile = (fileResult) => {
  const counts = { killed: 0, timeout: 0, survived: 0, noCoverage: 0 };

  for (const mutant of fileResult?.mutants ?? []) {
    if (mutant.status === 'Killed') counts.killed += 1;
    else if (mutant.status === 'Timeout') counts.timeout += 1;
    else if (mutant.status === 'Survived') counts.survived += 1;
    else if (mutant.status === 'NoCoverage') counts.noCoverage += 1;
  }

  const detected = counts.killed + counts.timeout;
  const total = detected + counts.survived + counts.noCoverage;
  const score = total > 0 ? (detected / total) * 100 : null;

  return { ...counts, score };
};

// One row per changed file: "excluded" (allowlisted, never graded), "missing"
// (not in the report and not allowlisted — a hard failure), or a tally
// ("ungraded" when it has no graded mutants, otherwise scored).
const rowFor = (path, report) => {
  const reason = exclusionReason(path);

  if (reason !== undefined) {
    return { path, kind: 'excluded', reason };
  }

  const fileResult = report.files?.[path];

  if (fileResult === undefined) {
    return { path, kind: 'missing' };
  }

  const tally = tallyFile(fileResult);

  return { path, kind: tally.score === null ? 'ungraded' : 'graded', ...tally };
};

// Aggregate across only the GRADED rows: an excluded, missing, or ungraded row
// contributes nothing (0/0), the same no-op the old whole-report aggregate
// already relied on for a zero-mutant file.
const aggregate = (rows) => {
  const graded = rows.filter((row) => row.kind === 'graded');
  const totals = graded.reduce(
    (accumulator, row) => ({
      killed: accumulator.killed + row.killed,
      timeout: accumulator.timeout + row.timeout,
      survived: accumulator.survived + row.survived,
      noCoverage: accumulator.noCoverage + row.noCoverage,
    }),
    { killed: 0, timeout: 0, survived: 0, noCoverage: 0 },
  );
  const detected = totals.killed + totals.timeout;
  const total = detected + totals.survived + totals.noCoverage;
  const score = total > 0 ? (detected / total) * 100 : null;

  return { ...totals, score };
};

// The change set fails when a changed file could not be vouched for at all
// (missing from the report), when any graded file falls below the per-file
// floor, or when the change set's own aggregate falls below its threshold. An
// all-excluded or all-ungraded change set (score null) never fails on score —
// there is nothing to grade — but a MISSING file still fails it regardless.
const evaluate = (rows, total) => {
  const missing = rows.filter((row) => row.kind === 'missing');
  const belowFloor = rows.filter((row) => row.kind === 'graded' && row.score < PER_FILE_FLOOR);
  const belowThreshold = total.score !== null && total.score < CHANGE_SET_THRESHOLD;

  return {
    passed: missing.length === 0 && belowFloor.length === 0 && !belowThreshold,
    missing,
    belowFloor,
    belowThreshold,
  };
};

const formatScore = (row) => {
  if (row.kind === 'excluded') return `excluded (${row.reason})`;
  if (row.kind === 'missing') return 'MISSING FROM REPORT';
  if (row.kind === 'ungraded') return 'n/a (no graded mutants)';

  return `${row.score.toFixed(2)}`;
};

const formatCounts = (row) =>
  row.kind === 'graded' || row.kind === 'ungraded'
    ? `killed=${row.killed} timeout=${row.timeout} survived=${row.survived} noCoverage=${row.noCoverage}`
    : '';

// Renders the per-file table plus the change-set total, on BOTH a pass and a
// fail, so a human sees the full picture either way.
const renderReport = (rows, total) => {
  const lines = rows.map((row) =>
    `${row.path}: ${formatScore(row)} ${formatCounts(row)}`.trimEnd(),
  );
  const totalLine =
    total.score === null
      ? 'CHANGE SET TOTAL: n/a (no graded mutants)'
      : `CHANGE SET TOTAL: ${total.score.toFixed(2)} killed=${total.killed} timeout=${total.timeout} survived=${total.survived} noCoverage=${total.noCoverage}`;

  return [...lines, totalLine].join('\n');
};

const scoreChangeSet = (report, changedFiles) => {
  const rows = changedFiles.map((path) => rowFor(path, report));
  const total = aggregate(rows);
  const result = evaluate(rows, total);

  return { rows, total, ...result, report: renderReport(rows, total) };
};

function runCli() {
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

  const { passed, report: rendered } = scoreChangeSet(report, changedFiles);

  process.stdout.write(`${rendered}\n`);
  process.exit(passed ? 0 : 1);
}

if (require.main === module) {
  runCli();
}

module.exports = {
  CHANGE_SET_THRESHOLD,
  PER_FILE_FLOOR,
  EXCLUDED_FILES,
  EXCLUDED_PREFIXES,
  tallyFile,
  rowFor,
  aggregate,
  evaluate,
  scoreChangeSet,
};
