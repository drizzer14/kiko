#!/usr/bin/env node

// Checks the closure table a round or a task writes at its end: one row per finding id, each
// row citing the commit that fixed it and the test that pins the fix. A closure list that copies
// a task title's range ("STAT-N1..N5") closes an id no commit touched, so the table is checked
// by machine instead of by a reader's trust.
//
// Usage: closure-table.js <table.md>   (run from the repository root)
//
// The table has these columns, in this order, under this header row (case is ignored):
//
//   | Id | Status | Fix sha | Pinning test file:line | Fails on pre-fix source |
//
//   Id          ONE finding id: letter-only words joined by hyphens, then letters and digits
//               ending in a number and at most one lowercase letter (CS1, STAT-N4, SEC-C1,
//               TX-C6a, 12). A range ("STAT-N1..N5",
//               "N1-N5") or a list ("A, B", "A/B") is not one id; expand it to one row per id.
//   Status      OPEN, CLOSED, or CLOSED-UNPROVEN.
//   Fix sha     A commit that resolves in this repository and is an ancestor of HEAD.
//   Pinning     path:line of a test in the working tree: the file exists and has that many
//   test        lines.
//   Fails on    "yes" plus how the test was shown to fail on the pre-fix source (a scratch copy
//   pre-fix     with the fix reverted, or a named mutant). Anything else is not proven.
//
// A CLOSED or CLOSED-UNPROVEN row needs a fix sha and a pinning test; a CLOSED row also needs a
// last cell that starts with "yes". An OPEN row may leave those cells empty (or "-"), but a sha
// or a test it does fill in is checked like any other. An id may appear in one row only.
//
// Exit 0: clean. Exit 1: findings, one line each on stdout. Exit 2: the check could not run
// (bad usage, an unreadable table, a git failure), so the wrapper fails closed. The checker is
// dependency-free (node:* only): the guard-replay scratch checkout has no node_modules.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const COLUMNS = ['id', 'status', 'fix sha', 'pinning test file:line', 'fails on pre-fix source'];
const STATUSES = ['OPEN', 'CLOSED', 'CLOSED-UNPROVEN'];
const ID_PATTERN = /^(?:[A-Za-z]+-)*[A-Za-z]*\d+[a-z]?$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const TEST_REFERENCE_PATTERN = /^([^:\s]+):(\d+)$/;
const EMPTY_CELL_PATTERN = /^(?:-|—|–|n\/a|none)?$/i;
const SEPARATOR_ROW_PATTERN = /^[\s|:-]+$/;
const PROVEN_PATTERN = /^yes\b/i;

