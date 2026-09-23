import type { ColumnMapping } from './apply-column-mapping';
import type { TableCell } from './table-rows';

import { applyColumnMapping } from './apply-column-mapping';

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
        timeSeconds: 1_751_364_900,
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
