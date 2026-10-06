// A closing balance never absorbs a manual row: the bank figure is the bank's
// own, and every manual entry dated on or before its as-of date, bar the rows
// that set a balance, stays on top of it, so a re-import, a newer statement and
// a delete all land on the same number. The preview reads the same plan the
// import writes, so each import below is compared with what the preview said.
// The stored balance, the as-of date and the kept keys are SQL over the stored
// ledger, so only a real engine shows them.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { Money } from '@kiko/currency/money';
import { holdingsRepo } from '@kiko/holdings/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { type ImportBalancePreview, transactionsRepo } from './transactions.repo';

const OCTOBER_1 = Date.UTC(2026, 9, 1);
const NOVEMBER_1 = OCTOBER_1 + 31 * DAY_MS;
const SEPTEMBER_20 = Date.UTC(2026, 8, 20, 9);
const SEPTEMBER_25 = Date.UTC(2026, 8, 25, 9);
const OCTOBER_3 = Date.UTC(2026, 9, 3, 9);
const OCTOBER_4 = Date.UTC(2026, 9, 4, 9);
const OCTOBER_5 = Date.UTC(2026, 9, 5, 9);
const OCTOBER_7 = Date.UTC(2026, 9, 7, 9);

type StatementRow = { externalId: string; amountMinorUnits: number; time: number };
type Closing = { minorUnits: number; currency: 'UAH' | 'USD'; asOfSeconds: number };

const run = (statement: string, ...parameters: (string | number | null)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const scalarOf = (statement: string, ...parameters: (string | number)[]): unknown =>
  (mockDatabase.prepare(statement).get(...parameters) as { value: unknown }).value;

const balanceOf = (holdingId = 'card'): number =>
  scalarOf('SELECT balance_minor_units AS value FROM holdings WHERE id = ?', holdingId) as number;

const balanceSetAt = (): unknown =>
  scalarOf("SELECT balance_set_at AS value FROM holdings WHERE id = 'card'");

const rowCountOf = (): number =>
  scalarOf("SELECT count(*) AS value FROM transactions WHERE holding_id = 'card'") as number;

const keyCount = (): number =>
  scalarOf('SELECT count(*) AS value FROM deleted_import_keys') as number;

const idOfTime = (source: string, time: number): string =>
  scalarOf(
    'SELECT id AS value FROM transactions WHERE source = ? AND time = ?',
    source,
    time,
  ) as string;

const idOfKey = (externalId: string): string =>
  scalarOf('SELECT id AS value FROM transactions WHERE external_id = ?', externalId) as string;

const closing = (minorUnits: number, asOf: number, currency: 'UAH' | 'USD' = 'UAH'): Closing => ({
  minorUnits,
  currency,
  asOfSeconds: asOf / 1000,
});

const inputOf = (rows: StatementRow[], closingBalance: Closing | undefined) => ({
  holdingId: 'card',
  closingBalance,
  rows: rows.map((row) => ({ ...row, holdingId: 'card', source: 'import' as const })),
});

const resultingBalanceOf = (preview: ImportBalancePreview): number =>
  preview.kind === 'change' ? preview.toMinorUnits : preview.minorUnits;

// The balance the preview promised, then the balance the import stored.
const importWithPreview = async (
  rows: StatementRow[],
  closingBalance?: Closing,
): Promise<{ previewed: number; stored: number }> => {
  const preview = await transactionsRepo.previewImportBalance(inputOf(rows, closingBalance));

  await transactionsRepo.importRows(inputOf(rows, closingBalance));

  return { previewed: resultingBalanceOf(preview), stored: balanceOf() };
};

// The bank statement: two rows and the bank's closing figure as of October 1.
const statementRows = (): StatementRow[] => [
  { externalId: 'k-100', amountMinorUnits: -100, time: OCTOBER_1 - 3 * DAY_MS },
  { externalId: 'k-50', amountMinorUnits: -50, time: OCTOBER_1 - 2 * DAY_MS },
];
const statementClosing = (): Closing => closing(10_000, OCTOBER_1);

const importStatement = () => importWithPreview(statementRows(), statementClosing());

const recordManual = (amountMinorUnits: number, time: number): Promise<void> =>
  transactionsRepo.recordManual({ holdingId: 'card', amountMinorUnits, time });

beforeEach(async () => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  run(
    "INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('card', 'account', 'Card', 'card', 'UAH')",
  );
  await transactionsRepo.importRows(inputOf(statementRows(), statementClosing()));
});