function cleanCell(cell) {
  return cell.replace(/\\\|/g, '|').replace(/[`*]/g, '').trim();
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cleanCell);
}

function isHeader(cells) {
  return cells.map((cell) => cell.toLowerCase()).join('|') === COLUMNS.join('|');
}

function isSeparator(line) {
  return SEPARATOR_ROW_PATTERN.test(line.trim()) && line.includes('-');
}

function runGit(gitArguments) {
  const result = spawnSync('git', gitArguments, { encoding: 'utf8' });

  if (result.error !== undefined || result.status === null) {
    throw new Error(`git ${gitArguments.join(' ')} could not run`);
  }

  return result;
}

function resolveCommit(sha) {
  const result = runGit(['rev-parse', '-q', '--verify', `${sha}^{commit}`]);

  return result.status === 0 ? result.stdout.trim() : '';
}

function shaProblem(sha) {
  if (!SHA_PATTERN.test(sha)) {
    return `fix sha '${sha}' is not a 7 to 40 digit hex commit id`;
  }

  const commit = resolveCommit(sha);

  if (commit === '') {
    return `fix sha ${sha} does not resolve to a commit in this repository`;
  }

  const ancestry = runGit(['merge-base', '--is-ancestor', commit, 'HEAD']);

  if (ancestry.status === 0) {
    return '';
  }

  return ancestry.status === 1
    ? `fix sha ${sha} is not an ancestor of HEAD`
    : `fix sha ${sha} could not be checked against HEAD: ${ancestry.stderr.trim()}`;
}

function lineCountOf(text) {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
}

function testReferenceProblem(reference) {
  const match = TEST_REFERENCE_PATTERN.exec(reference);

  if (match === null) {
    return `pinning test '${reference}' is not path:line`;
  }

  const [, file, lineText] = match;
  const line = Number(lineText);
  const root = process.cwd();
  const absolute = path.resolve(root, file);

  if (path.isAbsolute(file) || path.relative(root, absolute).startsWith('..')) {
    return `pinning test '${reference}' is outside the repository`;
  }

  let text;

  try {
    text = fs.readFileSync(absolute, 'utf8');
  } catch {
    return `pinning test ${file} is not a file in the tree`;
  }

  if (line < 1 || line > lineCountOf(text)) {
    return `pinning test ${reference} is past the end of the file (${lineCountOf(text)} lines)`;
  }

  return '';
}

// The problems of one row, as messages without the location prefix.
function rowProblems(cells, seenIds) {
  const [id, statusCell, sha, testReference, proof] = cells;
  const problems = [];
  const status = statusCell.toUpperCase();

  if (!ID_PATTERN.test(id)) {
    problems.push(`id '${id}' is not one id (a range or a list?); write one row per id`);
  } else if (seenIds.has(id)) {
    problems.push(`id ${id} appears twice (first at line ${seenIds.get(id)})`);
  }

  if (!STATUSES.includes(status)) {
    problems.push(`status '${statusCell}' is not one of ${STATUSES.join(', ')}`);
  }

  const closed = status === 'CLOSED' || status === 'CLOSED-UNPROVEN';

  if (closed && EMPTY_CELL_PATTERN.test(sha)) {
    problems.push(`${status} row has no fix sha`);
  }

  if (closed && EMPTY_CELL_PATTERN.test(testReference)) {
    problems.push(`${status} row has no pinning test`);
  }

  if (status === 'CLOSED' && !PROVEN_PATTERN.test(proof)) {
    problems.push(
      'CLOSED row does not say "yes" under "Fails on pre-fix source" (CLOSED-UNPROVEN?)',
    );
  }

  const referenceProblems = [
    EMPTY_CELL_PATTERN.test(sha) ? '' : shaProblem(sha),
    EMPTY_CELL_PATTERN.test(testReference) ? '' : testReferenceProblem(testReference),
  ];

  return [...problems, ...referenceProblems.filter((problem) => problem !== '')];
}

function checkTable(text, tablePath) {
  const findings = [];
  const seenIds = new Map();
  let inTable = false;
  let rows = 0;

  text.split('\n').forEach((line, index) => {
    const lineNumber = index + 1;

    if (!line.trim().startsWith('|')) {
      inTable = false;

      return;
    }

    const cells = splitRow(line);

    if (isHeader(cells)) {
      inTable = true;

      return;
    }

    if (!inTable || isSeparator(line)) {
      return;
    }

    rows += 1;

    const problems =
      cells.length === COLUMNS.length
        ? rowProblems(cells, seenIds)
        : [`row has ${cells.length} cells, expected ${COLUMNS.length}`];

    for (const problem of problems) {
      findings.push(`${tablePath}:${lineNumber}: ${problem}`);
    }

    if (!seenIds.has(cells[0])) {
      seenIds.set(cells[0], lineNumber);
    }
  });

  if (rows === 0) {
    findings.push(
      `${tablePath}: no closure table rows under the header | ${COLUMNS.join(' | ')} |`,
    );
  }

  return findings;
}

function main() {
  const tablePath = process.argv[2];

  if (tablePath === undefined || process.argv.length > 3) {
    process.stderr.write('usage: closure-table.js <table.md>\n');

    return 2;
  }

  let text;

  try {
    text = fs.readFileSync(tablePath, 'utf8');
  } catch (error) {
    process.stderr.write(`cannot read ${tablePath}: ${error.message}\n`);

    return 2;
  }

  try {
    const findings = checkTable(text, tablePath);

    for (const finding of findings) {
      process.stdout.write(`${finding}\n`);
    }

    return findings.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);

    return 2;
  }
}

process.exitCode = main();
