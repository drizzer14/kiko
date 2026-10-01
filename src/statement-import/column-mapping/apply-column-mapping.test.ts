import { withDeviceZoneOffset } from '@kiko/test-support/device-zone-offset';

import { computeDedupKey } from '../mapping';
import { StatementParseError } from '../parser';

import { readTableRows, type TableCell } from './table-rows';
import { applyColumnMapping, type ColumnMapping } from './apply-column-mapping';

// Column mapping reads a date/time cell as Kyiv time, and `jest.config.js`
// pins the process to Europe/Kyiv, so the local `Date` constructor here
// gives exactly that reading.
const localSeconds = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number => new Date(year, month - 1, day, hour, minute, second).getTime() / 1000;

const HEADER_ROW: TableCell[] = ['Date', 'Description', 'Amount', 'Currency', 'Counterparty'];

const singleAmountMapping: ColumnMapping = {
  headerRowIndex: 0,
  decimalSeparator: '.',
  dateColumn: 0,
  dateFormat: 'DD.MM.YYYY HH:MM:SS',
  amount: { mode: 'single', column: 2 },
  descriptionColumn: 1,
  currency: { mode: 'fixed', currency: 'UAH' },
};

describe('applyColumnMapping (single-amount mode)', () => {
  it('maps a single resolvable row to a ParsedStatement transaction', () => {
    const rows: TableCell[][] = [HEADER_ROW, ['01.07.2025 10:15:00', 'Coffee', 123.45, 'UAH', '']];

    const { statement, rowErrors } = applyColumnMapping(rows, singleAmountMapping);

    expect(rowErrors).toEqual([]);
    expect(statement.formatId).toBe('column-mapping');
    expect(statement.account.currency).toBe('UAH');
    expect(statement.transactions).toEqual([
      {
        currency: 'UAH',
        amountMinorUnits: 12_345,
        timeSeconds: localSeconds(2025, 7, 1, 10, 15, 0),
        description: 'Coffee',
      },
    ]);
  });

  it("reports a 'date' rowError with the 1-based file row for an unparseable date, and drops the row", () => {
    const rows: TableCell[][] = [HEADER_ROW, ['not-a-date', 'Coffee', '123.45', 'UAH', '']];

    const { statement, rowErrors } = applyColumnMapping(rows, singleAmountMapping);

    expect(statement.transactions).toEqual([]);
    expect(rowErrors).toEqual([{ rowNumber: 2, reason: 'date', value: 'not-a-date' }]);
  });

  it("reports an 'amount' rowError for an unparseable amount cell", () => {
    const rows: TableCell[][] = [
      HEADER_ROW,
      ['01.07.2025 10:15:00', 'Coffee', 'garbage', 'UAH', ''],
    ];

    const { statement, rowErrors } = applyColumnMapping(rows, singleAmountMapping);

    expect(statement.transactions).toEqual([]);
    expect(rowErrors).toEqual([{ rowNumber: 2, reason: 'amount', value: 'garbage' }]);
  });

  it('skips a blank trailing row silently, with no rowError', () => {
    const rows: TableCell[][] = [
      HEADER_ROW,
      ['01.07.2025 10:15:00', 'Coffee', 123.45, 'UAH', ''],
      ['', '', '', '', ''],
    ];

    const { statement, rowErrors } = applyColumnMapping(rows, singleAmountMapping);

    expect(statement.transactions).toHaveLength(1);
    expect(rowErrors).toEqual([]);
  });

  it("resolves a currency word via CURRENCY_WORD_MAP ('грн' -> UAH)", () => {
    const wordCurrencyMapping: ColumnMapping = {
      ...singleAmountMapping,
      currency: { mode: 'column', column: 3 },
    };
    const rows: TableCell[][] = [HEADER_ROW, ['01.07.2025 10:15:00', 'Coffee', 123.45, 'грн', '']];

    const { statement, rowErrors } = applyColumnMapping(rows, wordCurrencyMapping);

    expect(rowErrors).toEqual([]);
    expect(statement.transactions[0].currency).toBe('UAH');
    expect(statement.account.currency).toBe('UAH');
  });

  it("reports a 'currency' rowError for a word CURRENCY_WORD_MAP doesn't cover ('фунт')", () => {
    const wordCurrencyMapping: ColumnMapping = {
      ...singleAmountMapping,
      currency: { mode: 'column', column: 3 },
    };
    const rows: TableCell[][] = [
      HEADER_ROW,
      ['01.07.2025 10:15:00', 'Coffee', 123.45, 'грн', ''],
      ['02.07.2025 10:15:00', 'Tea', 50, 'фунт', ''],
    ];

    const { rowErrors } = applyColumnMapping(rows, wordCurrencyMapping);

    expect(rowErrors).toEqual([{ rowNumber: 3, reason: 'currency', value: 'фунт' }]);
  });

  it('routes a counterparty IBAN-shaped value to counterIban', () => {
    const withCounterparty: ColumnMapping = { ...singleAmountMapping, counterpartyColumn: 4 };
    const rows: TableCell[][] = [
      HEADER_ROW,
      ['01.07.2025 10:15:00', 'Coffee', 123.45, 'UAH', 'UA733220010000026201112223334'],
    ];

    const { statement } = applyColumnMapping(rows, withCounterparty);

    expect(statement.transactions[0].counterIban).toBe('UA733220010000026201112223334');
    expect(statement.transactions[0].comment).toBeUndefined();
  });

  it('routes a non-IBAN counterparty value to comment', () => {
    const withCounterparty: ColumnMapping = { ...singleAmountMapping, counterpartyColumn: 4 };
    const rows: TableCell[][] = [
      HEADER_ROW,
      ['01.07.2025 10:15:00', 'Coffee', 123.45, 'UAH', 'ATB Market'],
    ];

    const { statement } = applyColumnMapping(rows, withCounterparty);

    expect(statement.transactions[0].comment).toBe('ATB Market');
    expect(statement.transactions[0].counterIban).toBeUndefined();
  });

  it('reads the 1-based file rowNumber counting every row, including the header', () => {
    const rows: TableCell[][] = [
      HEADER_ROW,
      ['01.07.2025 10:15:00', 'Coffee', 123.45, 'UAH', ''],
      ['not-a-date', 'Tea', 100, 'UAH', ''],
    ];

    const { rowErrors } = applyColumnMapping(rows, singleAmountMapping);

    expect(rowErrors).toEqual([{ rowNumber: 3, reason: 'date', value: 'not-a-date' }]);
  });

  // The account currency is resolved directly off the mapped currency
  // COLUMN's own cells, independent of whether a row's date/amount also
  // resolves — a wrong date format failing every row must never also blame
  // a currency column that is genuinely fine, and a real date error must
  // never be swallowed by a throw the currency column had nothing to do
  // with.
  it('resolves the account currency straight off the currency column, even when every row fails on an unrelated field', () => {
    const columnCurrencyMapping: ColumnMapping = {
      ...singleAmountMapping,
      // A date format that matches none of the fixture's 'DD.MM.YYYY
      // HH:MM:SS' cells.
      dateFormat: 'YYYY-MM-DD',
      currency: { mode: 'column', column: 3 },
    };
    const rows: TableCell[][] = [
      HEADER_ROW,
      ['01.07.2025 10:15:00', 'Coffee', 123.45, 'UAH', ''],
      ['02.07.2025 10:15:00', 'Tea', 50, 'UAH', ''],
    ];

    const { statement, rowErrors } = applyColumnMapping(rows, columnCurrencyMapping);

    expect(statement.account.currency).toBe('UAH');
    expect(statement.transactions).toEqual([]);
    expect(rowErrors).toEqual([
      { rowNumber: 2, reason: 'date', value: '01.07.2025 10:15:00' },
      { rowNumber: 3, reason: 'date', value: '02.07.2025 10:15:00' },
    ]);
  });

  it('still throws when the currency column resolves to no known code anywhere in the file', () => {
    const columnCurrencyMapping: ColumnMapping = {
      ...singleAmountMapping,
      currency: { mode: 'column', column: 3 },
    };
    const rows: TableCell[][] = [
      HEADER_ROW,
      ['01.07.2025 10:15:00', 'Coffee', 123.45, 'not-a-currency', ''],
    ];

    expect(() => applyColumnMapping(rows, columnCurrencyMapping)).toThrow(StatementParseError);
  });
});