describe('a closing balance re-applied over a manual row dated before its as-of date', () => {
  beforeEach(async () => {
    await recordManual(-1_000, SEPTEMBER_20);
  });

  it('starts from the bank figure less the manual row', () => {
    expect(balanceOf()).toBe(9_000);
  });

  it('keeps the row on top when the same statement is imported again', async () => {
    await expect(importStatement()).resolves.toEqual({ previewed: 9_000, stored: 9_000 });

    expect(rowCountOf()).toBe(3);
  });

  it('shows the figure on top of the bank figure in the preview', async () => {
    await expect(
      transactionsRepo.previewImportBalance(inputOf(statementRows(), statementClosing())),
    ).resolves.toEqual({
      kind: 'set',
      currency: 'UAH',
      minorUnits: 9_000,
      bankMinorUnits: 10_000,
      asOfSeconds: OCTOBER_1 / 1000,
    });
  });

  it('gives the bank figure back when the row is deleted after the re-import', async () => {
    await importStatement();

    await transactionsRepo.remove(idOfTime('manual', SEPTEMBER_20));

    expect(balanceOf()).toBe(10_000);
    expect(rowCountOf()).toBe(2);
    expect(keyCount()).toBe(0);
  });

  it('keeps the row on top when its amount was edited before the re-import', async () => {
    await transactionsRepo.update({
      transactionId: idOfTime('manual', SEPTEMBER_20),
      amountMinorUnits: -1_500,
      time: SEPTEMBER_20,
    });

    await expect(importStatement()).resolves.toEqual({ previewed: 8_500, stored: 8_500 });
  });

  it('keeps the row once when its date moved past the as-of date before the re-import', async () => {
    await transactionsRepo.update({
      transactionId: idOfTime('manual', SEPTEMBER_20),
      amountMinorUnits: -1_000,
      time: OCTOBER_5,
    });

    await expect(importStatement()).resolves.toEqual({ previewed: 9_000, stored: 9_000 });
  });

  it('keeps the row on top of a newer closing balance, and a delete lands on the bank figure', async () => {
    await expect(importWithPreview([], closing(12_000, NOVEMBER_1))).resolves.toEqual({
      previewed: 11_000,
      stored: 11_000,
    });
    expect(balanceSetAt()).toBe(NOVEMBER_1);

    await transactionsRepo.remove(idOfTime('manual', SEPTEMBER_20));

    expect(balanceOf()).toBe(12_000);
  });

  it('leaves an older closing balance that does not apply, and the row, alone', async () => {
    const olderClosing = closing(9_500, Date.UTC(2026, 8, 1));
    const augustRow = { externalId: 'k-aug', amountMinorUnits: -40, time: Date.UTC(2026, 7, 20) };

    await expect(importWithPreview([augustRow], olderClosing)).resolves.toEqual({
      previewed: 9_000,
      stored: 9_000,
    });
    expect(balanceSetAt()).toBe(OCTOBER_1);
  });

  it('adds a row of a file without a closing balance dated after the boundary, and keeps the row', async () => {
    await expect(
      importWithPreview([{ externalId: 'k-20', amountMinorUnits: -20, time: OCTOBER_4 }]),
    ).resolves.toEqual({ previewed: 8_980, stored: 8_980 });
    expect(rowCountOf()).toBe(4);
  });

  it('adds no row when the closing balance is in another currency than the holding', async () => {
    await expect(
      importWithPreview(statementRows(), closing(10_000, OCTOBER_1, 'USD')),
    ).resolves.toEqual({ previewed: 9_000, stored: 9_000 });
    expect(rowCountOf()).toBe(3);
  });
});

