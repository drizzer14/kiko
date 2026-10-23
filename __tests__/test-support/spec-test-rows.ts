// The Test cells of a spec table name a test file and quote the titles in it. A cell that names a
// file by half a path, or quotes a title the file does not hold, reads as proof while it proves
// nothing; these functions let a suite fail it.

import maybe, { foldMap } from 'fnts/maybe';

export type TestRow = { id: string; cell: string };

type CellPart = { kind: 'code'; text: string } | { kind: 'title'; text: string };

const BINANCE_DIRECTORY = 'src/crypto-sync/binance/';
const TEST_FILE_NAME = /\.test\.tsx?$/;
const CELL_PART = /`([^`]+)`|"([^"]+)"/g;

const splitCells = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inCode = false;

  for (const character of line.trim().replace(/^\|/, '').replace(/\|$/, '')) {
    if (character === '`') {
      inCode = !inCode;
    }

    if (character === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }

  return [...cells, current.trim()];
};

/** The rows of the tables of the section at `heading` whose last header cell is `Test`. */
export const testRowsOf = (markdown: string, heading: string): TestRow[] => {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith(heading));
  const length = lines.slice(start + 1).findIndex((line) => line.startsWith('## '));
  const section = lines.slice(start + 1, length === -1 ? undefined : start + 1 + length);
  const rows: TestRow[] = [];
  let inTestTable = false;

  for (const line of section) {
    const cells = splitCells(line);

    if (!line.startsWith('|')) {
      inTestTable = false;
    } else if (inTestTable && !/^\|[-| ]+\|$/.test(line)) {
      rows.push({ id: cells[0] ?? '', cell: cells.at(-1) ?? '' });
    } else if (!inTestTable) {
      inTestTable = cells.at(-1) === 'Test';
    }
  }

  return rows;
};

const partsOf = (cell: string): CellPart[] =>
  [...cell.matchAll(CELL_PART)].map(
    (found): CellPart =>
      found[1] === undefined
        ? { kind: 'title', text: found[2] ?? '' }
        : { kind: 'code', text: found[1] },
  );

const closingQuoteOf = (source: string, quoteIndex: number): number => {
  const quote = source[quoteIndex];
  let index = quoteIndex + 1;

  while (index < source.length && source[index] !== quote) {
    index += source[index] === '\\' ? 2 : 1;
  }

  return index;
};

const closingBracketOf = (source: string, openIndex: number): number => {
  let depth = 0;
  let index = openIndex;

  while (index < source.length) {
    const character = source[index];

    if (character === "'" || character === '"' || character === '`') {
      index = closingQuoteOf(source, index);
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }

    index += 1;
  }

  return index;
};

const CALL_START = /(?<![\w$.])(?:it|test|describe)(\.each)?\(/g;

/** The first-argument text literal of every it, test and describe call, `.each(...)(` included. */
export const titlesOf = (source: string): string[] =>
  [...source.matchAll(CALL_START)].flatMap((call) => {
    const afterCall = (call.index ?? 0) + call[0].length;
    const argumentsStart =
      call[1] === undefined
        ? afterCall
        : source.indexOf('(', closingBracketOf(source, afterCall - 1) + 1) + 1;
    const blanks = source.slice(argumentsStart).match(/^\s*/)?.[0].length ?? 0;
    const quoteIndex = argumentsStart + blanks;

    return /['"`]/.test(source[quoteIndex] ?? '')
      ? [source.slice(quoteIndex + 1, closingQuoteOf(source, quoteIndex))]
      : [];
  });

const pathOf = (name: string): string | undefined => {
  if (name.startsWith('src/')) {
    return name;
  }

  return name.includes('/') ? undefined : `${BINANCE_DIRECTORY}${name}`;
};

type Reading = {
  problems: string[];
  files: Map<string, string[]>;
  currentFile: string | undefined;
  /** The file a same row took from the row above, until the cell names a file of its own. */
  inheritedFile: string | undefined;
};

const readCodePart = (row: TestRow, reading: Reading, name: string): void => {
  if (!TEST_FILE_NAME.test(name)) {
    if (name.includes('/')) {
      reading.problems.push(`${row.id}: ${name} is not a test file path`);
    }

    return;
  }

  const inherited = reading.inheritedFile;

  if (inherited !== undefined && reading.files.get(inherited)?.length === 0) {
    reading.files.delete(inherited);
  }

  reading.inheritedFile = undefined;
  reading.currentFile = pathOf(name);

  if (reading.currentFile === undefined) {
    reading.problems.push(`${row.id}: ${name} is a partial path`);
  } else if (!reading.files.has(reading.currentFile)) {
    reading.files.set(reading.currentFile, []);
  }
};

const readTitlePart = (row: TestRow, reading: Reading, title: string): void => {
  if (reading.currentFile === undefined) {
    reading.problems.push(`${row.id}: "${title}" follows no test file`);
  } else {
    const titles = reading.files.get(reading.currentFile) ?? [];

    reading.files.set(reading.currentFile, [...titles, title]);
  }
};

const readCell = (row: TestRow, previousFile: string | undefined): Reading => {
  const currentFile = row.cell.trimStart().startsWith('same') ? previousFile : undefined;
  const inherited = foldMap(maybe(currentFile), (file): [string, string[]][] => [[file, []]]);
  const reading: Reading = {
    problems: [],
    files: new Map(inherited ?? []),
    currentFile,
    inheritedFile: currentFile,
  };

  for (const part of partsOf(row.cell)) {
    if (part.kind === 'code') {
      readCodePart(row, reading, part.text);
    } else {
      readTitlePart(row, reading, part.text);
    }
  }

  return reading;
};

/**
 * What is wrong with the Test cells: a file named by a partial path or missing, a row that quotes
 * no title, a named file with no title quoted after it, a title the file does not hold as an
 * `it`, `test` or `describe` title. A cell that starts with `same` takes the first file of the
 * row above until it names one itself.
 */
export const rowProblems = (
  rows: TestRow[],
  sourceOf: (path: string) => string | undefined,
): string[] => {
  let previousFile: string | undefined;

  return rows.flatMap((row) => {
    const { problems, files } = readCell(row, previousFile);

    previousFile = [...files.keys()][0] ?? previousFile;

    return [
      ...problems,
      ...([...files.values()].flat().length === 0 ? [`${row.id}: quotes no title`] : []),
      ...[...files].flatMap(([path, titles]) => {
        const source = sourceOf(path);

        if (source === undefined) {
          return [`${row.id}: ${path} does not exist`];
        }

        const held = titlesOf(source);

        return [
          ...(titles.length === 0 ? [`${row.id}: ${path} has no title quoted after it`] : []),
          ...titles
            .filter((title) => !held.includes(title))
            .map((title) => `${row.id}: "${title}" is no title in ${path}`),
        ];
      }),
    ];
  });
};
