#!/usr/bin/env node

// Mechanizes kiko-code-style's "Import ordering" rule (hand-enforced, not
// covered by Biome's organizeImports — see biome.json's
// assist.actions.source.organizeImports.level: "off"). Checks (and, given
// --write, fixes) the LEADING import header of a .ts/.tsx file: 3 groups
// (external / ../** parent-relative / ./** sibling-relative), each separated
// by a blank line, sorted ASCENDING within each group by the length of the
// statement's ENDING physical line (the whole line for a single-line import,
// the `} from '...';` closing line for a wrapped one), value imports before
// `import type` only as an equal-length tiebreaker, and a bare side-effect
// import (no specifiers) as a hard ordering BARRIER that splits its group
// into independently-sorted before/after partitions rather than being
// sorted itself.
//
// A comment run directly above the FIRST import of a group is a "block
// prefix" — pinned, never reordered, never treated as attached to the import
// beneath it (this is what keeps a file's own header doc-comment, or a
// group-introducing comment, from being dragged out of place if that first
// import needs to move). A comment run anywhere else inside a group (glued
// to a non-first import in that group) makes the group UNSAFE to auto-fix —
// `--write` leaves that file's imports untouched rather than guess where the
// comment should travel — while the checker still evaluates order across
// it, since detecting a violation does not require moving anything.

const fs = require('node:fs');

function isBlank(line) {
  return /^\s*$/.test(line);
}

function isLineComment(line) {
  return /^\s*\/\//.test(line);
}

function isBlockCommentOpen(line) {
  return /^\s*\/\*/.test(line);
}

function isImportOpen(line) {
  return /^\s*import\b/.test(line);
}

function endsStatement(line) {
  return /;\s*$/.test(line);
}

// Each `consume*` returns the END index (exclusive) of the run starting at
// `start` — one line for a blank, the matching `*/` line for a block
// comment, the last contiguous `//` line for a line-comment run, and the
// line ending the statement (`;`) for an import, wrapped or not.
function consumeBlockComment(lines, start) {
  let i = start;
  while (i < lines.length && !/\*\//.test(lines[i])) {
    i += 1;
  }

  return Math.min(i + 1, lines.length);
}

function consumeLineComment(lines, start) {
  let i = start;
  while (i < lines.length && isLineComment(lines[i])) {
    i += 1;
  }

  return i;
}

function consumeImport(lines, start) {
  let i = start;
  while (i < lines.length && !endsStatement(lines[i])) {
    i += 1;
  }

  return Math.min(i + 1, lines.length);
}

// Reads forward from the top of the file, classifying the leading run as a
// sequence of raw entries ({ kind: 'blank' | 'comment' | 'import', lines }).
// Stops (returns { entries, headerEnd }) at the first line that is none of
// blank/comment/import — the header ends there, exclusive.
function parseHeaderEntries(lines) {
  const entries = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      entries.push({ kind: 'blank', lines: [line] });
      i += 1;
      continue;
    }

    if (isBlockCommentOpen(line)) {
      const end = consumeBlockComment(lines, i);
      entries.push({ kind: 'comment', lines: lines.slice(i, end) });
      i = end;
      continue;
    }

    if (isLineComment(line)) {
      const end = consumeLineComment(lines, i);
      entries.push({ kind: 'comment', lines: lines.slice(i, end) });
      i = end;
      continue;
    }

    if (isImportOpen(line)) {
      const end = consumeImport(lines, i);
      entries.push({ kind: 'import', lines: lines.slice(i, end) });
      i = end;
      continue;
    }

    break;
  }

  return { entries, headerEnd: i };
}

function isSideEffectImport(statementLines) {
  return (
    statementLines.length === 1 && /^\s*import\s+['"][^'"]+['"]\s*;?\s*$/.test(statementLines[0])
  );
}

function isTypeOnlyImport(statementLines) {
  return /^\s*import\s+type\b/.test(statementLines[0] ?? '');
}

function sortKey(statementLines) {
  const endingLine = statementLines[statementLines.length - 1] ?? '';

  return [endingLine.length, isTypeOnlyImport(statementLines) ? 1 : 0];
}

function compareKeys(a, b) {
  if (a[0] !== b[0]) {
    return a[0] - b[0];
  }

  return a[1] - b[1];
}

