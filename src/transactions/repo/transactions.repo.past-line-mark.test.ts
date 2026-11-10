// A row that a Bybit read overwrote is named in its holding's metadata, and a delete or an edit of
// that row moves no balance, because the read's figure replaced the balance and the row has no
// part in it. This file runs the real
// repo on a migrated engine: each case reads back the balances, the rows and the confirm's plan.
// A holding that is not Bybit's takes the same delete and edit as ever, with a mark in its
// metadata or none, and sends the same statements.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { OVERWRITTEN_ROW_IDS_FIELD } from '@kiko/holdings/holding-metadata';
import { MOVED, OPENED, deleteCascadeFixture } from '@kiko/test-support/delete-cascade-fixture';

import { transactionsRepo } from './transactions.repo';

const {
  run,
  insertHolding,
  seedFixture,
  insertRow,
  setBalance,
  setContributions,
  balancesOf,
  rowIds,
  contributionsOf,
} = deleteCascadeFixture(() => mockDatabase);

const ONE_COIN = 100_000_000;
const BYBIT_ACCOUNT = 'bybit';

const insertCoin = (id: string, balanceMinorUnits: number, ...markedRowIds: string[]): void => {
  insertHolding(id, 'crypto_asset', 'BTC', balanceMinorUnits, {
    accountId: BYBIT_ACCOUNT,
    metadata: {
      bybitAsset: 'BTC:unified',
      syncedAt: MOVED,
      balanceReadAt: MOVED,
      [OVERWRITTEN_ROW_IDS_FIELD]: markedRowIds,
    },
  });
};

// The fixture's holdings and a disconnected Bybit account, for the coins a read overwrote.
const seedWorld = (): void => {
  seedFixture();
  run(`INSERT INTO accounts (id, name, kind) VALUES ('${BYBIT_ACCOUNT}', 'Bybit', 'crypto')`);
};

// A Convert of an expense of 100.00 on cash to 0.5 coin, whose leg on the coin the read overwrote:
// the coin shows the read's 1, and cash shows its 100.00 after the expense.
const seedConvert = (): void => {
  seedWorld();
  setBalance('cash', 10_000);
  insertCoin('coin', ONE_COIN, 'coin-leg');
  insertRow({
    id: 'cash-leg',
    holdingId: 'cash',
    amountMinorUnits: -10_000,
    exchangeCounterpartHoldingId: 'coin',
    exchangePairId: 'pair',
  });
  insertRow({
    id: 'coin-leg',
    holdingId: 'coin',
    amountMinorUnits: 50_000_000,
    exchangeCounterpartHoldingId: 'cash',
    exchangePairId: 'pair',
  });
};

// Cash paid 100.00 with a return of 30.00 to a coin, which the read overwrote.
const seedSplit = (): void => {
  seedWorld();
  setBalance('cash', 10_000);
  insertCoin('coin', 1_000, 'return');
  insertRow({
    id: 'payment',
    holdingId: 'cash',
    amountMinorUnits: -10_000,
    changeGroupId: 'group',
  });
  insertRow({ id: 'return', holdingId: 'coin', amountMinorUnits: 3_000, changeGroupId: 'group' });
};

// One row on a coin that the read overwrote.
const seedMarkedRow = (rowId: string, source?: string): void => {
  seedWorld();
  insertCoin('coin', ONE_COIN, rowId);
  insertRow({ id: rowId, holdingId: 'coin', amountMinorUnits: 50_000_000, source });
};

// A card whose metadata carries a mark that names one row.
const seedKindHolding = (metadata: Record<string, unknown>, markedRowId: string): void => {
  seedFixture();
  insertHolding('kind', 'card', 'UAH', 100_000, {
    metadata: { ...metadata, [OVERWRITTEN_ROW_IDS_FIELD]: [markedRowId] },
  });
};

const statementsDuring = async (work: () => Promise<unknown>): Promise<number> => {
  const prepare = jest.spyOn(mockDatabase, 'prepare');

  await work();

  return prepare.mock.calls.length;
};