describe('applyColumnMapping (debitCredit mode)', () => {
  const debitCreditMapping: ColumnMapping = {
    headerRowIndex: 0,
    decimalSeparator: '.',
    dateColumn: 0,
    dateFormat: 'DD.MM.YYYY HH:MM:SS',
    amount: { mode: 'debitCredit', debitColumn: 2, creditColumn: 3 },
    descriptionColumn: 1,
    currency: { mode: 'fixed', currency: 'UAH' },
  };

  it('negates an unsigned debit-only value', () => {
    const rows: TableCell[][] = [
      ['Date', 'Description', 'Debit', 'Credit'],
      ['01.07.2025 10:15:00', 'Rent', '150.00', ''],
    ];

    const { statement, rowErrors } = applyColumnMapping(rows, debitCreditMapping);

    expect(rowErrors).toEqual([]);
    expect(statement.transactions[0].amountMinorUnits).toBe(-15_000);
  });

  it('negates a signed debit value (still negative, not doubly negated)', () => {
    const rows: TableCell[][] = [
      ['Date', 'Description', 'Debit', 'Credit'],
      ['01.07.2025 10:15:00', 'Rent', '-150.00', ''],
    ];

    const { statement } = applyColumnMapping(rows, debitCreditMapping);

    expect(statement.transactions[0].amountMinorUnits).toBe(-15_000);
  });

  it('keeps a credit-only value positive', () => {
    const rows: TableCell[][] = [
      ['Date', 'Description', 'Debit', 'Credit'],
      ['01.07.2025 10:15:00', 'Salary', '', '1000.00'],
    ];

    const { statement } = applyColumnMapping(rows, debitCreditMapping);

    expect(statement.transactions[0].amountMinorUnits).toBe(100_000);
  });

  it("reports a 'debitAndCredit' rowError when both sides are filled, and drops the row", () => {
    const rows: TableCell[][] = [
      ['Date', 'Description', 'Debit', 'Credit'],
      ['01.07.2025 10:15:00', 'Weird row', '150.00', '200.00'],
    ];

    const { statement, rowErrors } = applyColumnMapping(rows, debitCreditMapping);

    expect(statement.transactions).toEqual([]);
    expect(rowErrors).toEqual([
      { rowNumber: 2, reason: 'debitAndCredit', value: '150.00 / 200.00' },
    ]);
  });
});

