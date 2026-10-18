#!/usr/bin/env node

// Scores a CHANGE SET from Stryker's JSON reporter output (stryker.conf.json's
// "json" reporter, default path reports/mutation/mutation.json), not the
// whole accumulated incremental report that Stryker's own "All files" row and
// break threshold cover.
//
// The score covers ONLY the `--mutate` entries `scripts/checks/mutation.sh` passed for THIS
// run (given here as argv, verbatim): `path:start-end` for the changed lines of a file (1-based,
// end inclusive, whole lines). A file's row grades only the mutants Stryker would have created for
// its entries: a mutant whose whole location lies inside one of its ranges (Stryker's own rule).
// That matters because Stryker's incremental mode keeps an old mutant outside the ranges in the
// report with its old status; grading it would score code this change set did not touch. The
// formula is the one Stryker's own "All files" row uses (mutation-testing-metrics'
// countFileMetrics):
//
//   score = (killed + timeout) / (killed + timeout + survived + noCoverage) * 100
//
// RuntimeError, CompileError, Ignored, and Pending mutants are excluded from
// both the numerator and the denominator, same as Stryker itself: they are a
// tooling/skip status, not a pass/fail signal on the code.
//
// Gate: FAIL when the report's own recorded scope (config.mutate) is not
// exactly the set of entries given here, when the change-set score is below
// CHANGE_SET_THRESHOLD, or when any single graded file is below PER_FILE_FLOOR, or when any
// graded file is TIMEOUT-HEAVY.
// The scope check proves the report belongs to this run, so a file with no
// entry in report.files is a file that has no mutants (Stryker writes only
// files that have some), which is nothing to grade, not a failure.
//
// TIMEOUT-HEAVY: a graded file whose Timeout mutants are more than TIMEOUT_HEAVY_SHARE percent
// of its detected ones (killed + timeout) and at least TIMEOUT_HEAVY_MINIMUM in number. The score
// formula still counts a Timeout as detected, but a widely imported file's mutants time out on
// jest's related-test load, not on behavior, so a file made mostly of them proves nothing about
// its tests. It fails the gate whatever the total and the floor say, and its line names the
// score without the timeouts. The verdict on a report never changes, but the gate does not stop at
// it: when TIMEOUT-HEAVY is the only failure, scripts/checks/mutation.sh reruns the timed-out
// mutants once under a quiet machine and scores the final report with this same rule. A hang
// normally times out again there and the file still fails, cleared by the manual method (see
// docs/harness/checks.md). A memory-filling hang can instead end RuntimeError (V8 runs out of
// memory before Stryker's timer; Stryker reports Error after its retries), which this scorer does
// not count; the rerun summary shows it as other.
//
// `--rerun-candidates <report.json> <mutate-entry>...` prints that rerun set instead of a score:
// one `path<TAB>mutant id` line for every Timeout mutant inside the graded ranges of each
// TIMEOUT-HEAVY file. It prints nothing (exit 0) when no file is heavy or when anything else
// fails too (a file below the floor, a total below the threshold, a scope mismatch), because a
// rerun would not make that gate pass.
//
// Exit 2 (usage) for an entry that is not `path:start-end` (a plain path would grade a whole file,
// which no run mutates), for a range that is empty or starts below line 1, and for a file with a
// report mutant that has no location (whether it is in range is unknowable, and guessing could
// pass a change set on mutants that are not its own).

const fs = require('node:fs');

const CHANGE_SET_THRESHOLD = 75;
const PER_FILE_FLOOR = 60;
const TIMEOUT_HEAVY_SHARE = 50;
const TIMEOUT_HEAVY_MINIMUM = 3;

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

const usageFailure = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const ENTRY = /^(.+):(\d+)-(\d+)$/;

// Groups the `--mutate` entries by path, in order of first appearance, each path holding its
// ranges.
const groupEntries = (entries) => {
  const groups = new Map();

  for (const entry of entries) {
    const match = ENTRY.exec(entry);

    if (match === null) {
      usageFailure(`every entry is path:start-end, got: ${entry}`);
    }

    const [start, end] = [Number(match[2]), Number(match[3])];

    if (start < 1 || start > end) {
      usageFailure(`malformed range entry (want 1 <= start <= end): ${entry}`);
    }

    const group = groups.get(match[1]) ?? { ranges: [] };
    groups.set(match[1], group);
    group.ranges.push([start, end]);
  }

  return groups;
};

// Stryker's own rule: a mutant exists only when its whole location lies inside a range. The
// ranges are whole lines, so the lines decide.
const gradedMutants = (path, group, fileResult) => {
  const mutants = fileResult.mutants ?? [];

  return mutants.filter((mutant) => {
    const start = mutant.location?.start?.line;
    const end = mutant.location?.end?.line;

    if (start === undefined || end === undefined) {
      usageFailure(`report mutant has no location: ${path}`);
    }

    return group.ranges.some(([from, to]) => start >= from && end <= to);
  });
};

const tallyFile = (mutants) => {
  const counts = emptyCounts();

  for (const mutant of mutants) {
    const field = STATUS_FIELDS.get(mutant.status);

    if (field !== undefined) {
      counts[field] += 1;
    }
  }

  return withScore(counts);
};

