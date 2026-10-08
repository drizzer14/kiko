#!/usr/bin/env node

// Mechanizes kiko-translator's "A plural key is always called with `count`".
// i18next picks the _one/_few/_many/_other form from the `count` option, so a
// plural key called without it matches no form and renders the bare key path
// on screen. tsc does not catch it: the catalogue type accepts the base key.
//
// This is a NODE check, not a Semgrep rule, because the plural key set lives
// in en.ts and a Semgrep rule cannot read a second file. The key set is read
// from THIS checkout's en.ts (the checker's own root), never from beside the
// checked file: the pre-write guard runs this checker on a temp mirror that
// holds only the one edited file.
//
// A base key K is plural when its object holds both `K_one` and `K_other`;
// keys are full dotted paths, so `statistics.trendFilter.manual` is not
// plural even though `statistics.trendFilter.button.manual` is. The callee is
// `t` or any `<object>.t` (`i18n.t`, `i18next.t`), and only a string-literal
// key is checked. An options argument the checker cannot see into (a
// variable, a spread, a computed name) may carry `count`, so it is never
// flagged: denying it would block code that is right today.
//
// A scanner, not a parser, like its siblings: the guard-replay scratch
// checkout has no node_modules, so an npm dependency would fail closed on
// every replayed file there. Structure (braces, commas) is read from a
// noise-blanked copy, where comments, strings, and regex literals cannot fake
// a brace; names and keys are read from the raw source at the same offsets.

const fs = require('node:fs');
const path = require('node:path');
const { blankNoise, lineNumberAt } = require('./specifier-scanner');

const ROOT = path.resolve(__dirname, '..', '..');
const CATALOGUE_PATH = path.join(ROOT, 'src', 'i18n', 'locales', 'en.ts');

// The catalogues define the keys and call no `t`; the checker never needs to
// read them as call sites.
const CATALOGUE_FILE = /(?:^|\/)src\/i18n\/locales\/(?:en|uk)\.ts$/;

const PLURAL_ONE_SUFFIX = /^(.+)_one$/;

const CATALOGUE_DECLARATION = /\bconst\s+en\s*=\s*\{/;

// `t(` or `<object>.t(`, optionally called through `?.`. The lookbehind keeps
// `format(` and `alert(` out; a `.` before `t` is the member form.
const TRANSLATE_CALL = /(?<![\w$])t\s*(?:\?\.\s*)?\(/g;

const IDENTIFIER = /[\w$]+/y;

// An accessor or async method's name follows its modifier word.
const METHOD_MODIFIERS = new Set(['get', 'set', 'async']);

const OPENERS = new Set(['{', '[', '(']);

const CLOSERS = new Set(['}', ']', ')']);

function skipTrivia(source, at) {
  let cursor = at;

  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor += 1;
    } else if (source.startsWith('//', cursor)) {
      const end = source.indexOf('\n', cursor);
      cursor = end === -1 ? source.length : end;
    } else if (source.startsWith('/*', cursor)) {
      const end = source.indexOf('*/', cursor + 2);
      cursor = end === -1 ? source.length : end + 2;
    } else {
      return cursor;
    }
  }

  return cursor;
}

// The value of the quoted literal opening at `at`, or null when it is not
// closed on its own line.
function readString(source, at) {
  const quote = source[at];
  let value = '';
  let cursor = at + 1;

  while (cursor < source.length && source[cursor] !== quote) {
    if (source[cursor] === '\n') return null;

    if (source[cursor] === '\\') {
      cursor += 1;
    }

    value += source[cursor];
    cursor += 1;
  }

  return cursor < source.length ? { value, end: cursor + 1 } : null;
}

function readIdentifier(source, at) {
  IDENTIFIER.lastIndex = at;
  const match = IDENTIFIER.exec(source);

  return match === null ? null : { value: match[0], end: at + match[0].length };
}

