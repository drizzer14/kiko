#!/usr/bin/env node

// Fails when a file under drizzle/migrations/ that already shipped is modified,
// deleted or renamed. A shipped migration has run on a user's device, so its
// bytes are history: the count-based runner (src/db/run-migrations.ts) skips
// every entry it has already applied, and an edit would never reach a device
// that applied it. New behavior goes in a NEW migration, never in an old one,
// not even as a comment.
//
// Usage: shipped-migrations.js <root> <base sha>...
//
// Each base sha is a commit that is already shipped (the wrapper passes the
// merge-bases with main and next). The protected set is the union of the files
// under drizzle/migrations/ at those commits. Each protected file is compared
// with the WORKING TREE, so an uncommitted edit, a committed edit and a write
// that skipped the pre-write guard are all caught.
//
//   - .sql, snapshots, and any other file type: byte-identical.
//   - meta/_journal.json: every top-level key but "entries" deep-equal, and the
//     new entries start with the base entries, each deep-equal, in order.
//     Appended entries are allowed (drizzle-kit appends one per migration).
//   - migrations.js: the base lines stay an in-order subsequence of the new
//     lines (drizzle-kit regenerates the file by insertion).
//   - *.test.ts: never protected, a test is not a shipped artifact.
//
// A file that is absent at every base (added on this branch) is free to change.
//
// Exit 0: clean. Exit 1: violations, one line each on stdout. Exit 2: the check
// could not run (bad usage, a git or parse failure), so the wrapper fails
// closed. The checker is dependency-free (node:* only): the guard-replay
// scratch checkout has no node_modules.

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { execFileSync } = require('node:child_process');

const MIGRATIONS_DIRECTORY = 'drizzle/migrations';
const JOURNAL_PATH = `${MIGRATIONS_DIRECTORY}/meta/_journal.json`;
const RUNNER_MAP_PATH = `${MIGRATIONS_DIRECTORY}/migrations.js`;
const TEST_FILE_PATTERN = /\.test\.ts$/;
const SHORT_SHA_LENGTH = 12;
const GIT_OUTPUT_LIMIT = 256 * 1024 * 1024;

function runGit(root, gitArguments) {
  return execFileSync('git', gitArguments, {
    cwd: root,
    maxBuffer: GIT_OUTPUT_LIMIT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function listBaseFiles(root, sha) {
  return runGit(root, ['ls-tree', '-r', '-z', '--name-only', sha, '--', MIGRATIONS_DIRECTORY])
    .toString('utf8')
    .split('\0')
    .filter((file) => file !== '');
}

function readBaseFile(root, sha, file) {
  return runGit(root, ['cat-file', 'blob', `${sha}:${file}`]);
}

function listWorkingFiles(root) {
  const files = [];
  const pending = [path.join(root, MIGRATIONS_DIRECTORY)];

  while (pending.length > 0) {
    const directory = pending.pop();

    if (!fs.existsSync(directory)) {
      continue;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  }

  return files;
}

function parseJournal(buffer, file) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeEntryChange(position, entry, change) {
  const tag = isPlainObject(entry) && typeof entry.tag === 'string' ? ` (${entry.tag})` : '';

  return `journal entry ${position} ${change}${tag}`;
}

function compareJournals(baseBuffer, workingBuffer) {
  const base = parseJournal(baseBuffer, `${JOURNAL_PATH} at the base`);
  const working = parseJournal(workingBuffer, JOURNAL_PATH);

  if (!isPlainObject(base) || !isPlainObject(working)) {
    return isDeepStrictEqual(base, working) ? [] : ['journal changed'];
  }

  const changes = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(working)]);

  for (const key of keys) {
    if (key !== 'entries' && !isDeepStrictEqual(base[key], working[key])) {
      changes.push(`journal top-level key "${key}" changed`);
    }
  }

  if (!Array.isArray(base.entries) || !Array.isArray(working.entries)) {
    return isDeepStrictEqual(base.entries, working.entries)
      ? changes
      : [...changes, 'journal "entries" changed'];
  }

  base.entries.forEach((entry, position) => {
    if (position >= working.entries.length) {
      changes.push(describeEntryChange(position, entry, 'removed'));
    } else if (!isDeepStrictEqual(entry, working.entries[position])) {
      changes.push(describeEntryChange(position, entry, 'changed'));
    }
  });

  return changes;
}

// The base lines must appear, in order, among the working lines. Matching each
// base line to its earliest remaining working line is exact for "is a
// subsequence", and any base line left unmatched was removed or changed.
function compareRunnerMaps(baseBuffer, workingBuffer) {
  const baseLines = baseBuffer.toString('utf8').split('\n');
  const workingLines = workingBuffer.toString('utf8').split('\n');
  const changes = [];
  let cursor = 0;

  baseLines.forEach((line, position) => {
    const found = workingLines.indexOf(line, cursor);

    if (found === -1) {
      changes.push(`migrations.js line removed or changed: line ${position + 1} "${line}"`);
    } else {
      cursor = found + 1;
    }
  });

  return changes;
}

function compareContent(file, baseBuffer, workingBuffer) {
  if (file === JOURNAL_PATH) {
    return compareJournals(baseBuffer, workingBuffer);
  }

  if (file === RUNNER_MAP_PATH) {
    return compareRunnerMaps(baseBuffer, workingBuffer);
  }

  return baseBuffer.equals(workingBuffer) ? [] : ['modified'];
}

function describeMissing(root, baseBuffer, addedFiles) {
  const renamedTo = addedFiles.find((added) =>
    baseBuffer.equals(fs.readFileSync(path.join(root, added))),
  );

  return renamedTo === undefined ? 'deleted' : `renamed to ${renamedTo}`;
}

function findViolationsAgainstBase(root, sha, workingFiles) {
  const baseFiles = listBaseFiles(root, sha).filter((file) => !TEST_FILE_PATTERN.test(file));
  const working = new Set(workingFiles);
  const shipped = new Set(baseFiles);
  const addedFiles = workingFiles.filter((file) => !shipped.has(file));
  const violations = [];

  for (const file of baseFiles.sort()) {
    const baseBuffer = readBaseFile(root, sha, file);
    const changes = working.has(file)
      ? compareContent(file, baseBuffer, fs.readFileSync(path.join(root, file)))
      : [describeMissing(root, baseBuffer, addedFiles)];

    const short = sha.slice(0, SHORT_SHA_LENGTH);

    for (const change of changes) {
      violations.push(
        `${file}: ${change} (base ${short}; restore: git show ${short}:${file} > ${file})`,
      );
    }
  }

  return violations;
}

function findViolations(root, shas) {
  const workingFiles = listWorkingFiles(root).filter((file) => !TEST_FILE_PATTERN.test(file));

  return [...new Set(shas)].flatMap((sha) => findViolationsAgainstBase(root, sha, workingFiles));
}

function runCli() {
  const [root, ...shas] = process.argv.slice(2);

  if (!root || shas.length === 0) {
    process.stderr.write('usage: shipped-migrations.js <root> <base sha>...\n');
    process.exit(2);
  }

  let violations;

  try {
    violations = findViolations(root, shas);
  } catch (error) {
    process.stderr.write(`shipped-migrations: could not check: ${error.message}\n`);
    process.exit(2);
  }

  for (const violation of violations) {
    process.stdout.write(`${violation}\n`);
  }

  process.exit(violations.length > 0 ? 1 : 0);
}

if (require.main === module) {
  runCli();
}

module.exports = { findViolations };
