import {
  StatementParseError,
  statementFormatIds,
  type ParsedStatement,
  type ParsedTransaction,
} from './parser';

describe('StatementParseError', () => {
  it('constructs as an Error carrying the given message', () => {
    const error = new StatementParseError('unrecognized statement format');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('unrecognized statement format');
  });

  it('is distinguishable from a plain Error via instanceof', () => {
    const error = new StatementParseError('bad file');

    expect(error instanceof StatementParseError).toBe(true);
  });
});

describe('statementFormatIds', () => {
  // Widens this tuple to add the three FOP/business CSV ids, per
  // docs/plans/statement-import.md's own file list: each new stub's own
  // `id` field cannot typecheck against `StatementFormatId` without this
  // tuple actually carrying it.
  it('ships exactly the Monobank CSV, PrivatBank XLSX, Sensebank CSV, and the three FOP/business CSV format ids in this phase', () => {
    expect(statementFormatIds).toEqual([
      'monobank-csv',
      'privatbank-xlsx',
      'sensebank-csv',
      'procredit-business-csv',
      'ukrsib-business-csv',
      'alfa-business-csv',
    ]);
  });
});

describe('parser contract types', () => {
  it('accepts a ParsedTransaction with only its required fields set', () => {
    const transaction: ParsedTransaction = {
      currency: 'UAH',
      amountMinorUnits: -1_000,
      timeSeconds: 1_700_000_000,
      description: 'Coffee',
    };

    expect(transaction.amountMinorUnits).toBe(-1_000);
    expect(transaction.mcc).toBeUndefined();
    expect(transaction.externalId).toBeUndefined();
  });

  it('accepts a ParsedStatement carrying its formatId, account hint, and transactions', () => {
    const statement: ParsedStatement = {
      formatId: 'monobank-csv',
      account: { currency: 'UAH' },
      transactions: [
        { currency: 'UAH', amountMinorUnits: 500, timeSeconds: 1, description: 'Refund' },
      ],
    };

    expect(statement.formatId).toBe('monobank-csv');
    expect(statement.account.currency).toBe('UAH');
    expect(statement.transactions).toHaveLength(1);
  });
});
