#!/usr/bin/env node

// Fails when a physical line over 100 columns holds comment text. biome.json sets
// formatter.lineWidth to 100, but Biome cannot wrap a comment, so a long comment stays long until
// its author wraps it. A long code line with no comment is Biome's, never reported here.
//
// Usage: comment-line-width.js <file>...
//
// Two comment syntaxes, chosen by the file:
//   - `#` comments in a shell or YAML file: a `.sh`, `.bash`, `.yml` or `.yaml` file, or an
//     extensionless file whose first line is a `#!` line naming sh, bash, zsh or dash. A comment
//     line is a line whose first non-blank character is `#`, except a `#!` on line 1. A trailing
//     `#` after code, or a `#` inside a string, is not read. Everything below about columns, the
//     wrap point and the output holds for these lines too, with `#`, `##`, ... as the opener.
//   - `//` and `/* */` comments in every other file, as described next.
//
// What counts (`//` and `/* */`):
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
// wrap, `// https://...` is exempt. A JSX `{/* */}` comment is measured with its braces in both
// the overflow and the standalone measure, since the braces cannot be moved off it. There is no
// inline override and no allowlist.
//
// Output: one `<path>:<line>: <columns> columns: <comment text>` line per finding. The comment
// text is each comment on the line, trimmed, joined with a single space: it holds no line number
// and none of the code between two comments, so the pre-write guard can tell a moved line or a
// renamed identifier from a reworded comment. Exit 0: clean. Exit 1: findings on stdout. Exit 2:
// a file could not be read.
//
// The checker is dependency-free (node:* only): the guard-replay scratch checkout has no
// node_modules.

const fs = require('node:fs');

const { commentSpans } = require('./specifier-scanner');

const LINE_WIDTH = 100;
const SLASH_SYNTAX = { opener: /^\{?(?:\/\/+|\/\*+|\*+)/, closer: /\*\/\}?$/ };
// A `#` comment has no closing marker, so no word of it is dropped as one.
const HASH_SYNTAX = { opener: /^#+/, closer: undefined };
const HASH_FILE_PATTERN = /\.(?:sh|bash|ya?ml)$/;
const SHELL_SHEBANG_PATTERN = /^#!\s*(?:\S*\/)?(?:env\s+)?(?:sh|bash|zsh|dash)(?:\s|$)/;

const columnsOf = (text) => [...text].length;

const lastOffsetOf = (span) => Math.max(span.start, span.end - 1);

function wordsOf(text, syntax) {
  const words = [...text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    end: match.index + match[0].length,
  }));
  const [first] = words;

  if (first !== undefined && first.text.replace(syntax.opener, '') === '') {
    words.shift();
  }

  const last = words[words.length - 1];

  if (
    syntax.closer !== undefined &&
    last !== undefined &&
    last.text.replace(syntax.closer, '') === ''
  ) {
    words.pop();
  }

  return words;
}

function canBeWrapped(standalone, syntax) {
  const words = wordsOf(standalone, syntax);

  return words.length >= 2 && columnsOf(standalone.slice(0, words[0].end)) <= LINE_WIDTH;
}

// The line the comment would stand on alone, and the end of the part of the line it is answerable
// for. A JSX `{/* */}` keeps its braces in both: they belong to the comment and cannot be moved
// off it. A brace set apart from the comment by a space (`{ /* */ }`) is skipped: in JSX Biome
// tightens it to `{/*…*/}`, which ends at the same column, and in `function f() { /* */ }` it
// belongs to the block, which Biome leaves as it is. A trailing comment moves to its own line at
// the line's indentation.
function measureComment(trimmed, commentStart, commentEnd) {
  const indentation = trimmed.slice(0, trimmed.length - trimmed.trimStart().length);
  const comment = trimmed.slice(commentStart, commentEnd);
  const opensJsxBrace = trimmed[commentStart - 1] === '{';
  const closesJsxBrace = trimmed[commentEnd] === '}';

  if (opensJsxBrace && closesJsxBrace) {
    return {
      overflowEnd: commentEnd + 1,
      standalone: `${indentation}{${comment}}`,
    };
  }

  const hasCodeBefore = trimmed.slice(0, commentStart).trim() !== '';

  return {
    overflowEnd: commentEnd,
    standalone: hasCodeBefore ? `${indentation}${comment}` : trimmed.slice(0, commentEnd),
  };
}

function checkLine(line, lineSegments, syntax) {
  const trimmed = line.trimEnd();
  const commentStart = Math.min(...lineSegments.map((segment) => segment.start));
  const commentEnd = Math.min(
    Math.max(...lineSegments.map((segment) => segment.end)),
    trimmed.length,
  );
  const { overflowEnd, standalone } = measureComment(trimmed, commentStart, commentEnd);

  if (columnsOf(trimmed.slice(0, overflowEnd)) <= LINE_WIDTH) {
    return undefined;
  }

  if (columnsOf(standalone) > LINE_WIDTH && !canBeWrapped(standalone, syntax)) {
    return undefined;
  }

  const text = lineSegments
    .map((segment) => trimmed.slice(segment.start, segment.end).trim())
    .join(' ');

  return { columns: columnsOf(trimmed), text };
}

// The `#` comment spans of a shell or YAML source: every line whose first non-blank character is
// `#`, except a `#!` on line 1. The span runs from the `#` to the end of the line.
function hashCommentSpans(source) {
  const spans = [];
  let lineStart = 0;

  for (const [lineIndex, line] of source.split('\n').entries()) {
    const start = lineStart + line.length - line.trimStart().length;

    if (line.trimStart().startsWith('#') && !(lineIndex === 0 && line.startsWith('#!'))) {
      spans.push({ start, end: lineStart + line.length });
    }

    lineStart += line.length + 1;
  }

  return spans;
}

// The comment syntax a file uses: `#` for a shell or YAML file (by extension, or by a shell
// shebang on an extensionless file), `//` and `/* */` for everything else.
function syntaxOf(file, source) {
  const isShellScript =
    HASH_FILE_PATTERN.test(file) ||
    (!/\.[^/]*$/.test(file) && SHELL_SHEBANG_PATTERN.test(source.split('\n', 1)[0]));

  return isShellScript ? HASH_SYNTAX : SLASH_SYNTAX;
}

// Every line over the limit whose comment can be wrapped, as { line, columns, text }. The spans
// arrive in file order and never overlap, so one sweep over the lines with a running offset pairs
// each line with the comments that touch it.
function findViolations(source, syntax = SLASH_SYNTAX) {
  const spans = syntax === HASH_SYNTAX ? hashCommentSpans(source) : commentSpans(source);
  const violations = [];
  let firstSpan = 0;
  let lineStart = 0;

  for (const [lineIndex, line] of source.split('\n').entries()) {
    const nextLineStart = lineStart + line.length + 1;

    while (firstSpan < spans.length && lastOffsetOf(spans[firstSpan]) < lineStart) {
      firstSpan += 1;
    }

    const lineSegments = [];

    for (
      let index = firstSpan;
      index < spans.length && spans[index].start < nextLineStart;
      index += 1
    ) {
      lineSegments.push({
        start: Math.max(spans[index].start, lineStart) - lineStart,
        end: spans[index].end - lineStart,
      });
    }

    const found =
      lineSegments.length > 0 && line.length > LINE_WIDTH
        ? checkLine(line, lineSegments, syntax)
        : undefined;

    if (found !== undefined) {
      violations.push({ line: lineIndex + 1, ...found });
    }

    lineStart = nextLineStart;
  }

  return violations;
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

    for (const { line, columns, text } of findViolations(source, syntaxOf(file, source))) {
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
