#!/usr/bin/env node

// Turns `git diff -U0` output (stdin) into the ADDED-line ranges of the given paths, so
// scripts/checks/mutation.sh can hand Stryker `path:start-end` entries (the changed lines only).
//
//   usage: git diff -U0 --find-renames ... | mutation-ranges.js <path>...
//
// It prints one line per argument, in argument order: `<path>\t<r1>,<r2>...`. Each range is
// `start-end` (1-based, end inclusive, whole lines, the entry shape Stryker's `mutate` takes),
// sorted ascending, with overlapping and ADJACENT ranges merged (two hunks one line apart stay
// two ranges: nothing is widened). The field is empty when the path has no added line.
//
// A path counts as PRESENT in the diff when a `diff --git` header ends with ` b/<path>` (matched
// against the arguments, so a space in a path is safe), or a `rename to <path>` or `+++ b/<path>`
// line names it. A pure rename (similarity 100%) and a mode-only change have a header but no
// `+++` line and no hunk, so they are present with an empty field. A path that is absent from
// every header exits 2: the caller passes only files it saw change, so its absence means the
// diff or this parse is broken, and the gate must not guess. Hunks of a path that is not an
// argument are ignored.
//
// A hunk header `@@ -a,b +c,d @@` adds the lines c..c+d-1; a missing `d` means 1 and `d = 0` (a
// pure deletion) adds none. The hunk body is skipped by its line counts, so an added line that
// reads like a file header (`+++ b/x`) is never taken for one.

const fs = require('node:fs');

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const GIT_HEADER = 'diff --git ';

const paths = process.argv.slice(2);

if (paths.length === 0) {
  process.stderr.write('usage: mutation-ranges.js <path>... < git-diff-U0-output\n');
  process.exit(2);
}

const pathOfHeader = (line) =>
  paths
    .filter((path) => line.endsWith(` b/${path}`))
    .sort((first, second) => second.length - first.length)[0];

const pathOfLine = (line, prefix) => {
  if (!line.startsWith(prefix)) {
    return undefined;
  }

  const named = line.slice(prefix.length).replace(/\t$/, '');

  return paths.includes(named) ? named : undefined;
};

const rangesByPath = new Map();
let current;
let oldLeft = 0;
let newLeft = 0;

const markPresent = (path) => {
  if (path !== undefined && !rangesByPath.has(path)) {
    rangesByPath.set(path, []);
  }
};

for (const line of fs.readFileSync(0, 'utf8').split('\n')) {
  if (line.startsWith(GIT_HEADER)) {
    // A body line starts with +, - or a space, so this is always a real header; it also ends any
    // hunk whose counts the diff did not fulfil.
    oldLeft = 0;
    newLeft = 0;
    current = pathOfHeader(line);
    markPresent(current);
  } else if (oldLeft > 0 && line.startsWith('-')) {
    oldLeft -= 1;
  } else if (newLeft > 0 && line.startsWith('+')) {
    newLeft -= 1;
  } else if (line.startsWith('\\')) {
    continue;
  } else if (line === '+++ /dev/null') {
    current = undefined;
  } else if (line.startsWith('+++ b/')) {
    current = pathOfLine(line, '+++ b/');
    markPresent(current);
  } else if (line.startsWith('rename to ')) {
    current = pathOfLine(line, 'rename to ');
    markPresent(current);
  } else {
    const hunk = HUNK_HEADER.exec(line);

    if (hunk !== null) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
      const start = Number(hunk[2]);

      if (current !== undefined && newLeft > 0) {
        rangesByPath.get(current).push([start, start + newLeft - 1]);
      }
    }
  }
}

const missing = paths.filter((path) => !rangesByPath.has(path));

if (missing.length > 0) {
  process.stderr.write(
    `not in the diff (a changed file must appear in it): ${missing.join(', ')}\n`,
  );
  process.exit(2);
}

const merge = (ranges) =>
  [...ranges]
    .sort((first, second) => first[0] - second[0])
    .reduce((merged, [start, end]) => {
      const last = merged[merged.length - 1];

      if (last !== undefined && start <= last[1] + 1) {
        last[1] = Math.max(last[1], end);
      } else {
        merged.push([start, end]);
      }

      return merged;
    }, []);

for (const path of paths) {
  const field = merge(rangesByPath.get(path))
    .map(([start, end]) => `${start}-${end}`)
    .join(',');

  process.stdout.write(`${path}\t${field}\n`);
}
