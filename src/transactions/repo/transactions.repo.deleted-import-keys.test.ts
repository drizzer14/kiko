// A deleted statement row leaves its key behind, per holding, so a re-import
// that brings it back counts its full amount (the delete reversed it) while a
// row the holding never had, dated on or before its balance boundary, stays
// history. Which key was kept, which balance followed and which key was cleared
// is SQL over the stored ledger, so only a real engine shows it.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

const BOUNDARY = Date.UTC(2026, 9, 1);
const HISTORY_DAY = Date.UTC(2026, 8, 10, 9);

type Currency = 'UAH';
type StatementRow = {
  externalId: string;
  amountMinorUnits: number;
  time: number;
  aliasExternalId?: string;
};
type Closing = { minorUnits: number; currency: Currency; asOfSeconds: number };

const run = (statement: string, ...parameters: (string | number | null)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const scalarOf = (statement: string, ...parameters: (string | number)[]): unknown =>
  (mockDatabase.prepare(statement).get(...parameters) as { value: unknown }).value;

const balanceOf = (holdingId = 'card'): number =>
  scalarOf('SELECT balance_minor_units AS value FROM holdings WHERE id = ?', holdingId) as number;

const rowCountOf = (holdingId = 'card'): number =>
  scalarOf('SELECT count(*) AS value FROM transactions WHERE holding_id = ?', holdingId) as number;

const idOf = (externalId: string): string =>
  scalarOf('SELECT id AS value FROM transactions WHERE external_id = ?', externalId) as string;

const storedKeys = (): { holdingId: string; externalId: string }[] =>
  (
    mockDatabase
      .prepare(
        'SELECT holding_id AS holdingId, external_id AS externalId FROM deleted_import_keys ORDER BY holding_id, external_id',
      )
      .all() as { holdingId: string; externalId: string }[]
  ).map(({ holdingId, externalId }) => ({ holdingId, externalId }));

const toImportInput = (
  rows: StatementRow[],
  closingBalance: Closing | undefined,
  holdingId: string,
) => ({
  holdingId,
  closingBalance,
  rows: rows.map((row) => ({ ...row, holdingId, source: 'import' as const })),
});

const importRows = (rows: StatementRow[], closingBalance?: Closing, holdingId = 'card') =>
  transactionsRepo.importRows(toImportInput(rows, closingBalance, holdingId));

const previewRows = (rows: StatementRow[], closingBalance?: Closing) =>
  transactionsRepo.previewImportBalance(toImportInput(rows, closingBalance, 'card'));

const closing = (minorUnits: number, asOf: number): Closing => ({
  minorUnits,
  currency: 'UAH',
  asOfSeconds: asOf / 1000,
});

const anchorBalance = (holdingId: string, minorUnits: number, setAt: number): void => {
  run(
    'UPDATE holdings SET balance_minor_units = ?, balance_set_at = ? WHERE id = ?',
    minorUnits,
    setAt,
    holdingId,
  );
};

const insertHolding = (id: string, type = 'card', balanceMinorUnits = 0): void => {
  run(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
     VALUES (?, 'account', ?, ?, 'UAH', ?)`,
    id,
    id,
    type,
    balanceMinorUnits,
  );
};

// A file with no closing balance, over a balance the user set by hand on Oct 1:
// two rows before it (history) and one after it.
const fileOf = (): StatementRow[] => [
  { externalId: 'k-200', amountMinorUnits: -200, time: HISTORY_DAY },
  { externalId: 'k-300', amountMinorUnits: -300, time: HISTORY_DAY + 5 * DAY_MS },
  { externalId: 'k-1000', amountMinorUnits: 1000, time: BOUNDARY + 4 * DAY_MS },
];

// A bank statement: two rows and the bank's closing figure as of the boundary.
const statementRows = (): StatementRow[] => [
  { externalId: 'k-100', amountMinorUnits: -100, time: BOUNDARY - 3 * DAY_MS },
  { externalId: 'k-50', amountMinorUnits: -50, time: BOUNDARY - 2 * DAY_MS },
];
const STATEMENT_CLOSING = (): Closing => closing(10_000, BOUNDARY);

const importHandSetFile = async (): Promise<void> => {
  anchorBalance('card', 5000, BOUNDARY);
  await importRows(fileOf());
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  insertHolding('card');
});

describe('transactionsRepo.remove — the key of a deleted import row', () => {
  it('keeps the key of the holding and gives the amount back', async () => {
    await importHandSetFile();

    await transactionsRepo.remove(idOf('k-300'));

    expect(rowCountOf()).toBe(2);
    expect(balanceOf()).toBe(6300);
    expect(storedKeys()).toEqual([{ holdingId: 'card', externalId: 'k-300' }]);
  });

  it('writes one key when the row is deleted twice', async () => {
    await importHandSetFile();
    const rowId = idOf('k-300');

    await transactionsRepo.remove(rowId);
    await transactionsRepo.remove(rowId);

    expect(balanceOf()).toBe(6300);
    expect(storedKeys()).toEqual([{ holdingId: 'card', externalId: 'k-300' }]);
  });

  it('writes the key again when the row came back and is deleted again', async () => {
    await importHandSetFile();
    await transactionsRepo.remove(idOf('k-300'));
    await importRows(fileOf());

    expect(storedKeys()).toEqual([]);

    await transactionsRepo.remove(idOf('k-300'));

    expect(storedKeys()).toEqual([{ holdingId: 'card', externalId: 'k-300' }]);
    expect(balanceOf()).toBe(6300);
  });

  it('keeps no key for a manual row', async () => {
    await transactionsRepo.recordManual({
      holdingId: 'card',
      amountMinorUnits: -700,
      time: BOUNDARY,
    });
    run("UPDATE transactions SET external_id = 'manual-has-one'");

    await transactionsRepo.remove(idOf('manual-has-one'));

    expect(storedKeys()).toEqual([]);
  });

  it('keeps the key of an import row converted to a manual leg when that leg is deleted', async () => {
    await importHandSetFile();
    insertHolding('cash', 'cash', 300);
    run(
      "UPDATE transactions SET exchange_pair_id = 'pair', exchange_counterpart_holding_id = 'cash' WHERE external_id = 'k-300'",
    );
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, exchange_pair_id, exchange_counterpart_holding_id)
       VALUES ('leg', 'cash', 300, ?, 'manual', 'pair', 'card')`,
      HISTORY_DAY,
    );

    await transactionsRepo.remove('leg');

    expect(rowCountOf('cash')).toBe(0);
    expect(balanceOf()).toBe(6300);
    expect(balanceOf('cash')).toBe(0);
    expect(storedKeys()).toEqual([{ holdingId: 'card', externalId: 'k-300' }]);
  });

  it('keeps the key of every import row a split group deletes with it', async () => {
    await importHandSetFile();
    insertHolding('second');
    run(
      "UPDATE transactions SET change_group_id = 'group' WHERE external_id IN ('k-200', 'k-300')",
    );
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, change_group_id)
       VALUES ('part', 'second', 100, ?, 'manual', 'group')`,
      HISTORY_DAY,
    );

    await transactionsRepo.remove('part');

    expect(rowCountOf()).toBe(1);
    expect(storedKeys()).toEqual([
      { holdingId: 'card', externalId: 'k-200' },
      { holdingId: 'card', externalId: 'k-300' },
    ]);
  });

  it('keeps the key of an import row reached by deleting the holding of its other leg', async () => {
    await importHandSetFile();
    insertHolding('cash', 'cash', 300);
    run(
      "UPDATE transactions SET exchange_pair_id = 'pair', exchange_counterpart_holding_id = 'cash' WHERE external_id = 'k-300'",
    );
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, exchange_pair_id, exchange_counterpart_holding_id)
       VALUES ('leg', 'cash', 300, ?, 'manual', 'pair', 'card')`,
      HISTORY_DAY,
    );

    await transactionsRepo.removeHolding('cash');

    expect(balanceOf()).toBe(6300);
    expect(storedKeys()).toEqual([{ holdingId: 'card', externalId: 'k-300' }]);
  });
});