// The Balance column role (import-balance commit B): the row with the
// newest parsed `timeSeconds`, read off the mapped balance cell with the
// mapping's own `decimalSeparator`. A tie on the newest time is broken by
// FILE ORDER — see the
// dedicated describe block below for the tie-break rule itself.
describe('applyColumnMapping (Balance column -> closingBalance)', () => {
  const BALANCE_HEADER: TableCell[] = ['Date', 'Description', 'Amount', 'Balance'];

  const mappingWithBalance: ColumnMapping = {
    headerRowIndex: 0,
    decimalSeparator: '.',
    dateColumn: 0,
    dateFormat: 'DD.MM.YYYY HH:MM:SS',
    amount: { mode: 'single', column: 2 },
    descriptionColumn: 1,
    currency: { mode: 'fixed', currency: 'UAH' },
    balanceColumn: 3,
  };

  it('sets closingBalance from the row with the newest parsed time', () => {
    const rows: TableCell[][] = [
      BALANCE_HEADER,
      ['01.07.2025 10:00:00', 'Coffee', -100, 900],
      ['02.07.2025 10:00:00', 'Salary', 5000, 5900],
    ];

    const { statement } = applyColumnMapping(rows, mappingWithBalance);

    expect(statement.closingBalance).toEqual({
      minorUnits: 590_000,
      currency: 'UAH',
      asOfSeconds: localSeconds(2025, 7, 2, 10, 0, 0),
    });
  });

  it('sets no closingBalance when the newest row’s balance cell is missing', () => {
    const rows: TableCell[][] = [
      BALANCE_HEADER,
      ['01.07.2025 10:00:00', 'Coffee', -100, 900],
      ['02.07.2025 10:00:00', 'Salary', 5000, ''],
    ];

    const { statement } = applyColumnMapping(rows, mappingWithBalance);

    expect(statement.closingBalance).toBeUndefined();
  });

  it('sets no closingBalance when the newest row’s balance cell is non-numeric', () => {
    const rows: TableCell[][] = [
      BALANCE_HEADER,
      ['01.07.2025 10:00:00', 'Coffee', -100, 900],
      ['02.07.2025 10:00:00', 'Salary', 5000, 'n/a'],
    ];

    const { statement } = applyColumnMapping(rows, mappingWithBalance);

    expect(statement.closingBalance).toBeUndefined();
  });

  it('sets no closingBalance when the Balance column is left unmapped', () => {
    const rows: TableCell[][] = [
      BALANCE_HEADER,
      ['01.07.2025 10:00:00', 'Coffee', -100, 900],
      ['02.07.2025 10:00:00', 'Salary', 5000, 5900],
    ];
    const { balanceColumn: _omit, ...withoutBalance } = mappingWithBalance;

    const { statement } = applyColumnMapping(rows, withoutBalance);

    expect(statement.closingBalance).toBeUndefined();
  });

  it('ignores a row that failed to resolve (bad date) when picking the newest balance row', () => {
    const rows: TableCell[][] = [
      BALANCE_HEADER,
      ['01.07.2025 10:00:00', 'Coffee', -100, 900],
      ['not-a-date', 'Broken', 5000, 999_999],
    ];

    const { statement } = applyColumnMapping(rows, mappingWithBalance);

    expect(statement.closingBalance?.minorUnits).toBe(90_000);
  });
});