const rowFor = (path, group, report) => {
  if (EXCLUDED_FILES.has(path)) {
    return { path, kind: 'excluded', reason: EXCLUDED_FILES.get(path) };
  }

  const fileResult = report.files?.[path];

  if (fileResult === undefined) {
    return { path, kind: 'unmutated' };
  }

  const tally = tallyFile(gradedMutants(path, group, fileResult));

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

// The share compares integers (timeout * 100 > share * detected), so a boundary file such as
// killed 3, timeout 3 is exactly 50 percent and never rounds either way.
const isTimeoutHeavy = (row) =>
  row.kind === 'graded' &&
  row.timeout >= TIMEOUT_HEAVY_MINIMUM &&
  row.timeout * 100 > TIMEOUT_HEAVY_SHARE * (row.killed + row.timeout);

const formatTimeoutHeavy = (row) => {
  const detected = row.killed + row.timeout;
  const graded = detected + row.survived + row.noCoverage;
  const share = ((row.timeout / detected) * 100).toFixed(1);
  const withoutTimeouts = ((row.killed / graded) * 100).toFixed(2);

  return `TIMEOUT-HEAVY ${row.path}: timeout ${row.timeout} of ${detected} detected (${share} %), killed ${row.killed}, score without timeouts ${withoutTimeouts} < ${PER_FILE_FLOOR}`;
};

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
  const gateLine = `GATE: change set >= ${CHANGE_SET_THRESHOLD}, each file >= ${PER_FILE_FLOOR}, a file fails TIMEOUT-HEAVY when timeout > ${TIMEOUT_HEAVY_SHARE}% of detected and >= ${TIMEOUT_HEAVY_MINIMUM}`;

  return [
    ...lines,
    totalLine,
    gateLine,
    ...rows.filter(isTimeoutHeavy).map(formatTimeoutHeavy),
  ].join('\n');
};

// The scope Stryker recorded for its own run, compared with the entries given here as sets of
// strings (so the order never matters): the report belongs to this run only when they are equal.
const scopeMismatch = (report, entries) => {
  const recorded = new Set(report.config?.mutate ?? []);
  const expected = new Set(entries);

  return [
    ...[...expected]
      .filter((entry) => !recorded.has(entry))
      .map((entry) => `  changed but not in the report's scope: ${entry}`),
    ...[...recorded]
      .filter((entry) => !expected.has(entry))
      .map((entry) => `  in the report's scope but not changed: ${entry}`),
  ];
};

const gradeFailures = (rows, total) => ({
  belowFloor: rows.some((row) => row.kind === 'graded' && row.score < PER_FILE_FLOOR),
  belowThreshold: total.score !== null && total.score < CHANGE_SET_THRESHOLD,
  timeoutHeavy: rows.some(isTimeoutHeavy),
});

const gradeRows = (groups, report) =>
  [...groups].map(([path, group]) => rowFor(path, group, report));

const scoreChangeSet = (report, entries) => {
  const groups = groupEntries(entries);
  const mismatch = scopeMismatch(report, entries);

  if (mismatch.length > 0) {
    return {
      passed: false,
      rendered: [
        'REPORT SCOPE MISMATCH: the report does not belong to this run (its recorded config.mutate differs from the changed files).',
        ...mismatch,
      ].join('\n'),
    };
  }

  const rows = gradeRows(groups, report);
  const total = aggregate(rows);
  const { belowFloor, belowThreshold, timeoutHeavy } = gradeFailures(rows, total);

  return {
    passed: !belowFloor && !belowThreshold && !timeoutHeavy,
    rendered: renderReport(rows, total),
  };
};

// Only a gate that TIMEOUT-HEAVY alone fails has a rerun set: any other failure stays failed
// after a rerun, so listing candidates for it would spend a Stryker run on a verdict that cannot
// change.
const rerunCandidates = (report, entries) => {
  const groups = groupEntries(entries);

  if (scopeMismatch(report, entries).length > 0) {
    return [];
  }

  const rows = gradeRows(groups, report);
  const { belowFloor, belowThreshold, timeoutHeavy } = gradeFailures(rows, aggregate(rows));

  if (belowFloor || belowThreshold || !timeoutHeavy) {
    return [];
  }

  return rows.filter(isTimeoutHeavy).flatMap((row) =>
    gradedMutants(row.path, groups.get(row.path), report.files[row.path])
      .filter((mutant) => mutant.status === 'Timeout')
      .map((mutant) => {
        if (mutant.id === undefined) {
          usageFailure(`report mutant has no id: ${row.path}`);
        }

        return `${row.path}\t${mutant.id}`;
      }),
  );
};

const RERUN_FLAG = '--rerun-candidates';
const RERUN_USAGE = `usage: mutation-score.js ${RERUN_FLAG} <report.json> <mutate-entry>...`;

const readReport = (reportPath) => {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    process.stderr.write(`could not read or parse ${reportPath}: ${error.message}\n`);
    process.exit(2);
  }
};

const [firstArgument, ...otherArguments] = process.argv.slice(2);

if (firstArgument === RERUN_FLAG) {
  const [rerunReportPath, ...rerunEntries] = otherArguments;

  if (!rerunReportPath || rerunEntries.length === 0) {
    usageFailure(RERUN_USAGE);
  }

  const lines = rerunCandidates(readReport(rerunReportPath), rerunEntries);

  process.stdout.write(lines.map((line) => `${line}\n`).join(''));
  process.exit(0);
}

const [reportPath, mutateEntries] = [firstArgument, otherArguments];

if (!reportPath) {
  process.stderr.write('usage: mutation-score.js <report.json> <mutate-entry>...\n');
  process.exit(2);
}

const report = readReport(reportPath);

if (mutateEntries.length === 0) {
  process.stdout.write('CHANGE SET TOTAL: n/a (no changed files given)\n');
  process.exit(0);
}

const { passed, rendered } = scoreChangeSet(report, mutateEntries);

process.stdout.write(`${rendered}\n`);
process.exit(passed ? 0 : 1);
