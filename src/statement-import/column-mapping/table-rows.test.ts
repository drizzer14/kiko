import type { StatementFormatInput } from '../parser';

import { guessHeaderRowIndex, readTableRows } from './table-rows';

describe('readTableRows (CSV)', () => {
  it('splits comma-delimited text into rows given an explicit delimiter', () => {
    const input: StatementFormatInput = { text: 'a,b,c\n1,2,3', fileName: 'sample.csv' };

    const result = readTableRows(input, ',');

    expect(result.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(result.delimiter).toBe(',');
  });

  it('splits semicolon-delimited text into rows given an explicit delimiter', () => {
    const input: StatementFormatInput = { text: 'a;b;c\n1;2;3', fileName: 'sample.csv' };

    const result = readTableRows(input, ';');

    expect(result.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('detects the delimiter when none is given', () => {
    const input: StatementFormatInput = { text: 'a;b;c\n1;2;3', fileName: 'sample.csv' };

    const result = readTableRows(input);

    expect(result.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(result.delimiter).toBe(';');
  });

  it('skips empty lines', () => {
    const input: StatementFormatInput = { text: 'a,b\n\n1,2\n', fileName: 'sample.csv' };

    const result = readTableRows(input, ',');

    expect(result.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('readTableRows (sheetRows)', () => {
  it('keeps a number cell as a number, not a string', () => {
    const input: StatementFormatInput = {
      text: '',
      fileName: 'sample.xlsx',
      sheetRows: [[123.45, 'label']],
    };

    const result = readTableRows(input);

    expect(result.rows).toEqual([[123.45, 'label']]);
    expect(typeof result.rows[0][0]).toBe('number');
  });

  it('reads a Date cell as YYYY-MM-DD HH:MM:SS from its UTC parts', () => {
    const input: StatementFormatInput = {
      text: '',
      fileName: 'sample.xlsx',
      sheetRows: [[new Date(Date.UTC(2025, 6, 2, 9, 5, 3))]],
    };

    const result = readTableRows(input);

    expect(result.rows).toEqual([['2025-07-02 09:05:03']]);
  });

  // A spreadsheet Date cell with no time part arrives as exact UTC midnight.
  it('reads a Date cell with no time part as a date-only YYYY-MM-DD', () => {
    const input: StatementFormatInput = {
      text: '',
      fileName: 'sample.xlsx',
      sheetRows: [[new Date(Date.UTC(2025, 6, 2))]],
    };

    const result = readTableRows(input);

    expect(result.rows).toEqual([['2025-07-02']]);
  });

  it('converts a null cell to an empty string', () => {
    const input: StatementFormatInput = { text: '', fileName: 'sample.xlsx', sheetRows: [[null]] };

    const result = readTableRows(input);

    expect(result.rows).toEqual([['']]);
  });

  it('converts a boolean cell to a string', () => {
    const input: StatementFormatInput = { text: '', fileName: 'sample.xlsx', sheetRows: [[true]] };

    const result = readTableRows(input);

    expect(result.rows).toEqual([['true']]);
  });
});

describe('guessHeaderRowIndex', () => {
  it('picks the first of the first 10 rows with the most non-empty cells', () => {
    const rows = [['only one'], ['a', 'b', 'c', 'd'], ['x', 'y']];

    expect(guessHeaderRowIndex(rows)).toBe(1);
  });

  it('picks the earliest row on a tie', () => {
    const rows = [
      ['a', 'b'],
      ['c', 'd'],
    ];

    expect(guessHeaderRowIndex(rows)).toBe(0);
  });

  it('never looks past the first 10 rows', () => {
    const rows = [...Array.from({ length: 10 }, () => ['a']), ['a', 'b', 'c', 'd', 'e']];

    expect(guessHeaderRowIndex(rows)).toBe(0);
  });
});