describe('transactionsRepo.importRows — a deleted row that comes back', () => {
  it('counts its amount again, once', async () => {
    await importHandSetFile();
    await transactionsRepo.remove(idOf('k-300'));

    const inserted = await importRows(fileOf());

    expect(inserted).toBe(1);
    expect(rowCountOf()).toBe(3);
    expect(balanceOf()).toBe(6000);
    expect(storedKeys()).toEqual([]);
  });

  it('counts a deleted row dated after the boundary once, not twice', async () => {
    await importHandSetFile();
    await transactionsRepo.remove(idOf('k-1000'));

    expect(balanceOf()).toBe(5000);

    await importRows(fileOf());

    expect(balanceOf()).toBe(6000);
    expect(storedKeys()).toEqual([]);
  });

  it('brings a row deleted with the pair it was converted into back unpaired', async () => {
    await importHandSetFile();
    insertHolding('cash', 'cash', 300);
    run(
      "UPDATE transactions SET exchange_pair_id = 'pair', exchange_counterpart_holding_id = 'cash' WHERE external_id = 'k-300'",
    );
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, exchange_pair_id, exchange_counterpart_holding_id)
       VALUES ('leg', 'cash', 300, ?, 'manual', 'pair', 'card')`,
      HISTORY_DAY,
    );
    await transactionsRepo.remove('leg');

    await importRows(fileOf());

    expect(balanceOf()).toBe(6000);
    expect(
      scalarOf("SELECT exchange_pair_id AS value FROM transactions WHERE external_id = 'k-300'"),
    ).toBeNull();
  });

  it('counts a history row the holding never had as 0', async () => {
    await importHandSetFile();

    const inserted = await importRows([
      ...fileOf(),
      { externalId: 'k-400', amountMinorUnits: -400, time: HISTORY_DAY - 9 * DAY_MS },
    ]);

    expect(inserted).toBe(1);
    expect(rowCountOf()).toBe(4);
    expect(balanceOf()).toBe(6000);
  });

  it('does not take a key deleted on another holding for its own', async () => {
    await importHandSetFile();
    await transactionsRepo.remove(idOf('k-300'));
    insertHolding('other');
    anchorBalance('other', 5000, BOUNDARY);

    await importRows(
      [{ externalId: 'k-300', amountMinorUnits: -300, time: HISTORY_DAY }],
      undefined,
      'other',
    );

    expect(rowCountOf('other')).toBe(1);
    expect(balanceOf('other')).toBe(5000);
    expect(storedKeys()).toEqual([{ holdingId: 'card', externalId: 'k-300' }]);
  });

  it('leaves a key that no row of the file carries, and counts the row at 0', async () => {
    await importHandSetFile();
    await transactionsRepo.remove(idOf('k-300'));
    run("UPDATE deleted_import_keys SET external_id = 'rewritten-away'");

    await importRows(fileOf());

    expect(rowCountOf()).toBe(3);
    expect(balanceOf()).toBe(6300);
    expect(storedKeys()).toEqual([{ holdingId: 'card', externalId: 'rewritten-away' }]);
  });

  it('counts a row stored under its noon alias in full when it comes back under its new key', async () => {
    anchorBalance('card', 5000, BOUNDARY);
    await importRows([{ externalId: 'noon-key', amountMinorUnits: -300, time: HISTORY_DAY }]);
    await transactionsRepo.remove(idOf('noon-key'));

    await importRows([
      {
        externalId: 'midnight-key',
        aliasExternalId: 'noon-key',
        amountMinorUnits: -300,
        time: HISTORY_DAY,
      },
    ]);

    expect(balanceOf()).toBe(5000);
    expect(rowCountOf()).toBe(1);
    expect(storedKeys()).toEqual([]);
  });

  it('brings back only the occurrence of two identical rows that was deleted', async () => {
    const twins: StatementRow[] = [
      { externalId: 'twin', amountMinorUnits: -300, time: HISTORY_DAY },
      { externalId: 'twin␟1', amountMinorUnits: -300, time: HISTORY_DAY },
    ];

    anchorBalance('card', 5000, BOUNDARY);
    await importRows(twins);
    await transactionsRepo.remove(idOf('twin'));

    const inserted = await importRows(twins);

    expect(inserted).toBe(1);
    expect(rowCountOf()).toBe(2);
    expect(balanceOf()).toBe(5000);
    expect(storedKeys()).toEqual([]);
  });

  it('keeps the key of a row a synced row of the holding already holds, and counts neither', async () => {
    await importHandSetFile();
    await transactionsRepo.remove(idOf('k-300'));
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
       VALUES ('synced', 'card', -300, ?, 'monobank', 'bank-1')`,
      HISTORY_DAY + 5 * DAY_MS,
    );

    await importRows(fileOf());

    expect(balanceOf()).toBe(6300);
    expect(storedKeys()).toEqual([{ holdingId: 'card', externalId: 'k-300' }]);
    expect(scalarOf("SELECT count(*) AS value FROM transactions WHERE external_id = 'k-300'")).toBe(
      0,
    );
  });

  it('leaves the key alone when the sync writes a row', async () => {
    await importHandSetFile();
    await transactionsRepo.remove(idOf('k-300'));

    await transactionsRepo.addManyDedup([
      {
        holdingId: 'card',
        amountMinorUnits: -300,
        time: HISTORY_DAY + 5 * DAY_MS,
        source: 'monobank',
        externalId: 'bank-1',
      },
    ]);

    expect(storedKeys()).toEqual([{ holdingId: 'card', externalId: 'k-300' }]);
  });
});