describe('a closing balance re-applied over other manual rows', () => {
  it('counts a manual row dated after the as-of date once', async () => {
    await recordManual(-1_000, OCTOBER_3);

    await expect(importStatement()).resolves.toEqual({ previewed: 9_000, stored: 9_000 });
  });

  it('counts a manual row dated exactly at the as-of date once', async () => {
    await recordManual(-1_000, OCTOBER_1);

    await expect(importStatement()).resolves.toEqual({ previewed: 9_000, stored: 9_000 });
  });

  it('counts a row dated before and a row dated after the as-of date, each once', async () => {
    await recordManual(-1_000, SEPTEMBER_20);
    await recordManual(-500, OCTOBER_3);

    await expect(importStatement()).resolves.toEqual({ previewed: 8_500, stored: 8_500 });
  });

  it('keeps both legs of a manual exchange on their holdings', async () => {
    run(
      "INSERT INTO holdings (id, account_id, name, type, currency) VALUES ('cash', 'account', 'Cash', 'cash', 'UAH')",
    );
    await transactionsRepo.recordExchange({
      sourceHoldingId: 'card',
      valueOutMinorUnits: 2_000,
      destinationHoldingId: 'cash',
      destinationType: 'cash',
      valueInMinorUnits: 2_000,
      time: SEPTEMBER_25,
    });

    await expect(importStatement()).resolves.toEqual({ previewed: 8_000, stored: 8_000 });
    expect(balanceOf('cash')).toBe(2_000);
  });

  it('leaves out the row of a hand edit, which set the balance it sits in', async () => {
    await recordManual(-1_000, SEPTEMBER_20);
    await holdingsRepo.updateWithBalanceDelta(
      'card',
      { balance: Money.of('UAH', 9_500) },
      OCTOBER_7,
    );

    await expect(importWithPreview([], closing(12_000, NOVEMBER_1))).resolves.toEqual({
      previewed: 11_000,
      stored: 11_000,
    });
  });

  it('leaves out a row a bank sync wrote, which the bank figure already holds', async () => {
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
       VALUES ('synced', 'card', -777, ?, 'monobank', 'bank-1')`,
      OCTOBER_1 - DAY_MS,
    );
    await recordManual(-1_000, SEPTEMBER_20);

    await expect(importStatement()).resolves.toEqual({ previewed: 9_000, stored: 9_000 });
  });
});

describe('a first closing balance import over hand-logged entries', () => {
  it('keeps the opening row out and the hand-logged row on top, and a delete lands on the bank figure', async () => {
    mockDatabase.exec('DELETE FROM transactions; UPDATE holdings SET balance_minor_units = 0');
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, sets_balance)
       VALUES ('opening', 'card', 0, ?, 'manual', 1)`,
      Date.UTC(2026, 8, 1),
    );
    run("UPDATE holdings SET balance_set_at = ? WHERE id = 'card'", Date.UTC(2026, 8, 1));
    await recordManual(-1_000, SEPTEMBER_20);

    expect(balanceOf()).toBe(-1_000);

    await expect(importStatement()).resolves.toEqual({ previewed: 9_000, stored: 9_000 });
    expect(rowCountOf()).toBe(4);

    await transactionsRepo.remove(idOfTime('manual', SEPTEMBER_20));

    expect(balanceOf()).toBe(10_000);
  });
});

describe('a closing balance import the account refuses', () => {
  it('refuses a holding of a connected bank account and writes nothing', async () => {
    run("UPDATE accounts SET institution = 'monobank' WHERE id = 'account'");
    await recordManual(-1_000, SEPTEMBER_20);

    await expect(
      transactionsRepo.importRows(inputOf(statementRows(), statementClosing())),
    ).rejects.toThrow('statement-import/synced-account');

    expect(balanceOf()).toBe(9_000);
    expect(rowCountOf()).toBe(3);
  });
});

describe('a closing balance import over a manual row and a deleted statement row', () => {
  beforeEach(async () => {
    await recordManual(-1_000, SEPTEMBER_20);
    await transactionsRepo.remove(idOfKey('k-50'));
  });

  it('gives the deleted amount back and keeps its key', () => {
    expect(balanceOf()).toBe(9_050);
    expect(keyCount()).toBe(1);
  });

  it('brings the deleted row back under the same closing balance, with the manual row on top', async () => {
    await expect(importStatement()).resolves.toEqual({ previewed: 9_000, stored: 9_000 });

    expect(rowCountOf()).toBe(3);
    expect(keyCount()).toBe(0);
  });

  it('brings the deleted row back in full under an older closing balance, leaving the manual row alone', async () => {
    await expect(
      importWithPreview(statementRows(), closing(10_040, OCTOBER_1 - DAY_MS)),
    ).resolves.toEqual({ previewed: 9_000, stored: 9_000 });

    expect(balanceSetAt()).toBe(OCTOBER_1);
    expect(keyCount()).toBe(0);
  });

  it('brings the deleted row back under a newer closing balance, with the manual row on top', async () => {
    await expect(importWithPreview(statementRows(), closing(12_000, NOVEMBER_1))).resolves.toEqual({
      previewed: 11_000,
      stored: 11_000,
    });

    expect(rowCountOf()).toBe(3);
    expect(keyCount()).toBe(0);
  });
});
