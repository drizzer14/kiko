#!/usr/bin/env node

// Mechanizes kiko-translator's "A string moved into a shared component changes namespace": a
// file under `src/design-system/components/<name>/` reads only the `components.<camelCase(name)>.*`
// i18n keys, never another component's namespace. A component reading a sibling's keys breaks
// when that sibling's copy changes or its keys are removed.
//
// This is a NODE check, not a Semgrep rule, because the allowed namespace is derived from the
// file's own folder name, and Semgrep cannot compare a path segment against a string literal.
//
// Any string literal opening `components.<namespace>.` counts, not only a `t(...)` argument, so a
// key kept in a constant or an `i18n.t` call in a test is read the same way. A mention inside a
// comment is not a read. A file directly under `components/` (a barrel) has no folder of its own
// and is out of scope.

const fs = require('node:fs');
const path = require('node:path');

const { commentSpans, lineNumberAt } = require('./specifier-scanner');

// The `<name>` is the first folder below `components/`; the trailing slash keeps a file that sits
// directly in `components/` out.
const COMPONENT_FOLDER = /(?:^|\/)src\/design-system\/components\/([^/]+)\//;

const COMPONENT_KEY = /(['"`])components\.([A-Za-z0-9_$]+)\./g;

// `expand-toggle` reads `components.expandToggle.*`.
function namespaceOf(folderName) {
  return folderName.replace(/-([a-z0-9])/g, (_match, character) => character.toUpperCase());
}

function keyAt(source, start) {
  const end = source.slice(start).search(/['"`]/);

  return source.slice(start, end === -1 ? source.length : start + end);
}

// Every foreign-namespace key literal in `source`, in file order, or an empty list when
// `filePath` is not inside a component folder.
function findViolations(filePath, source) {
  const folder = COMPONENT_FOLDER.exec(filePath.split(path.sep).join('/'));

  if (folder === null) {
    return [];
  }

  const expected = namespaceOf(folder[1]);
  const comments = commentSpans(source);
  const violations = [];

  COMPONENT_KEY.lastIndex = 0;

  for (let match = COMPONENT_KEY.exec(source); match !== null; match = COMPONENT_KEY.exec(source)) {
    const start = match.index + 1;
    const inComment = comments.some((span) => start >= span.start && start < span.end);

    if (!inComment && match[2] !== expected) {
      violations.push({
        line: lineNumberAt(source, start),
        key: keyAt(source, start),
        expected: `components.${expected}`,
      });
    }
  }

  return violations;
}

function runCli() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    process.stderr.write('usage: component-i18n-namespace.js <file...>\n');
    process.exit(2);
  }

  let anyViolation = false;

  for (const file of files) {
    for (const violation of findViolations(file, fs.readFileSync(file, 'utf8'))) {
      anyViolation = true;
      process.stdout.write(
        `${file}:${violation.line}: ${violation.key} (expected ${violation.expected})\n`,
      );
    }
  }

  process.exit(anyViolation ? 1 : 0);
}

if (require.main === module) {
  runCli();
}

module.exports = { findViolations };