const edit = (transactionId: string, amountMinorUnits: number): Promise<void> =>
  transactionsRepo.update({ transactionId, amountMinorUnits, time: MOVED });

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a Convert with a leg on the mark', () => {
  it.each(['coin-leg', 'cash-leg'])(
    "a Convert's delete from %s moves the other holding and not the leg on the mark",
    async (legId) => {
      seedConvert();

      await transactionsRepo.remove(legId);

      expect(rowIds()).toEqual([]);
      expect(balancesOf()).toMatchObject({ coin: ONE_COIN, cash: 20_000 });
    },
  );

  it.each([
    ['coin-leg', 70_000_000, { coin: ONE_COIN, cash: 10_000 }],
    ['cash-leg', -12_000, { coin: ONE_COIN, cash: 8_000 }],
  ])('an edit of %s moves its own holding only', async (legId, amountMinorUnits, balances) => {
    seedConvert();

    await edit(legId, amountMinorUnits);

    expect(balancesOf()).toMatchObject(balances);
    expect(rowIds()).toEqual(['cash-leg', 'coin-leg']);
  });

  it('two legs on two marks move neither', async () => {
    seedWorld();
    insertCoin('coin', ONE_COIN, 'leg-a');
    insertCoin('other-coin', 2 * ONE_COIN, 'leg-b');
    insertRow({
      id: 'leg-a',
      holdingId: 'coin',
      amountMinorUnits: -50_000_000,
      exchangeCounterpartHoldingId: 'other-coin',
      exchangePairId: 'pair',
    });
    insertRow({
      id: 'leg-b',
      holdingId: 'other-coin',
      amountMinorUnits: 60_000_000,
      exchangeCounterpartHoldingId: 'coin',
      exchangePairId: 'pair',
    });

    await transactionsRepo.remove('leg-a');

    expect(rowIds()).toEqual([]);
    expect(balancesOf()).toMatchObject({ coin: ONE_COIN, 'other-coin': 2 * ONE_COIN });
  });

  it('a leg on the mark that paid a deposit still takes the contribution out', async () => {
    const opening = { amountMinorUnits: 500_000, date: OPENED };

    seedWorld();
    setContributions([opening, { amountMinorUnits: 40_000, date: MOVED }]);
    insertCoin('coin', ONE_COIN, 'deposit-leg');
    insertRow({
      id: 'deposit-leg',
      holdingId: 'coin',
      amountMinorUnits: -50_000_000,
      exchangeCounterpartHoldingId: 'deposit',
    });

    await transactionsRepo.remove('deposit-leg');

    expect(balancesOf()).toMatchObject({ coin: ONE_COIN });
    expect(contributionsOf('deposit')).toEqual([opening]);
  });

  it('a holding delete takes a partner on the mark with no move', async () => {
    seedConvert();

    await transactionsRepo.removeHolding('cash');

    expect(rowIds()).toEqual([]);
    expect(balancesOf()).toMatchObject({ coin: ONE_COIN });
  });
});

describe('a split with its return on the mark', () => {
  it.each(['payment', 'return'])(
    "a split's delete from the %s moves each holding by its own mark",
    async (rowId) => {
      seedSplit();

      await transactionsRepo.remove(rowId);

      expect(rowIds()).toEqual([]);
      expect(balancesOf()).toMatchObject({ coin: 1_000, cash: 20_000 });
    },
  );

  it.each([
    ['return', 5_000, { coin: 1_000, cash: 10_000 }],
    ['payment', -12_000, { coin: 1_000, cash: 8_000 }],
  ])('an edit of the %s moves its own holding only', async (rowId, amountMinorUnits, balances) => {
    seedSplit();

    await edit(rowId, amountMinorUnits);

    expect(balancesOf()).toMatchObject(balances);
  });
});

