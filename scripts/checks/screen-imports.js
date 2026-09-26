#!/usr/bin/env node

// Mechanizes the pre-write-guard design spec's rule 12 ("No import from
// another screen's folder"): a file under `src/screens/<screen-a>/` must
// not import from `src/screens/<screen-b>/**` for any `screen-b !==
// screen-a`. Shared code belongs in `src/design-system/`, a shared hook/
// util directory, or an explicit barrel outside `src/screens/`. This is
// distinct from `kiko-no-import-screens-outside-ui`
// (rules/semgrep-mobile.yml), which restricts what NON-screen code may
// import FROM `src/screens/**` — this checker restricts screen-TO-screen
// imports instead.
//
// This is a NODE check, not a Semgrep rule, because Semgrep has no way to
// resolve a RELATIVE specifier ('../../b/y') against the importing file's
// own path — deciding "screen-a" vs "screen-b" requires exactly that
// resolution. Specifiers are found by specifier-scanner.js (see its header
// for why a regex scan over a noise-blanked copy is enough).
//
// jest.mock('../../b/y') of a sibling screen's module counts as a cross-
// screen import: a test mocking another screen's module still depends on
// that module's shape — a signature change there can break the test — the
// same coupling a genuine import creates.

const fs = require('node:fs');
const path = require('node:path');

const { findSpecifiers } = require('./specifier-scanner');

// The path alias mirrors tsconfig.json's `paths` and babel.config.js's
// `module-resolver` alias: `@kiko/*` maps to `./src/*`, so
// '@kiko/screens/b/thing' is 'src/screens/b/thing'.
const ALIAS_PREFIX = '@kiko/';

// ---- screen-folder resolution ----

// The `<segment>` in the nearest `src/screens/<segment>/` ancestor of
// `absolutePath`, or null when `absolutePath` is not under `src/screens/`
// at all. Works the same whether `absolutePath` is a real repo path or a
// path through the pre-write guard's mkdtemp mirror (`.../after/src/
// screens/a/x.tsx`) — the search only ever looks for the `src/screens/`
// substring itself, never assumes what precedes it.
function screenSegmentOf(absolutePath) {
  const posixPath = absolutePath.split(path.sep).join('/');
  const match = /(?:^|\/)src\/screens\/([^/]+)/.exec(posixPath);

  return match ? match[1] : null;
}

// The screen segment a specifier resolves into, or null when it resolves
// outside `src/screens/` entirely (shared code, a bare package name) — the
// only case per the design spec that this rule does not restrict.
function targetScreenSegment(filePath, specifier) {
  if (specifier.startsWith(ALIAS_PREFIX)) {
    const aliased = specifier.slice(ALIAS_PREFIX.length);
    const match = /^screens\/([^/]+)/.exec(aliased);

    return match ? match[1] : null;
  }

  if (specifier.startsWith('.')) {
    return screenSegmentOf(path.resolve(path.dirname(filePath), specifier));
  }

  return null;
}

// Every cross-screen-import violation in `filePath`, in file order — empty
// when `filePath` is not itself under `src/screens/<some-screen>/` (this
// rule restricts screen-TO-screen imports only; what non-screen code may
// import FROM `src/screens/` is `kiko-no-import-screens-outside-ui`'s job).
function findViolations(filePath, source) {
  const ownSegment = screenSegmentOf(filePath);

  if (ownSegment === null) {
    return [];
  }

  return findSpecifiers(source)
    .filter((entry) => {
      const targetSegment = targetScreenSegment(filePath, entry.specifier);

      return targetSegment !== null && targetSegment !== ownSegment;
    })
    .map((entry) => ({ line: entry.line, specifier: entry.specifier }));
}

function runCli() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    process.stderr.write('usage: screen-imports.js <file...>\n');
    process.exit(2);
  }

  let anyViolation = false;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const violations = findViolations(file, source);

    if (violations.length > 0) {
      anyViolation = true;

      for (const violation of violations) {
        process.stdout.write(`${file}:${violation.line}: ${violation.specifier}\n`);
      }
    }
  }

  process.exit(anyViolation ? 1 : 0);
}

if (require.main === module) {
  runCli();
}

module.exports = { findViolations };