describe('transactionsRepo.importRows — a deleted row against a closing balance', () => {
  const importStatement = () => importRows(statementRows(), STATEMENT_CLOSING());

  it('sets the bank figure, whatever was deleted, and clears the key', async () => {
    await importStatement();
    await transactionsRepo.remove(idOf('k-50'));

    expect(balanceOf()).toBe(10_050);

    await importStatement();

    expect(balanceOf()).toBe(10_000);
    expect(rowCountOf()).toBe(2);
    expect(storedKeys()).toEqual([]);
  });

  it('counts the row in full when an older closing balance does not apply', async () => {
    await importStatement();
    await transactionsRepo.remove(idOf('k-50'));
    const olderClosing = closing(10_040, BOUNDARY - DAY_MS);

    const preview = await previewRows(statementRows(), olderClosing);

    expect(preview).toEqual({
      kind: 'change',
      currency: 'UAH',
      fromMinorUnits: 10_050,
      toMinorUnits: 10_000,
    });

    await importRows(statementRows(), olderClosing);

    expect(balanceOf()).toBe(10_000);
    expect(scalarOf('SELECT balance_set_at AS value FROM holdings WHERE id = ?', 'card')).toBe(
      BOUNDARY,
    );
    expect(storedKeys()).toEqual([]);
  });

  it('sets a newer bank figure that holds the deleted row', async () => {
    await importStatement();
    await transactionsRepo.remove(idOf('k-50'));

    await importRows(
      [
        ...statementRows(),
        { externalId: 'k-500', amountMinorUnits: 500, time: BOUNDARY + 9 * DAY_MS },
      ],
      closing(11_000, BOUNDARY + 31 * DAY_MS),
    );

    expect(balanceOf()).toBe(11_000);
    expect(storedKeys()).toEqual([]);
  });

  it('keeps the key when only the preview ran', async () => {
    await importStatement();
    await transactionsRepo.remove(idOf('k-50'));

    const preview = await previewRows(statementRows(), STATEMENT_CLOSING());

    expect(preview).toMatchObject({ kind: 'set', minorUnits: 10_000, bankMinorUnits: 10_000 });
    expect(storedKeys()).toEqual([{ holdingId: 'card', externalId: 'k-50' }]);
    expect(balanceOf()).toBe(10_050);
  });
});

describe('deleting a holding with kept keys', () => {
  it('removes the keys of the holding with it', async () => {
    await importHandSetFile();
    await transactionsRepo.remove(idOf('k-300'));

    await transactionsRepo.removeHolding('card');

    expect(storedKeys()).toEqual([]);
    expect(scalarOf('SELECT count(*) AS value FROM holdings WHERE id = ?', 'card')).toBe(0);
  });
});
