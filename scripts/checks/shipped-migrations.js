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
// merge-bases with main and next, main first). The protected set is the union
// of the files under drizzle/migrations/ at those commits. Each protected file
// is compared with the WORKING TREE, so an uncommitted edit, a committed edit
// and a write that skipped the pre-write guard are all caught.
//
//   - .sql, snapshots, and any other file type: byte-identical.
//   - meta/_journal.json: every top-level key but "entries" deep-equal, and the
//     new entries start with the base entries, each deep-equal, in order.
//     Appended entries are allowed (drizzle-kit appends one per migration).
//   - migrations.js: the base lines stay an in-order subsequence of the new
//     lines (drizzle-kit regenerates the file by insertion). An inserted line
//     can still change what a shipped entry means (a duplicate key, a block
//     comment around shipped lines); the check proves only that no base line
//     was removed or changed.
//   - *.test.ts: never protected, a test is not a shipped artifact.
//
// The EARLIEST base that has a file decides it (bases are in the order given,
// main's first). A later base (next's) decides only a file the earlier ones do
// not have, and, for the journal and migrations.js, only when it extends the
// earlier base's content: then it also holds, and being stricter it protects
// what next appended. When it does not extend it (next edited something main
// shipped), the earlier base alone decides, so a branch cut from next can
// restore main's content and pass instead of failing one base or the other.
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
    .filter((file) => file !== '' && !TEST_FILE_PATTERN.test(file));
}

function readBaseFile(root, sha, file) {
  return runGit(root, ['cat-file', 'blob', `${sha}:${file}`]);
}

function listWorkingFiles(root) {
  const directory = path.join(root, MIGRATIONS_DIRECTORY);

  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => !TEST_FILE_PATTERN.test(file));
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJournal(buffer, file) {
  let journal;

  try {
    journal = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }

  if (!isPlainObject(journal) || !Array.isArray(journal.entries)) {
    throw new Error(`${file} is not a journal object with an entries array`);
  }

  return journal;
}

function describeEntryChange(position, entry, change) {
  const tag = isPlainObject(entry) && typeof entry.tag === 'string' ? ` (${entry.tag})` : '';

  return `journal entry ${position} ${change}${tag}`;
}

// A change is { change, restore }. A change without `restore` is a whole-file
// change, restored from the base with `git show`.
function compareJournals(baseBuffer, workingBuffer) {
  const base = parseJournal(baseBuffer, `${JOURNAL_PATH} at the base`);
  const working = parseJournal(workingBuffer, JOURNAL_PATH);
  const changes = [];

  for (const key of new Set([...Object.keys(base), ...Object.keys(working)])) {
    if (key !== 'entries' && !isDeepStrictEqual(base[key], working[key])) {
      changes.push({
        change: `journal top-level key "${key}" changed`,
        restore:
          base[key] === undefined
            ? `remove the key "${key}" and keep the appended entries`
            : `restore the key "${key}" to its base value ${JSON.stringify(base[key])} and keep the appended entries`,
      });
    }
  }

  base.entries.forEach((entry, position) => {
    if (position >= working.entries.length) {
      changes.push({
        change: describeEntryChange(position, entry, 'removed'),
        restore: `put this entry back as ${JSON.stringify(entry)}, and keep the appended entries`,
      });
    } else if (!isDeepStrictEqual(entry, working.entries[position])) {
      changes.push({
        change: describeEntryChange(position, entry, 'changed'),
        restore: `restore this entry to its base content ${JSON.stringify(entry)} and keep the appended entries`,
      });
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
      changes.push({
        change: `migrations.js line removed or changed: line ${position + 1} "${line}"`,
        restore: `restore this line to its base text "${line}" and keep the inserted lines`,
      });
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

  return baseBuffer.equals(workingBuffer) ? [] : [{ change: 'modified' }];
}

function decidingBases(file, holders) {
  const [earliest, ...later] = holders;

  if (file !== JOURNAL_PATH && file !== RUNNER_MAP_PATH) {
    return [earliest];
  }

  const deciding = [earliest];

  for (const holder of later) {
    const drift = compareContent(file, deciding[deciding.length - 1].buffer, holder.buffer);

    if (drift.length === 0) {
      deciding.push(holder);
    }
  }

  return deciding;
}

function describeMissing(root, baseBuffer, addedFiles) {
  const renamedTo = addedFiles.find((added) =>
    baseBuffer.equals(fs.readFileSync(path.join(root, added))),
  );

  return renamedTo === undefined ? 'deleted' : `renamed to ${renamedTo}`;
}

function formatViolation(file, sha, { change, restore }) {
  const short = sha.slice(0, SHORT_SHA_LENGTH);

  return `${file}: ${change} (base ${short}; ${restore ?? `restore: git show ${short}:${file} > ${file}`})`;
}

function findFileViolations(root, file, holders, working, addedFiles) {
  const decisive = decidingBases(
    file,
    holders.map((holder) => ({ sha: holder.sha, buffer: readBaseFile(root, holder.sha, file) })),
  );

  if (!working.has(file)) {
    const [earliest] = decisive;

    return [
      formatViolation(file, earliest.sha, {
        change: describeMissing(root, earliest.buffer, addedFiles),
      }),
    ];
  }

  const workingBuffer = fs.readFileSync(path.join(root, file));

  return decisive.flatMap((base) =>
    compareContent(file, base.buffer, workingBuffer).map((change) =>
      formatViolation(file, base.sha, change),
    ),
  );
}

function findViolations(root, shas) {
  const workingFiles = listWorkingFiles(root);
  const working = new Set(workingFiles);
  const bases = [...new Set(shas)].map((sha) => ({ sha, files: listBaseFiles(root, sha) }));
  const shipped = new Set(bases.flatMap((base) => base.files));
  const addedFiles = workingFiles.filter((file) => !shipped.has(file));

  return [...shipped].sort().flatMap((file) =>
    findFileViolations(
      root,
      file,
      bases.filter((base) => base.files.includes(file)),
      working,
      addedFiles,
    ),
  );
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
