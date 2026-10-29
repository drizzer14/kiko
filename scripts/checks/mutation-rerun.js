#!/usr/bin/env node

// Prepares the rerun of a gate's timed-out mutants for scripts/checks/mutation.sh.
//
//   usage: mutation-score.js --rerun-candidates ... | mutation-rerun.js <stryker-incremental.json>
//
// Stryker's incremental mode reuses a Timeout result, so a plain second run would reproduce it.
// Stryker runs again only the mutants that are missing from reports/stryker-incremental.json
// (`files[path].mutants`), and reuses every other one. This script removes exactly the mutants
// named on stdin (`path<TAB>mutant id`, one per line, the scorer's output) and writes the file
// back. A file left with no mutants stays, with `mutants: []` and its `source`, as does everything
// else in the file (`testFiles` included): Stryker matches a kept mutant by those.
//
// Exit 2, with the file untouched, for no argument, a file that is missing or not JSON, no
// candidate, a candidate line without a tab, path, or id, and a path or id the file does not
// hold. A rerun that silently dropped nothing would reuse the Timeout results and prove nothing,
// so a candidate it cannot find is a failure, never a skip.
//
// Dependency-free on purpose (see kiko-linter's "Node checkers").

const fs = require('node:fs');

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const [incrementalPath] = process.argv.slice(2);

if (!incrementalPath) {
  fail('usage: mutation-rerun.js <stryker-incremental.json>');
}

let incremental;

try {
  incremental = JSON.parse(fs.readFileSync(incrementalPath, 'utf8'));
} catch (error) {
  fail(`could not read or parse ${incrementalPath}: ${error.message}`);
}

const parseCandidate = (line) => {
  const tab = line.indexOf('\t');
  const path = tab === -1 ? '' : line.slice(0, tab);
  const identifier = tab === -1 ? '' : line.slice(tab + 1);

  if (path === '' || identifier === '') {
    fail(`candidate is not path<TAB>id: ${JSON.stringify(line)}`);
  }

  return [path, identifier];
};

const candidates = fs
  .readFileSync(0, 'utf8')
  .split('\n')
  .filter((line) => line !== '')
  .map(parseCandidate);

if (candidates.length === 0) {
  fail(`no candidates on stdin, nothing to remove from ${incrementalPath}`);
}

const identifiersByPath = new Map();

for (const [path, identifier] of candidates) {
  identifiersByPath.set(path, (identifiersByPath.get(path) ?? new Set()).add(identifier));
}

for (const [path, identifiers] of identifiersByPath) {
  const mutants = incremental.files?.[path]?.mutants;

  if (!Array.isArray(mutants)) {
    fail(`${incrementalPath} holds no mutants for ${path}`);
  }

  const held = new Set(mutants.map((mutant) => String(mutant.id)));

  for (const identifier of identifiers) {
    if (!held.has(identifier)) {
      fail(`${incrementalPath} holds no mutant ${identifier} in ${path}`);
    }
  }
}

for (const [path, identifiers] of identifiersByPath) {
  incremental.files[path].mutants = incremental.files[path].mutants.filter(
    (mutant) => !identifiers.has(String(mutant.id)),
  );
}

fs.writeFileSync(incrementalPath, JSON.stringify(incremental));
