#!/usr/bin/env node

// Mechanizes kiko-code-style's "Blank lines before statement blocks" and
// "Blank line between adjacent JSX sibling nodes" sections — both hand-
// applied until now, since Biome does not enforce either (it has no opinion
// on a blank line before a bare statement, and is whitespace-insensitive
// inside JSX).
//
// A line-based scanner, not a parser, in the same class as import-order.js
// and full-word-identifiers.js: a `return`/`if`/`for`/`while` statement is
// recognized by its keyword starting the TRIMMED line (this codebase's
// Biome-formatted style always puts one statement's keyword at its own
// line's start), and a JSX sibling boundary is recognized by one line
// closing a JSX element (a closing tag, or a self-closing `/>`) directly
// above a line opening another one, at the SAME indentation (Biome's
// 2-space-per-level formatting makes indentation a reliable nesting-level
// signal). Neither check needs a real AST: the keyword match only ever
// fires on a line's own first token, so it can never mistake a mid-line
// occurrence (inside an expression, a member access, or a regex literal,
// which can never itself span a line) for a statement — the one place a
// false match COULD happen is a multi-line comment or template literal
// whose interior text happens to start a line with one of these words,
// which is exactly why blankNoise below still blanks those spans first.

const fs = require('node:fs');

const blankSpan = (source, start, end) => source.slice(start, end).replace(/[^\n]/g, ' ');

const lineCommentEnd = (source, at) => {
  const end = source.indexOf('\n', at);

  return end === -1 ? source.length : end;
};

const blockCommentEnd = (source, at) => {
  const end = source.indexOf('*/', at + 2);

  return end === -1 ? source.length : end + 2;
};

// Stops at an unescaped closing `quote` OR a bare `\n` — a plain single/
// double-quoted string can never legitimately contain a literal newline in
// this codebase's Biome-formatted style, so capping the search there is what
// keeps a stray/mismatched quote (for example one inside an unblanked regex
// literal — see the regex handling below) from running the "string" past the
// end of its own line and swallowing a LATER line's leading keyword.
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

