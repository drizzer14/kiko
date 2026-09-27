// Shared by screen-imports.js and feature-imports.js, which both have to
// see every module specifier a file names.
//
// A line/regex scanner, not a parser, in the same class as import-order.js
// and blank-line-separation.js: every import/export-from/require/dynamic-
// import/jest.mock specifier is found by regex against the RAW source (so
// its literal specifier text stays readable), then validated against a
// noise-blanked copy (ported from blank-line-separation.js's blankNoise:
// comments, strings, templates, and regex literals space-filled to the same
// length, never inserting/removing a line) — a candidate whose own leading
// keyword ('import'/'export'/'require'/'jest.mock') is NOT intact at that
// position in the blanked copy sat inside a comment or a plain string that
// merely CONTAINS import-looking text, and is discarded.

// ---- noise blanking (ported from blank-line-separation.js; see its own
// comments for the reasoning behind each helper — duplicated here rather
// than imported, since blank-line-separation.js exports only
// `findViolations`, the same precedent full-word-identifiers.js set for
// blank-line-separation.js's own copy of this machinery) ----

const blankSpan = (source, start, end) => source.slice(start, end).replace(/[^\n]/g, ' ');

const lineCommentEnd = (source, at) => {
  const end = source.indexOf('\n', at);

  return end === -1 ? source.length : end;
};

const blockCommentEnd = (source, at) => {
  const end = source.indexOf('*/', at + 2);

  return end === -1 ? source.length : end + 2;
};

const stringLiteralEnd = (source, at, quote) => {
  let cursor = at + 1;

  while (cursor < source.length && source[cursor] !== quote && source[cursor] !== '\n') {
    cursor += source[cursor] === '\\' ? 2 : 1;
  }

  if (source[cursor] === '\n') {
    return cursor;
  }

  return Math.min(cursor + 1, source.length);
};

const isIdentifierChar = (character) => character !== undefined && /[A-Za-z0-9_$]/.test(character);