// The property head at `at`: { kind: 'name', name } for an identifier,
// string, or number name; 'spread' or 'computed' otherwise. `end` is where
// the head stops.
function readPropertyHead(source, at) {
  const start = skipTrivia(source, at);

  if (source.startsWith('...', start)) return { kind: 'spread', end: start + 3 };

  if (source[start] === '[') return { kind: 'computed', end: start };

  if (source[start] === "'" || source[start] === '"') {
    const literal = readString(source, start);

    return literal === null
      ? { kind: 'computed', end: start }
      : { kind: 'name', name: literal.value, end: literal.end };
  }

  const identifier = readIdentifier(source, start);

  if (identifier === null) return { kind: 'computed', end: start };

  const next = skipTrivia(source, identifier.end);

  if (METHOD_MODIFIERS.has(identifier.value) && /[\w$'"[]/.test(source[next] ?? '')) {
    return readPropertyHead(source, next);
  }

  return { kind: 'name', name: identifier.value, end: identifier.end };
}

// The offset of the `,` or `}` that ends the property whose head stops at
// `from`. Throws when the object that opened at `open` never closes.
function propertyEnd(blanked, from, open) {
  let depth = 0;

  for (let cursor = from; cursor < blanked.length; cursor += 1) {
    const character = blanked[cursor];

    if (depth === 0 && (character === ',' || character === '}')) return cursor;

    if (OPENERS.has(character)) depth += 1;

    if (CLOSERS.has(character)) depth -= 1;
  }

  throw new Error(`unclosed object literal at offset ${open}`);
}

// The object literal whose `{` sits at `open`: its properties, each with the
// offset its value starts at (null for a shorthand, a spread, or a method),
// and the offset just past its `}`. Throws on an unclosed object.
function readObject(source, blanked, open) {
  const properties = [];
  let cursor = open + 1;

  for (;;) {
    const afterTrivia = skipTrivia(source, cursor);

    if (blanked[afterTrivia] === '}') {
      return { properties, end: afterTrivia + 1 };
    }

    const head = readPropertyHead(source, afterTrivia);
    const colon = skipTrivia(source, head.end);
    const valueStart =
      head.kind === 'name' && source[colon] === ':' ? skipTrivia(source, colon + 1) : null;

    properties.push({ ...head, valueStart });

    cursor = propertyEnd(blanked, head.end, open);

    if (blanked[cursor] === '}') {
      return { properties, end: cursor + 1 };
    }

    cursor += 1;
  }
}

function joinKey(prefix, name) {
  return prefix === '' ? name : `${prefix}.${name}`;
}

function collectPluralKeys(source, blanked, open, prefix, keys) {
  const { properties } = readObject(source, blanked, open);
  const names = new Set();

  for (const property of properties) {
    if (property.kind !== 'name') continue;

    names.add(property.name);

    if (property.valueStart !== null && blanked[property.valueStart] === '{') {
      collectPluralKeys(source, blanked, property.valueStart, joinKey(prefix, property.name), keys);
    }
  }

  for (const name of names) {
    const match = PLURAL_ONE_SUFFIX.exec(name);

    if (match && names.has(`${match[1]}_other`)) {
      keys.add(joinKey(prefix, match[1]));
    }
  }
}

// Every plural base key in en.ts's `export const en = { ... }`. A catalogue
// this checker cannot find or read throws, so a moved or reshaped en.ts fails
// the check instead of silently disabling it.
function readPluralKeys(cataloguePath) {
  const source = fs.readFileSync(cataloguePath, 'utf8');
  const blanked = blankNoise(source);
  const declaration = CATALOGUE_DECLARATION.exec(blanked);

  if (declaration === null) {
    throw new Error(`no \`const en = { ... }\` object literal in ${cataloguePath}`);
  }

  const keys = new Set();
  collectPluralKeys(source, blanked, declaration.index + declaration[0].length - 1, '', keys);

  return keys;
}

// False only when the options argument is provably without `count`: absent,
// or exactly an object literal with no spread, no computed name, and no
// `count`.
function mayCarryCount(source, blanked, at) {
  const start = skipTrivia(source, at);

  if (source[start] === ')') return false;

  if (source[start] !== ',') return true;

  const optionsStart = skipTrivia(source, start + 1);

  if (source[optionsStart] === ')') return false;

  if (blanked[optionsStart] !== '{') return true;

  const { properties, end } = readObject(source, blanked, optionsStart);
  const next = skipTrivia(source, end);

  if (source[next] !== ',' && source[next] !== ')') return true;

  return properties.some((property) => property.kind !== 'name' || property.name === 'count');
}

// Every plural-key call without `count` in `source`, in file order.
function findViolations(source, pluralKeys) {
  const blanked = blankNoise(source);
  const violations = [];

  TRANSLATE_CALL.lastIndex = 0;

  for (let match = TRANSLATE_CALL.exec(blanked); match !== null; ) {
    const keyStart = skipTrivia(source, match.index + match[0].length);
    const quote = source[keyStart];
    const key = quote === "'" || quote === '"' ? readString(source, keyStart) : null;

    if (key !== null && pluralKeys.has(key.value) && !mayCarryCount(source, blanked, key.end)) {
      violations.push({ line: lineNumberAt(source, match.index), key: key.value });
    }

    match = TRANSLATE_CALL.exec(blanked);
  }

  return violations;
}

function runCli() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    process.stderr.write('usage: plural-count.js <file...>\n');
    process.exit(2);
  }

  const pluralKeys = readPluralKeys(CATALOGUE_PATH);
  let anyViolation = false;

  for (const file of files) {
    if (CATALOGUE_FILE.test(file.split(path.sep).join('/'))) continue;

    const violations = findViolations(fs.readFileSync(file, 'utf8'), pluralKeys);

    for (const violation of violations) {
      anyViolation = true;
      process.stdout.write(`${file}:${violation.line}: t('${violation.key}') has no count\n`);
    }
  }

  process.exit(anyViolation ? 1 : 0);
}

if (require.main === module) {
  runCli();
}

module.exports = { findViolations, readPluralKeys };
