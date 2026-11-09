// The picker lists the codes the user's own ledger holds. Only a real engine shows the range
// filter, the grouping and the order of the read.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

type CountRow = { mcc: number; rowCount: number };

const readCounts = async (): Promise<CountRow[]> => await transactionsRepo.mccCountsQuery();

let nextRow = 0;

const insertRow = (
  mcc: number | null,
  extraColumns: Record<string, string | number> = {},
): void => {
  nextRow += 1;

  const columns = {
    id: `row-${nextRow}`,
    holding_id: 'card',
    amount_minor_units: -4500,
    time: nextRow,
    description: `Row ${nextRow}`,
    source: 'manual',
    mcc,
    ...extraColumns,
  };
  const names = Object.keys(columns);

  mockDatabase
    .prepare(
      `INSERT INTO transactions (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    )
    .run(...(Object.values(columns) as (string | number | null)[]));
};

const insertRows = (mcc: number | null, count: number): void => {
  for (let index = 0; index < count; index += 1) {
    insertRow(mcc);
  }
};

beforeEach(() => {
  nextRow = 0;
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind) VALUES ('account', 'Monobank', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency) VALUES
      ('card', 'account', 'Card', 'card', 'UAH'),
      ('other', 'account', 'Other', 'card', 'UAH');
  `);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('transactionsRepo.mccCountsQuery', () => {
  it('counts each code once, most rows first, then by code', async () => {
    insertRows(5812, 2);
    insertRows(5411, 3);
    insertRows(4829, 2);
    insertRows(6011, 1);

    expect(await readCounts()).toEqual([
      { mcc: 5411, rowCount: 3 },
      { mcc: 4829, rowCount: 2 },
      { mcc: 5812, rowCount: 2 },
      { mcc: 6011, rowCount: 1 },
    ]);
  });

  it('leaves out rows with no code and codes outside 0 to 9999', async () => {
    insertRows(null, 2);
    insertRows(-1, 1);
    insertRows(0, 1);
    insertRows(9999, 1);
    insertRows(10000, 1);

    expect(await readCounts()).toEqual([
      { mcc: 0, rowCount: 1 },
      { mcc: 9999, rowCount: 1 },
    ]);
  });

  it('counts hand-set, balance, split-change and exchange-leg rows alike', async () => {
    insertRow(5411);
    insertRow(5411, { category: 'groceries', category_set_by_hand: 1 });
    insertRow(5411, { sets_balance: 1 });
    insertRow(5411, { change_group_id: 'split-1' });
    insertRow(5411, { exchange_pair_id: 'pair-1', exchange_counterpart_holding_id: 'other' });

    expect(await readCounts()).toEqual([{ mcc: 5411, rowCount: 5 }]);
  });

  it('returns no rows for a ledger with no code', async () => {
    insertRows(null, 3);

    expect(await readCounts()).toEqual([]);
  });

  it('is one statement', async () => {
    insertRows(5411, 2);
    insertRows(5812, 1);

    const statements: string[] = [];
    const prepare = mockDatabase.prepare.bind(mockDatabase);

    jest.spyOn(mockDatabase, 'prepare').mockImplementation((sql: string) => {
      statements.push(sql);

      return prepare(sql);
    });

    const query = transactionsRepo.mccCountsQuery();
    const rows = await query;

    expect(rows).toHaveLength(2);
    expect(statements).toEqual([query.toSQL().sql]);
  });
});