// Splits the header entries (blank-separated) into groups, each a plain
// array of 'comment'/'import' entries (blanks consumed as separators).
function splitIntoGroups(entries) {
  const groups = [];
  let current = [];

  for (const entry of entries) {
    if (entry.kind === 'blank') {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
      continue;
    }

    current.push(entry);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

// Reduces one group's entries into { prefix, items, interiorComment } —
// `prefix` is the pinned leading comment run (if any), `items` are
// { comments, statementLines } pairs in original order, and
// `interiorComment` is true when a comment run appears anywhere after the
// prefix — whether or not an import follows it. A comment run with NO
// import after it (a group that is entirely comments, or a comment that
// trails the group's last import) has nowhere safe to attach: dropping it
// from `items` would silently delete it from the rebuilt file the moment
// --write touches ANY other group in the same file (fixImportOrder only
// gates a whole-file rewrite on whether an INDIVIDUAL group's items
// changed, so a lossy group with an unchanged, empty `items` list would
// never trip that gate on its own). Marking it unsafe unconditionally
// means fixImportOrder always returns such a group's original lines
// untouched instead of guessing where an orphaned comment belongs.
function analyzeGroup(entries) {
  let index = 0;
  let prefix = null;

  if (entries[0]?.kind === 'comment') {
    prefix = entries[0].lines;
    index = 1;
  }

  const items = [];
  let pendingComments = [];
  let interiorComment = false;

  for (; index < entries.length; index += 1) {
    const entry = entries[index];

    if (entry.kind === 'comment') {
      pendingComments = entry.lines;
      interiorComment = true;
      continue;
    }

    items.push({ comments: pendingComments, statementLines: entry.lines });
    pendingComments = [];
  }

  return { prefix, items, interiorComment };
}

// Partitions `items` at each side-effect import — that entry stays in place,
// splitting its neighbors into independently-checked/sorted sub-sequences.
function partitionAtBarriers(items) {
  const partitions = [];
  let current = [];

  for (const item of items) {
    if (isSideEffectImport(item.statementLines)) {
      partitions.push({ kind: 'sortable', items: current });
      partitions.push({ kind: 'barrier', items: [item] });
      current = [];
      continue;
    }

    current.push(item);
  }

  partitions.push({ kind: 'sortable', items: current });

  return partitions;
}

// How many blank-line entries trail the LAST group in the header — the gap
// between the import block and whatever code follows it. splitIntoGroups
// discards trailing blanks as pure separators (there is no group after them
// to separate), so the rebuild step needs this to restore that gap exactly,
// rather than assuming there is always exactly one blank line there.
function trailingBlankCount(entries) {
  let count = 0;

  for (let i = entries.length - 1; i >= 0 && entries[i].kind === 'blank'; i -= 1) {
    count += 1;
  }

  return count;
}

function isSorted(items) {
  for (let i = 1; i < items.length; i += 1) {
    if (compareKeys(sortKey(items[i - 1].statementLines), sortKey(items[i].statementLines)) > 0) {
      return false;
    }
  }

  return true;
}

function checkImportOrder(source) {
  const lines = source.split('\n');
  const { entries } = parseHeaderEntries(lines);
  const groups = splitIntoGroups(entries);
  const violations = [];

  groups.forEach((groupEntries, groupIndex) => {
    const { items } = analyzeGroup(groupEntries);

    for (const partition of partitionAtBarriers(items)) {
      if (partition.kind === 'sortable' && !isSorted(partition.items)) {
        violations.push(
          `group ${groupIndex + 1}: not sorted ascending by ending-line length — ` +
            partition.items
              .map((item) => item.statementLines[item.statementLines.length - 1])
              .join(' | '),
        );
      }
    }
  });

  return violations;
}

// Reorders every SAFE group's items (stable sort by sortKey, partitioned at
// barriers) and reassembles the file. A group with an interior comment is
// left completely untouched. Returns { text, changed, unsafeGroups }.
function fixImportOrder(source) {
  const lines = source.split('\n');
  const { entries, headerEnd } = parseHeaderEntries(lines);
  const groups = splitIntoGroups(entries);
  let unsafeGroups = 0;
  let changed = false;

  const rebuiltGroups = groups.map((groupEntries) => {
    const { prefix, items, interiorComment } = analyzeGroup(groupEntries);

    if (interiorComment) {
      unsafeGroups += 1;

      return groupEntries.flatMap((entry) => entry.lines);
    }

    const rebuiltItems = partitionAtBarriers(items).flatMap((partition) => {
      if (partition.kind === 'barrier') {
        return partition.items;
      }

      return [...partition.items].sort((a, b) =>
        compareKeys(sortKey(a.statementLines), sortKey(b.statementLines)),
      );
    });

    const before = items.map((item) => item.statementLines.join('\n')).join('\n');
    const after = rebuiltItems.map((item) => item.statementLines.join('\n')).join('\n');
    if (before !== after) {
      changed = true;
    }

    const prefixLines = prefix ?? [];

    return [
      ...prefixLines,
      ...rebuiltItems.flatMap((item) => [...item.comments, ...item.statementLines]),
    ];
  });

  const rebuiltHeader = rebuiltGroups.flatMap((group, index) =>
    index === 0 ? group : ['', ...group],
  );
  const rest = lines.slice(headerEnd);
  const gap = Array(trailingBlankCount(entries)).fill('');
  const text = [...rebuiltHeader, ...gap, ...rest].join('\n');

  return { text, changed, unsafeGroups };
}

module.exports = { checkImportOrder, fixImportOrder };

function runCli() {
  const write = process.argv.includes('--write');
  const files = process.argv.slice(2).filter((arg) => arg !== '--write');

  if (files.length === 0) {
    process.stderr.write('usage: import-order.js [--write] <file...>\n');
    process.exit(2);
  }

  let anyViolation = false;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');

    if (write) {
      const { text, changed } = fixImportOrder(source);
      if (changed) {
        fs.writeFileSync(file, text);
        process.stdout.write(`fixed: ${file}\n`);
      }
      continue;
    }

    const violations = checkImportOrder(source);

    if (violations.length > 0) {
      anyViolation = true;
      process.stdout.write(`${file}:\n${violations.map((v) => `  ${v}`).join('\n')}\n`);
    }
  }

  process.exit(anyViolation ? 1 : 0);
}

if (require.main === module) {
  runCli();
}