describe('a row on the mark of another shape', () => {
  it('a hand-set balance row moves no balance, and keeps balanceSetAt and balanceSetRowId', async () => {
    seedMarkedRow('set-row');
    run('UPDATE transactions SET sets_balance = 1 WHERE id = ?', 'set-row');
    run(
      'UPDATE holdings SET balance_set_at = ?, balance_set_row_id = ? WHERE id = ?',
      MOVED,
      'set-row',
      'coin',
    );

    await edit('set-row', 70_000_000);
    await transactionsRepo.remove('set-row');

    expect(rowIds()).toEqual([]);
    expect(
      mockDatabase
        .prepare(
          'SELECT balance_minor_units AS balance, balance_set_at AS at, balance_set_row_id AS rowId FROM holdings WHERE id = ?',
        )
        .get('coin'),
    ).toEqual({ balance: ONE_COIN, at: MOVED, rowId: 'set-row' });
  });

  it('an import row goes with no move and leaves its key', async () => {
    seedMarkedRow('import-row', 'import');

    await transactionsRepo.remove('import-row');

    expect(rowIds()).toEqual([]);
    expect(balancesOf()).toMatchObject({ coin: ONE_COIN });
    expect(
      mockDatabase.prepare('SELECT holding_id, external_id FROM deleted_import_keys').all(),
    ).toEqual([{ holding_id: 'coin', external_id: 'import-row' }]);
  });

  it('an edit still runs its alongside write', async () => {
    seedMarkedRow('typed');

    const alongside = jest.fn(async () => undefined);

    await transactionsRepo.update(
      { transactionId: 'typed', amountMinorUnits: 70_000_000, time: MOVED },
      alongside,
    );

    expect(alongside).toHaveBeenCalledTimes(1);
    expect(balancesOf()).toMatchObject({ coin: ONE_COIN });
  });
});

describe('the confirm says what the delete does', () => {
  it('removePlan names no change for a row on the mark', async () => {
    seedMarkedRow('typed');
    insertRow({ id: 'unmarked', holdingId: 'coin', amountMinorUnits: 10_000_000 });

    expect((await transactionsRepo.removePlan('typed')).balanceChanges).toBeUndefined();
    expect((await transactionsRepo.removePlan('unmarked')).balanceChanges).toEqual([
      { name: 'coin', currency: 'BTC', minorUnits: -10_000_000 },
    ]);
  });

  it('removePlan names the other holding only', async () => {
    seedConvert();

    expect((await transactionsRepo.removePlan('coin-leg')).balanceChanges).toEqual([
      { name: 'Cash', currency: 'UAH', minorUnits: 10_000 },
    ]);
  });

  it('removeHoldingsPlan names no change for a partner on the mark', async () => {
    seedConvert();

    expect((await transactionsRepo.removeHoldingsPlan(['cash'])).balanceChanges).toBeUndefined();
  });
});

describe('a Binance or wallet holding, which a read dates', () => {
  // The mark names `marked`; `unmarked` is a row typed after the read. The statements are those of
  // one `remove` and one `update`, counted for a holding with no mark: a row off the mark sends
  // them all, and a row on the mark sends every statement but the balance's own.
  const DATED_KINDS = [
    { label: 'Binance', metadata: { binanceAsset: 'BTC', syncedAt: MOVED, balanceReadAt: MOVED } },
    {
      label: 'a wallet',
      metadata: { walletAddress: 'bc1q', syncedAt: MOVED, balanceReadAt: MOVED },
    },
  ];

  const seedDatedKind = ({ metadata }: (typeof DATED_KINDS)[number]): void => {
    seedKindHolding(metadata, 'marked');
    insertRow({ id: 'marked', holdingId: 'kind', amountMinorUnits: 5_000 });
    insertRow({ id: 'unmarked', holdingId: 'kind', amountMinorUnits: 3_000 });
  };

  it.each(DATED_KINDS)(
    '$label moves no balance on a delete of a row on the mark, and the confirm names none',
    async (kind) => {
      seedDatedKind(kind);

      expect((await transactionsRepo.removePlan('marked')).balanceChanges).toBeUndefined();

      await transactionsRepo.remove('marked');

      expect(rowIds()).toEqual(['unmarked']);
      expect(balancesOf()).toMatchObject({ kind: 100_000 });
    },
  );

  it.each(DATED_KINDS)('$label moves no balance on an edit of a row on the mark', async (kind) => {
    seedDatedKind(kind);

    await edit('marked', 8_000);

    expect(balancesOf()).toMatchObject({ kind: 100_000 });
  });

  it.each(DATED_KINDS)('$label moves by a delete of a row off the mark as today', async (kind) => {
    seedDatedKind(kind);

    expect((await transactionsRepo.removePlan('unmarked')).balanceChanges).toEqual([
      { name: 'kind', currency: 'UAH', minorUnits: -3_000 },
    ]);

    await transactionsRepo.remove('unmarked');

    expect(balancesOf()).toMatchObject({ kind: 97_000 });
  });

  it.each(DATED_KINDS)('$label moves by an edit of a row off the mark as today', async (kind) => {
    seedDatedKind(kind);

    await edit('unmarked', 8_000);

    expect(balancesOf()).toMatchObject({ kind: 105_000 });
  });

  it.each(DATED_KINDS)(
    '$label makes the same statements on a delete off the mark',
    async (kind) => {
      seedDatedKind(kind);

      expect(await statementsDuring(() => transactionsRepo.remove('unmarked'))).toBe(5);
    },
  );

  it.each(DATED_KINDS)('$label makes the same statements on an edit off the mark', async (kind) => {
    seedDatedKind(kind);

    expect(await statementsDuring(() => edit('unmarked', 8_000))).toBe(4);
  });

  it.each(DATED_KINDS)('$label makes one statement fewer on a delete on the mark', async (kind) => {
    seedDatedKind(kind);

    expect(await statementsDuring(() => transactionsRepo.remove('marked'))).toBe(4);
  });

  it.each(DATED_KINDS)('$label makes one statement fewer on an edit on the mark', async (kind) => {
    seedDatedKind(kind);

    expect(await statementsDuring(() => edit('marked', 8_000))).toBe(3);
  });

  it.each(DATED_KINDS)(
    '$label makes the same statements on the confirm of a delete off the mark',
    async (kind) => {
      seedDatedKind(kind);

      expect(await statementsDuring(() => transactionsRepo.removePlan('unmarked'))).toBe(2);
    },
  );

  it.each(DATED_KINDS)(
    '$label makes the same statements on the confirm of a delete on the mark',
    async (kind) => {
      seedDatedKind(kind);

      expect(await statementsDuring(() => transactionsRepo.removePlan('marked'))).toBe(2);
    },
  );
});

