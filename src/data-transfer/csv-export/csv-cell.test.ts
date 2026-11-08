import Papa from 'papaparse';
import { parseAmountCell } from '@kiko/statement-import/column-mapping';

import { csvAmountCell, csvDialectOf, csvTextCell, type CsvDialect } from './csv-cell';

const ENGLISH: CsvDialect = { delimiter: ',', decimal: '.' };
const UKRAINIAN: CsvDialect = { delimiter: ';', decimal: ',' };

// A delimiter is named: left to guess, Papa takes the tab of a guarded cell for one.
const readBack = (cell: string): string =>
  Papa.parse<string[]>(cell, { delimiter: ',' }).data[0][0];

describe('csvDialectOf', () => {
  it('gives Ukrainian a semicolon delimiter and a decimal comma', () => {
    expect(csvDialectOf('uk')).toEqual(UKRAINIAN);
  });

  it('gives English a comma delimiter and a decimal point', () => {
    expect(csvDialectOf('en')).toEqual(ENGLISH);
  });

  it('gives a language the app does not ship the English dialect', () => {
    expect(csvDialectOf('de')).toEqual(ENGLISH);
  });
});

describe('csvTextCell', () => {
  it.each([
    ['=', '=SUM(A1)'],
    ['+', '+380501234567'],
    ['-', '-cmd'],
    ['@', '@handle'],
    ['a tab', '\tindented'],
    ['a carriage return', '\rreturned'],
  ])('prefixes a text that starts with %s', (_name, text) => {
    expect(readBack(csvTextCell(text))).toBe(`'${text}`);
  });

  it.each(['Coffee', 'a=b', 'a+b', 'a-b', 'a@b', ' =padded', "'quoted"])(
    'leaves %j without a prefix',
    (text) => {
      expect(readBack(csvTextCell(text))).toBe(text);
    },
  );

  it('writes an empty text as an empty cell', () => {
    expect(csvTextCell('')).toBe('');
  });

  it('keeps a text with the delimiter as one cell', () => {
    expect(readBack(csvTextCell('Milk, bread'))).toBe('Milk, bread');
    expect(Papa.parse<string[]>(csvTextCell('Milk, bread'), { delimiter: ',' }).data[0]).toEqual([
      'Milk, bread',
    ]);
  });

  it('keeps a text with a semicolon as one cell under the semicolon dialect', () => {
    expect(Papa.parse<string[]>(csvTextCell('Milk; bread'), { delimiter: ';' }).data[0]).toEqual([
      'Milk; bread',
    ]);
  });

  it('quotes a text with a comma or a semicolon, whatever the dialect', () => {
    expect(csvTextCell('a,b')).toBe('"a,b"');
    expect(csvTextCell('a;b')).toBe('"a;b"');
  });

  it('doubles a quote and wraps the cell', () => {
    expect(csvTextCell('say "hi"')).toBe('"say ""hi"""');
    expect(readBack(csvTextCell('say "hi"'))).toBe('say "hi"');
  });

  it('keeps a line feed, a carriage return and CRLF inside one cell', () => {
    expect(readBack(csvTextCell('one\ntwo'))).toBe('one\ntwo');
    expect(readBack(csvTextCell('one\r\ntwo'))).toBe('one\r\ntwo');
    expect(readBack(csvTextCell('one\rtwo'))).toBe('one\rtwo');
    expect(csvTextCell('one\ntwo')).toBe('"one\ntwo"');
  });

  it('guards and quotes a text that needs both', () => {
    expect(csvTextCell('=1,2')).toBe('"\'=1,2"');
  });

  it('writes plain text as it is', () => {
    expect(csvTextCell('Coffee')).toBe('Coffee');
  });
});

describe('csvAmountCell', () => {
  it('writes a fiat amount with its decimals', () => {
    expect(csvAmountCell(123_456, 'UAH', ENGLISH)).toBe('1234.56');
    expect(csvAmountCell(5, 'UAH', ENGLISH)).toBe('0.05');
    expect(csvAmountCell(0, 'UAH', ENGLISH)).toBe('0.00');
  });

  it('writes one satoshi as a plain decimal, never an exponent', () => {
    expect(csvAmountCell(1, 'BTC', ENGLISH)).toBe('0.00000001');
    expect(csvAmountCell(-1, 'BTC', ENGLISH)).toBe('-0.00000001');
  });

  it('writes a zero-decimal currency with no point', () => {
    expect(csvAmountCell(5_000, 'JPY', ENGLISH)).toBe('5000');
    expect(csvAmountCell(-5_000, 'JPY', UKRAINIAN)).toBe('-5000');
  });

  it('writes a negative amount with an ASCII minus', () => {
    const cell = csvAmountCell(-123_456, 'UAH', ENGLISH);

    expect(cell).toBe('-1234.56');
    expect(cell.charCodeAt(0)).toBe(0x2d);
  });

  it('writes the decimal comma of the Ukrainian dialect', () => {
    expect(csvAmountCell(-123_456, 'UAH', UKRAINIAN)).toBe('-1234,56');
    expect(csvAmountCell(1, 'BTC', UKRAINIAN)).toBe('0,00000001');
  });

  it('never prefixes a negative amount', () => {
    expect(csvAmountCell(-100, 'UAH', ENGLISH).startsWith("'")).toBe(false);
    expect(csvAmountCell(-100, 'UAH', UKRAINIAN).startsWith("'")).toBe(false);
  });

  it.each([
    [ENGLISH, '.'],
    [UKRAINIAN, ','],
  ] as const)('reads back through the import amount parser under %j', (dialect, separator) => {
    expect(parseAmountCell(csvAmountCell(-123_456, 'UAH', dialect), separator)).toBe(-1234.56);
  });
});