// A tie on the newest parsed
// time is broken by FILE ORDER, not by "last one wins" — most bank exports
// (Monobank included) list the newest row FIRST, so on a newest-first file
// the FIRST tied row is really the latest transaction of that instant; an
// oldest-first file's LAST tied row is. Orientation comes from the resolved
// rows' own first vs. last parsed time. When it can't be determined (first
// and last share the same time), the tied rows' own balance cells decide:
// equal -> use that value (order genuinely doesn't matter); different ->
// no closingBalance at all (Rule B fallback) rather than guess.
describe('applyColumnMapping (Balance column tie-break: file order)', () => {
  const BALANCE_HEADER: TableCell[] = ['Date', 'Description', 'Amount', 'Balance'];

  const mappingWithBalance: ColumnMapping = {
    headerRowIndex: 0,
    decimalSeparator: '.',
    dateColumn: 0,
    dateFormat: 'DD.MM.YYYY HH:MM:SS',
    amount: { mode: 'single', column: 2 },
    descriptionColumn: 1,
    currency: { mode: 'fixed', currency: 'UAH' },
    balanceColumn: 3,
  };

  // The review's own reproduction: a newest-first file, two same-day rows
  // tied on `timeSeconds`. The FIRST one (Salary) is the true latest —
  // taking the last-encountered row (Coffee, the pre-fix bug) landed the
  // holding on 900.00 instead of 5,900.00.
  it('on a newest-first file, breaks a tie by taking the FIRST tied row in file order', () => {
    const rows: TableCell[][] = [
      BALANCE_HEADER,
      ['02.07.2025 00:00:00', 'Salary', 5000, 5900],
      ['02.07.2025 00:00:00', 'Coffee', -100, 900],
      ['01.07.2025 00:00:00', 'Topup', 1000, 1000],
    ];

    const { statement } = applyColumnMapping(rows, mappingWithBalance);

    expect(statement.closingBalance?.minorUnits).toBe(590_000);
  });

  // No tie here — the true newest row is FIRST in the file, not last. A
  // mutant that always takes the last RESOLVED row (ignoring `timeSeconds`
  // entirely) passes every oldest-first fixture above (there, the last row
  // IS the newest) but fails this one.
  it('on a newest-first file with no tie, still finds the true newest row', () => {
    const rows: TableCell[][] = [
      BALANCE_HEADER,
      ['02.07.2025 00:00:00', 'Salary', 5000, 5900],
      ['01.07.2025 00:00:00', 'Topup', 1000, 1000],
    ];

    const { statement } = applyColumnMapping(rows, mappingWithBalance);

    expect(statement.closingBalance?.minorUnits).toBe(590_000);
  });

  it('on an oldest-first file, breaks a tie by taking the LAST tied row in file order', () => {
    const rows: TableCell[][] = [
      BALANCE_HEADER,
      ['01.07.2025 00:00:00', 'Topup', 1000, 1000],
      ['02.07.2025 00:00:00', 'Coffee', -100, 900],
      ['02.07.2025 00:00:00', 'Salary', 5000, 5900],
    ];

    const { statement } = applyColumnMapping(rows, mappingWithBalance);

    expect(statement.closingBalance?.minorUnits).toBe(590_000);
  });

  it('when orientation is undeterminable (first == last resolved time) and the tied cells are EQUAL, uses that value', () => {
    const rows: TableCell[][] = [
      BALANCE_HEADER,
      ['01.07.2025 00:00:00', 'Coffee', -100, 900],
      ['01.07.2025 00:00:00', 'Refund', 100, 900],
    ];

    const { statement } = applyColumnMapping(rows, mappingWithBalance);

    expect(statement.closingBalance?.minorUnits).toBe(90_000);
  });

  it('when orientation is undeterminable (first == last resolved time) and the tied cells DIFFER, sets no closingBalance', () => {
    const rows: TableCell[][] = [
      BALANCE_HEADER,
      ['01.07.2025 00:00:00', 'Coffee', -100, 900],
      ['01.07.2025 00:00:00', 'Refund', 100, 1000],
    ];

    const { statement } = applyColumnMapping(rows, mappingWithBalance);

    expect(statement.closingBalance).toBeUndefined();
  });
});