// A `/` starts a regex literal (rather than division) when the last
// significant character emitted so far is a punctuation/operator context, an
// opening bracket, nothing (start of file), or a keyword that only ever
// precedes an EXPRESSION, never a value to divide (`return /e/.test(...)`,
// `typeof /x/`) — ported from full-word-identifiers.js's REGEX_START_CONTEXT,
// MINUS `<`/`>`: this scanner (unlike that one) reads JSX, where a `/`
// almost always follows a bare `<` as a closing tag's own `</Tag>` syntax,
// not an operator context — treating that `/` as a regex start would run
// regexLiteralEnd over the rest of the closing tag and blank it out, which
// breaks isJsxElementEndLine's own text match on the very tag this scanner
// exists to recognize.
const REGEX_START_CONTEXT =
  /[([{,;:=!&|?+\-*%^~]$|^$|\b(?:return|typeof|instanceof|in|of|yield|throw|new|void|delete|case|do|else)$/;

const consumeRegexFlags = (source, at) => {
  let cursor = at;

  while (cursor < source.length && /[a-z]/i.test(source[cursor])) {
    cursor += 1;
  }

  return cursor;
};

// Ported from full-word-identifiers.js's regexLiteralEnd: a regex literal
// can never span a line, so a bare `\n` before the closing `/` always ends
// the scan (an unterminated regex is a syntax error this checker never needs
// to recover from).
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

// Tries to consume one noise span (a line/block comment, a string, a
// template literal, or a regex literal) starting at `cursor`, given the
// blanked-so-far `resultSoFar` (needed only to test REGEX_START_CONTEXT).
// Returns null when `cursor` starts none of those — the shared stepper
// blankNoise and substitutionSpan both drive, so a literal is blanked the
// same way whether it appears at top level or inside a template
// substitution's own code. Ported from full-word-identifiers.js's blankNoise,
// including its regex-literal handling: a regex literal can never itself
// span a line, but a QUOTE CHARACTER inside one (`/'([^']+)'/`, the real
// src/db/schema.category-overrides.test.ts shape) still needs blanking here
// — left unblanked, that quote is misread as a string opener whose
// stringLiteralEnd search for a matching quote can run past the regex and
// swallow a LATER line's leading keyword.
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

  // A `'`/`"` preceded by an identifier character (`n` in "don't") is a
  // contraction or possessive inside JSX text, not a string opener — that
  // syntax position is never valid TS/JS otherwise (see
  // full-word-identifiers.js's blankNoise for the same heuristic, needed
  // here for the same reason: this scanner also reads JSX text content).
  if ((character === '"' || character === "'") && !isIdentifierChar(source[cursor - 1])) {
    const stop = stringLiteralEnd(source, cursor, character);

    return { text: blankSpan(source, cursor, stop), end: stop };
  }

  if (character === '`') {
    const template = templateLiteralSpan(source, cursor);

    return { text: template.text, end: template.end };
  }

  if (character === '/' && REGEX_START_CONTEXT.test(resultSoFar.replace(/\s+$/, ''))) {
    const stop = regexLiteralEnd(source, cursor);

    return { text: blankSpan(source, cursor, stop), end: stop };
  }

  return null;
};

// Scans forward from just after a template substitution's opening `${` to
// its matching `}`, tracking nested-brace depth so a `{` inside the
// expression never ends the scan early. Returns the blanked replacement
// text (same length as the source span, closing `}` included) and the index
// just past that `}`.
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

// Blanks a template literal's LITERAL text but keeps each `${...}`
// substitution's own code visible. `at` points at the opening backtick.
// Returns the full blanked replacement text (same length as the source
// span) and the index just past the closing backtick.
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

// Blanks (space-fills, preserving length and newlines) every string,
// template, comment, and regex-literal span, so the line-start scanners
// below never read a keyword or a JSX tag that only appears inside one of
// those.
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

const isBlankLine = (line) => /^\s*$/.test(line);

const leadingWhitespaceLength = (line) => /^\s*/.exec(line)[0].length;

const endsWithBlockOpener = (line) => /\{\s*$/.test(line.trimEnd());

// Recognizes only a `return`/`if`/`for`/`while` statement whose own keyword
// starts the trimmed line — kiko-code-style's rule stops there (`switch` is
// separately banned outright, with no exception, by kiko-no-switch, so it
// can never appear here; `else`/`else if` is excluded on purpose, since it
// continues the SAME conditional the line above it just closed).
const STATEMENT_KEYWORD = /^(return\b|if\s*\(|for\s*\(|while\s*\()/;

const statementKind = (trimmed) => {
  if (trimmed.startsWith('return')) return 'return';

  if (trimmed.startsWith('if')) return 'if';

  if (trimmed.startsWith('for')) return 'for';

  return 'while';
};

// One violation per return/if/for/while statement (after the file's first
// line, which vacuously has nothing above it to separate from) that is
// neither the first statement of its block (the line above it ends with an
// unclosed `{`) nor already separated by a blank line or a comment — a
// comment line blanks to an all-whitespace line here, so `isBlankLine`
// alone covers both cases.
const findStatementViolations = (blankedLines, originalLines) => {
  const violations = [];

  for (let index = 1; index < blankedLines.length; index += 1) {
    const trimmed = blankedLines[index].trim();

    if (!STATEMENT_KEYWORD.test(trimmed)) continue;

    const previousLine = blankedLines[index - 1];

    if (isBlankLine(previousLine) || endsWithBlockOpener(previousLine)) continue;

    violations.push({
      line: index + 1,
      kind: statementKind(trimmed),
      matchedText: originalLines[index].trim(),
    });
  }

  return violations;
};

const isJsxElementStartLine = (line) => /^<[A-Za-z]/.test(line.trim());

// A line ENDS a JSX element when it ends with a closing tag (covers both a
// closing tag alone on its own line, and a whole element opened, given
// text/expression content, and closed on one line — `<Text>A</Text>`) or
// with a self-closing `/>` (covers both a whole self-closing tag on one
// line and the closing bracket of one whose attributes wrapped onto their
// own lines). Anchored at the END of the trimmed line specifically so an
// OPENING tag with children on the following lines (`<View style={x}>`,
// ending in a bare `>`) is never mistaken for one.
const isJsxElementEndLine = (line) => {
  const trimmed = line.trim();

  return /<\/[\w.]+>$/.test(trimmed) || /\/>$/.test(trimmed);
};

// The number of JSX element children the boundary at `boundaryIndex` sits
// among — every contiguous run of lines at or deeper than `indentation`
// around it (bounded by the shallower-indented parent open/close tags),
// counting only the ones that START a child element at exactly
// `indentation`. Used for the "not the only two children" exemption: a
// two-child parent never needs a separating blank line between them.
const siblingCountAtBoundary = (blankedLines, boundaryIndex, indentation) => {
  let start = boundaryIndex;

  while (start > 0 && leadingWhitespaceLength(blankedLines[start - 1]) >= indentation) {
    start -= 1;
  }

  let end = boundaryIndex;

  while (
    end < blankedLines.length - 1 &&
    leadingWhitespaceLength(blankedLines[end + 1]) >= indentation
  ) {
    end += 1;
  }

  let count = 0;

  for (let index = start; index <= end; index += 1) {
    if (
      leadingWhitespaceLength(blankedLines[index]) === indentation &&
      isJsxElementStartLine(blankedLines[index])
    ) {
      count += 1;
    }
  }

  return count;
};

// One violation per pair of adjacent JSX sibling lines at the same
// indentation with nothing between them — a comment line between two
// siblings blanks to all-whitespace, so it is never read as either an
// element-end or an element-start line, and the pair it would have sat
// between is never examined as adjacent in the first place.
const findJsxSiblingViolations = (blankedLines, originalLines) => {
  const violations = [];

  for (let index = 0; index < blankedLines.length - 1; index += 1) {
    const line = blankedLines[index];
    const nextLine = blankedLines[index + 1];

    if (!isJsxElementEndLine(line) || !isJsxElementStartLine(nextLine)) continue;

    const indentation = leadingWhitespaceLength(line);

    if (leadingWhitespaceLength(nextLine) !== indentation) continue;

    if (siblingCountAtBoundary(blankedLines, index, indentation) === 2) continue;

    violations.push({
      line: index + 2,
      kind: 'jsx',
      matchedText: originalLines[index + 1].trim(),
    });
  }

  return violations;
};

// Returns every violation in `source`, in file order. `blankedLines` and
// `originalLines` stay index-aligned line for line — blankNoise only ever
// replaces characters, never inserts or removes a newline — so a violation
// found against the blanked copy still points at the right line, and the
// original text is what gets reported and rewritten.
function findViolations(source) {
  const blankedLines = blankNoise(source).split('\n');
  const originalLines = source.split('\n');

  return findStatementViolations(blankedLines, originalLines)
    .concat(findJsxSiblingViolations(blankedLines, originalLines))
    .sort((a, b) => a.line - b.line);
}

// Inserts one blank line immediately above every violating line. Processed
// in DESCENDING line order so each `splice` (which shifts every later index
// down by one) never invalidates a not-yet-applied insertion's own index —
// those all sit at smaller indices, untouched by an insertion at a larger
// one.
function insertMissingBlankLines(source) {
  const violations = findViolations(source);

  if (violations.length === 0) {
    return { text: source, changed: false };
  }

  const lines = source.split('\n');

  for (const violation of [...violations].sort((a, b) => b.line - a.line)) {
    lines.splice(violation.line - 1, 0, '');
  }

  return { text: lines.join('\n'), changed: true };
}

// Applies --write to one file, printing what it did, then re-runs the plain
// checker against --write's OWN output and prints any violation still
// present — the same re-check contract as import-order.js's writeFile (see
// kiko-linter's "Import length-sort" section for the general rule). A
// mechanical blank-line insertion always resolves the exact violation it was
// computed from, so `remaining` is expected to stay empty; the re-check is
// the safety net that makes that provable rather than assumed, and what
// keeps --write safe to run twice in a row (a clean file has no violations,
// so `insertMissingBlankLines` reports `changed: false` and rewrites
// nothing).
function writeFile(file, source) {
  const { text, changed } = insertMissingBlankLines(source);

  if (changed) {
    fs.writeFileSync(file, text);
    process.stdout.write(`fixed: ${file}\n`);
  }

  const remaining = findViolations(text);

  for (const violation of remaining) {
    process.stdout.write(
      `left for hand fix: ${file}:${violation.line}: ${violation.kind}: ${violation.matchedText}\n`,
    );
  }

  return remaining.length > 0;
}

function runCli() {
  const write = process.argv.includes('--write');
  const files = process.argv.slice(2).filter((argument) => argument !== '--write');

  if (files.length === 0) {
    process.stderr.write('usage: blank-line-separation.js [--write] <file...>\n');
    process.exit(2);
  }

  let anyViolation = false;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');

    if (write) {
      if (writeFile(file, source)) {
        anyViolation = true;
      }
      continue;
    }

    const violations = findViolations(source);

    if (violations.length > 0) {
      anyViolation = true;

      for (const violation of violations) {
        process.stdout.write(
          `${file}:${violation.line}: ${violation.kind}: ${violation.matchedText}\n`,
        );
      }
    }
  }

  process.exit(anyViolation ? 1 : 0);
}

if (require.main === module) {
  runCli();
}

module.exports = { findViolations };
