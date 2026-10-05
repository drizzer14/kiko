#!/usr/bin/env node

// Fails when a physical line over 100 columns holds comment text. biome.json sets
// formatter.lineWidth to 100, but Biome cannot wrap a comment, so a long comment stays long until
// its author wraps it. A long code line with no comment is Biome's, never reported here.
//
// Usage: comment-line-width.js <file>...
//
// What counts:
//   - Columns are Unicode code points of the line without its trailing whitespace, so a Cyrillic
//     letter is one column, as Biome counts it. Biome counts an East Asian wide character or an
//     emoji as two columns; this checker counts one, so it never reports a line Biome would not.
//     A tab is one column (the tree is indented with spaces).
//   - Comment text is a REAL comment span found by specifier-scanner.js's blankNoise: a // line,
//     any line of a /* */ or /** */ block, a JSX {/* */} comment. A string, template or regex
//     literal that only looks like a comment never counts. JSX text holding `//` (a URL in
//     <Text>) reads as a comment start there, which blankNoise cannot tell apart.
//   - A line is reported when its comment text reaches past column 100. Code after a comment that
//     ends within 100 columns is Biome's.
//
// Exempt: a comment that cannot be wrapped. Take the comment as it would stand alone (a
// trailing comment moved to its own line at the line's indentation; any other line as it is).
// Drop its opener (//, ///, /*, /**, a leading *) and a closing */ as non-words; the rest are
// the words, split on whitespace. A wrap point exists when there are at least two words and the
// first word ends at column 100 or earlier: a break after it keeps the line within 100. The line
// is exempt only when the comment alone is over 100 columns AND it has no wrap point, as one long
// URL does. `// see https://...` still fails, since the words before the URL can wrap; after the
// wrap, `// https://...` is exempt. There is no inline override and no allowlist.
//
// Output: one `<path>:<line>: <columns> columns: <comment text>` line per finding, the comment
// text trimmed and without any line number so the pre-write guard can tell a moved line from a
// new one. Exit 0: clean. Exit 1: findings on stdout. Exit 2: a file could not be read.
//
// The checker is dependency-free (node:* only): the guard-replay scratch checkout has no
// node_modules.

const fs = require('node:fs');

const { commentSpans } = require('./specifier-scanner');

const LINE_WIDTH = 100;
const OPENER_PATTERN = /^(?:\/\/+|\/\*+|\*+)/;
const CLOSER_PATTERN = /\*\/$/;

const columnsOf = (text) => [...text].length;

function lineStartsOf(source) {
  const starts = [0];

  for (
    let cursor = source.indexOf('\n');
    cursor !== -1;
    cursor = source.indexOf('\n', cursor + 1)
  ) {
    starts.push(cursor + 1);
  }

  return starts;
}

function lineIndexAt(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (lineStarts[middle] <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return low;
}

// The part of each line a comment covers, as UTF-16 offsets within that line.
function segmentsByLine(source, spans) {
  const lineStarts = lineStartsOf(source);
  const segments = new Map();

  for (const span of spans) {
    const lastOffset = Math.max(span.start, span.end - 1);
    const lastLine = lineIndexAt(lineStarts, lastOffset);

    for (let line = lineIndexAt(lineStarts, span.start); line <= lastLine; line += 1) {
      const lineStart = lineStarts[line];
      const found = segments.get(line) ?? [];

      found.push({
        start: Math.max(span.start, lineStart) - lineStart,
        end: span.end - lineStart,
      });
      segments.set(line, found);
    }
  }

  return { lineStarts, segments };
}

function wordsOf(text) {
  const words = [...text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    end: match.index + match[0].length,
  }));
  const [first] = words;

  if (first !== undefined && first.text.replace(OPENER_PATTERN, '') === '') {
    words.shift();
  }

  const last = words[words.length - 1];

  if (last !== undefined && last.text.replace(CLOSER_PATTERN, '') === '') {
    words.pop();
  }

  return words;
}

function canBeWrapped(standalone) {
  const words = wordsOf(standalone);

  return words.length >= 2 && columnsOf(standalone.slice(0, words[0].end)) <= LINE_WIDTH;
}

// The end of the part of the line a comment is answerable for: the comment, plus the `}` that
// closes a JSX `{/* */}`, since that brace belongs to the comment and cannot be moved off it.
function overflowEndOf(trimmed, commentStart, commentEnd) {
  const opensJsxBrace = trimmed.slice(0, commentStart).trimEnd().endsWith('{');
  const closesJsxBrace = trimmed.slice(commentEnd).trimStart().startsWith('}');

  return opensJsxBrace && closesJsxBrace ? trimmed.indexOf('}', commentEnd) + 1 : commentEnd;
}

function checkLine(line, lineSegments) {
  const trimmed = line.trimEnd();
  const commentStart = Math.min(...lineSegments.map((segment) => segment.start));
  const commentEnd = Math.min(
    Math.max(...lineSegments.map((segment) => segment.end)),
    trimmed.length,
  );

  if (columnsOf(trimmed.slice(0, overflowEndOf(trimmed, commentStart, commentEnd))) <= LINE_WIDTH) {
    return undefined;
  }

  const hasCodeBefore = trimmed.slice(0, commentStart).trim() !== '';
  const indentation = trimmed.slice(0, trimmed.length - trimmed.trimStart().length);
  const standalone = hasCodeBefore
    ? `${indentation}${trimmed.slice(commentStart, commentEnd)}`
    : trimmed.slice(0, commentEnd);

  if (columnsOf(standalone) > LINE_WIDTH && !canBeWrapped(standalone)) {
    return undefined;
  }

  return { columns: columnsOf(trimmed), text: trimmed.slice(commentStart, commentEnd).trim() };
}

// Every line over the limit whose comment can be wrapped, as { line, columns, text }.
function findViolations(source) {
  const spans = commentSpans(source);

  if (spans.length === 0) {
    return [];
  }

  const { lineStarts, segments } = segmentsByLine(source, spans);
  const violations = [];

  for (const [lineIndex, lineSegments] of segments) {
    const lineEnd = lineStarts[lineIndex + 1] ?? source.length + 1;
    const line = source.slice(lineStarts[lineIndex], lineEnd - 1);
    const found = line.length > LINE_WIDTH ? checkLine(line, lineSegments) : undefined;

    if (found !== undefined) {
      violations.push({ line: lineIndex + 1, ...found });
    }
  }

  return violations.sort((left, right) => left.line - right.line);
}

function runCli() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    process.stderr.write('usage: comment-line-width.js <file>...\n');
    process.exit(2);
  }

  let found = false;

  for (const file of files) {
    let source;

    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (error) {
      process.stderr.write(`comment-line-width: could not read ${file}: ${error.message}\n`);
      process.exit(2);
    }

    for (const { line, columns, text } of findViolations(source)) {
      found = true;
      process.stdout.write(`${file}:${line}: ${columns} columns: ${text}\n`);
    }
  }

  process.exit(found ? 1 : 0);
}

if (require.main === module) {
  runCli();
}

module.exports = { findViolations };