describe('applyColumnMapping over spreadsheet Date cells', () => {
  it('reads a date-only Date cell as noon under the timed YYYY-MM-DD HH:MM:SS preset', () => {
    const { rows } = readTableRows({
      text: '',
      fileName: 'sample.xlsx',
      sheetRows: [
        ['Date', 'Description', 'Amount'],
        [new Date(Date.UTC(2025, 6, 2)), 'Rent', -100],
        [new Date(Date.UTC(2025, 6, 3, 9, 5, 3)), 'Coffee', -5],
      ],
    });

    const { statement, rowErrors } = applyColumnMapping(rows, {
      ...singleAmountMapping,
      dateFormat: 'YYYY-MM-DD HH:MM:SS',
    });

    expect(rowErrors).toEqual([]);
    expect(statement.transactions.map((transaction) => transaction.timeSeconds)).toEqual([
      localSeconds(2025, 7, 2, 12, 0, 0),
      localSeconds(2025, 7, 3, 9, 5, 3),
    ]);
  });
});

describe('applyColumnMapping dedup key across device zones', () => {
  const rows: TableCell[][] = [
    ['Date', 'Amount', 'Description'],
    ['15.09.2026 14:30', '-150.00', 'Coffee'],
    ['15.01.2026 09:05', '-20.00', 'Tea'],
    ['20.09.2026', '-80.00', 'Bus'],
    ['20.01.2026', '-30.00', 'Metro'],
  ];

  const keysFor = (dateFormat: ColumnMapping['dateFormat']): string[] =>
    applyColumnMapping(rows, {
      headerRowIndex: 0,
      decimalSeparator: '.',
      dateColumn: 0,
      dateFormat,
      amount: { mode: 'single', column: 1 },
      descriptionColumn: 2,
      currency: { mode: 'fixed', currency: 'EUR' },
    }).statement.transactions.map((transaction) => computeDedupKey('h1', transaction, 0));

  // The literal keys are the ones a Kyiv device wrote before column mapping
  // read its cells as Kyiv time, so stored keys need no re-key.
  it('keeps the key a Kyiv device already wrote', () => {
    expect(keysFor('DD.MM.YYYY HH:MM')).toEqual([
      'h1 1789471800 -15000 coffee',
      'h1 1768460700 -2000 tea',
    ]);
    expect(keysFor('DD.MM.YYYY')).toEqual(['h1 1789894800 -8000 bus', 'h1 1768903200 -3000 metro']);
  });

  it.each([1, -5, 3])('gives the same keys on a device at a fixed %d h offset', (offsetHours) => {
    expect(withDeviceZoneOffset(offsetHours, () => keysFor('DD.MM.YYYY HH:MM'))).toEqual(
      keysFor('DD.MM.YYYY HH:MM'),
    );
    expect(withDeviceZoneOffset(offsetHours, () => keysFor('DD.MM.YYYY'))).toEqual(
      keysFor('DD.MM.YYYY'),
    );
  });
});