describe('a holding that is not on the dated list', () => {
  // The mark is a hand-made file's: no sync of these kinds writes one. The statements are those of
  // one `remove` and one `update`, counted for a holding with no mark.
  const KINDS = [
    {
      label: 'Monobank',
      metadata: { monobankId: 'card-1', syncedAt: MOVED },
      source: 'manual',
      deleteStatements: 5,
    },
    { label: 'a manual holding', metadata: {}, source: 'manual', deleteStatements: 5 },
    // The key of a deleted import row is one more insert.
    {
      label: 'a bank holding with an import row',
      metadata: {},
      source: 'import',
      deleteStatements: 6,
    },
  ];
  const EDITABLE_KINDS = KINDS.filter(({ source }) => source === 'manual');
  const EDIT_STATEMENTS = 4;
  const PLAN_STATEMENTS = 2;

  const seedKind = ({ metadata, source }: (typeof KINDS)[number]): void => {
    seedKindHolding(metadata, 'row');
    insertRow({ id: 'row', holdingId: 'kind', amountMinorUnits: 5_000, source });
  };

  it.each(KINDS)('$label moves by a delete as today, with a mark in its metadata', async (kind) => {
    seedKind(kind);

    expect((await transactionsRepo.removePlan('row')).balanceChanges).toEqual([
      { name: 'kind', currency: 'UAH', minorUnits: -5_000 },
    ]);

    await transactionsRepo.remove('row');

    expect(rowIds()).toEqual([]);
    expect(balancesOf()).toMatchObject({ kind: 95_000 });
  });

  it.each(EDITABLE_KINDS)(
    '$label moves by an edit as today, with a mark in its metadata',
    async (kind) => {
      seedKind(kind);

      await edit('row', 8_000);

      expect(balancesOf()).toMatchObject({ kind: 103_000 });
    },
  );

  it.each(KINDS)('$label makes the same statements on a delete', async (kind) => {
    seedKind(kind);

    expect(await statementsDuring(() => transactionsRepo.remove('row'))).toBe(
      kind.deleteStatements,
    );
  });

  it.each(KINDS)('$label makes the same statements on the confirm of a delete', async (kind) => {
    seedKind(kind);

    expect(await statementsDuring(() => transactionsRepo.removePlan('row'))).toBe(PLAN_STATEMENTS);
  });

  it.each(EDITABLE_KINDS)('$label makes the same statements on an edit', async (kind) => {
    seedKind(kind);

    expect(await statementsDuring(() => edit('row', 8_000))).toBe(EDIT_STATEMENTS);
  });
});