const REGEX_START_CONTEXT =
  /[([{,;:=!&|?+\-*%^~]$|^$|\b(?:return|typeof|instanceof|in|of|yield|throw|new|void|delete|case|do|else)$/;

// Only the tail decides whether a '/' opens a regex literal. Trimming the
// whole prefix on every '/' made a JSX-heavy file quadratic; 11 characters
// hold the longest keyword plus the one before it that `\b` looks at.
const precedesRegexLiteral = (resultSoFar) => {
  let end = resultSoFar.length;

  while (end > 0 && /\s/.test(resultSoFar[end - 1])) {
    end -= 1;
  }

  return REGEX_START_CONTEXT.test(resultSoFar.slice(Math.max(0, end - 11), end));
};

const consumeRegexFlags = (source, at) => {
  let cursor = at;

  while (cursor < source.length && /[a-z]/i.test(source[cursor])) {
    cursor += 1;
  }

  return cursor;
};

const regexLiteralEnd = (source, at) => {
  let cursor = at + 1;
  let inClass = false;

  while (cursor < source.length) {
    const character = source[cursor];

    if (character === '\\') {
      cursor += 2;
      continue;
    }

    if (character === '\n') {
      return cursor;
    }

    if (character === '[') {
      inClass = true;
    } else if (character === ']') {
      inClass = false;
    } else if (character === '/' && !inClass) {
      return consumeRegexFlags(source, cursor + 1);
    }

    cursor += 1;
  }

  return source.length;
};

const consumeNoiseSpan = (source, cursor, resultSoFar) => {
  const two = source.slice(cursor, cursor + 2);

  if (two === '//') {
    const stop = lineCommentEnd(source, cursor);

    return { text: blankSpan(source, cursor, stop), end: stop };
  }

  if (two === '/*') {
    const stop = blockCommentEnd(source, cursor);

    return { text: blankSpan(source, cursor, stop), end: stop };
  }

  const character = source[cursor];

  if ((character === '"' || character === "'") && !isIdentifierChar(source[cursor - 1])) {
    const stop = stringLiteralEnd(source, cursor, character);

    return { text: blankSpan(source, cursor, stop), end: stop };
  }

  if (character === '`') {
    const template = templateLiteralSpan(source, cursor);

    return { text: template.text, end: template.end };
  }

  if (character === '/' && precedesRegexLiteral(resultSoFar)) {
    const stop = regexLiteralEnd(source, cursor);

    return { text: blankSpan(source, cursor, stop), end: stop };
  }

  return null;
};

const substitutionSpan = (source, at) => {
  let result = '';
  let cursor = at;
  let depth = 0;

  while (cursor < source.length) {
    const span = consumeNoiseSpan(source, cursor, result);

    if (span) {
      result += span.text;
      cursor = span.end;
      continue;
    }

    const character = source[cursor];

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      if (depth === 0) {
        return { text: `${result}}`, end: cursor + 1 };
      }
      depth -= 1;
    }

    result += character;
    cursor += 1;
  }

  return { text: result, end: source.length };
};

const templateLiteralSpan = (source, at) => {
  let result = '`';
  let cursor = at + 1;

  while (cursor < source.length) {
    const character = source[cursor];

    if (character === '\\' && cursor + 1 < source.length) {
      result += blankSpan(source, cursor, cursor + 2);
      cursor += 2;
      continue;
    }

    if (character === '`') {
      return { text: `${result}\``, end: cursor + 1 };
    }

    if (character === '$' && source[cursor + 1] === '{') {
      const substitution = substitutionSpan(source, cursor + 2);
      result += `\${${substitution.text}`;
      cursor = substitution.end;
      continue;
    }

    result += character === '\n' ? '\n' : ' ';
    cursor += 1;
  }

  return { text: result, end: source.length };
};

const blankNoise = (source) => {
  let result = '';
  let cursor = 0;

  while (cursor < source.length) {
    const span = consumeNoiseSpan(source, cursor, result);

    if (span) {
      result += span.text;
      cursor = span.end;
      continue;
    }

    result += source[cursor];
    cursor += 1;
  }

  return result;
};

// ---- specifier extraction ----

// One entry per specifier-bearing construct this rule must see through:
// static `import ... from`, `export ... from` (a type-only re-export
// counts too), a dynamic `import(...)`, a bare side-effect `import '...'`,
// `require(...)`, and `jest.mock(...)`. `keyword` is the literal text each
// pattern's match starts on — used below to confirm the match is not
// itself sitting inside a blanked (comment/string) span.
const DEFAULT_PATTERNS = [
  {
    keyword: 'import',
    callKind: 'import',
    pattern: /\bimport\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  },
  {
    keyword: 'export',
    callKind: 'export',
    pattern: /\bexport\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  },
  { keyword: 'import', callKind: 'import', pattern: /\bimport\s*\(\s*['"]([^'"]+)['"]/g },
  { keyword: 'import', callKind: 'import', pattern: /\bimport\s*['"]([^'"]+)['"]/g },
  { keyword: 'require', callKind: 'require', pattern: /\brequire\s*\(\s*['"]([^'"]+)['"]/g },
  { keyword: 'jest.mock', callKind: 'jest', pattern: /\bjest\.mock\s*\(\s*['"]([^'"]+)['"]/g },
];

function lineNumberAt(source, index) {
  let line = 1;

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '\n') {
      line += 1;
    }
  }

  return line;
}

// Every specifier this file's source imports/requires/re-exports/mocks, in
// file order, as { line, specifier, callKind, statement } — `statement` is
// the matched text, so a caller can tell a type-only import from a value
// one. A match whose own keyword is blanked
// in `blanked` (sitting inside a comment or a plain string that merely
// contains import-looking text) is skipped; `seen` dedupes a specifier a
// later, broader pattern in the list would otherwise also match (a bare
// side-effect pattern never overlaps a `from`-clause one, since the two
// are structurally exclusive — see the header comment — but keeping the
// guard cheap costs nothing).
function findSpecifiers(source, patterns = DEFAULT_PATTERNS) {
  const blanked = blankNoise(source);
  const found = [];
  const seen = new Set();

  for (const { keyword, callKind, pattern } of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);

    while (match !== null) {
      const start = match.index;

      if (blanked.slice(start, start + keyword.length) === keyword) {
        const key = `${start}\u0000${match[1]}`;

        if (!seen.has(key)) {
          seen.add(key);
          found.push({ index: start, specifier: match[1], callKind, statement: match[0] });
        }
      }

      match = pattern.exec(source);
    }
  }

  return found
    .sort((left, right) => left.index - right.index)
    .map((entry) => ({
      line: lineNumberAt(source, entry.index),
      specifier: entry.specifier,
      callKind: entry.callKind,
      statement: entry.statement,
    }));
}

module.exports = { DEFAULT_PATTERNS, blankNoise, findSpecifiers };
