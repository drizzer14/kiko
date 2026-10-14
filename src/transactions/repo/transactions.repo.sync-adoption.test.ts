// A statement imported over a disconnect writes `import` rows, and the reconnect
// sync fetches the same purchases under keys no import row holds. The sync turns
// each import row into its own row in place: only a real engine shows that the
// ledger keeps one row per purchase, what the adopted row keeps, and that no
// balance moves.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { exchangeExcludedTransactionIds } from '@kiko/statistics/exchange-exclusion';

import { transactionsRepo } from './transactions.repo';

const T = Date.UTC(2026, 8, 20, 10);
const SECOND = 1_000;
const BALANCE = 90_000;

type SqlParameter = string | number | null;
type SyncItem = Parameters<typeof transactionsRepo.addManyDedup>[0][number];

const run = (statement: string, ...parameters: SqlParameter[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const scalarOf = (statement: string, ...parameters: SqlParameter[]): unknown =>
  (mockDatabase.prepare(statement).get(...parameters) as { value: unknown }).value;

const balanceOf = (holdingId = 'card'): number =>
  scalarOf('SELECT balance_minor_units AS value FROM holdings WHERE id = ?', holdingId) as number;

const ledgerSumOf = (holdingId = 'card'): number =>
  scalarOf(
    'SELECT coalesce(sum(amount_minor_units), 0) AS value FROM transactions WHERE holding_id = ?',
    holdingId,
  ) as number;

const holdingsSnapshot = (): unknown => mockDatabase.prepare('SELECT * FROM holdings').all();

const storedRows = () =>
  mockDatabase
    .prepare(
      `SELECT id, holding_id AS holdingId, amount_minor_units AS amount, time, source,
        external_id AS externalId, description, category, comment, mcc, hold,
        counter_iban AS counterIban, loan_holding_id AS loanHoldingId,
        loan_link_source AS loanLinkSource, loan_link_rejected AS loanLinkRejected,
        exchange_pair_id AS pairId, exchange_counterpart_holding_id AS marker
       FROM transactions ORDER BY time, source, id`,
    )
    .all() as {
    id: string;
    holdingId: string;
    amount: number;
    time: number;
    source: string;
    externalId: string | null;
    description: string;
    category: string | null;
    comment: string | null;
    mcc: number | null;
    hold: number | null;
    counterIban: string | null;
    loanHoldingId: string | null;
    loanLinkSource: string | null;
    loanLinkRejected: number;
    pairId: string | null;
    marker: string | null;
  }[];

const sourcesOf = (): string[] => storedRows().map((row) => row.source);

const insertRow = (columns: Record<string, SqlParameter>): void => {
  const row = {
    holding_id: 'card',
    amount_minor_units: -5_000,
    time: T,
    source: 'import',
    description: 'from file',
    external_id: columns.id,
    ...columns,
  };

  run(
    `INSERT INTO transactions (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row)
      .map(() => '?')
      .join(', ')})`,
    ...Object.values(row),
  );
};

const syncItem = (
  externalId: string,
  time: number,
  overrides: Partial<SyncItem> = {},
): SyncItem => ({
  holdingId: 'card',
  amountMinorUnits: -5_000,
  time,
  source: 'monobank',
  description: 'Cafe',
  category: 'restaurants',
  mcc: 5812,
  hold: false,
  externalId,
  ...overrides,
});

const sync = (items: SyncItem[]): Promise<number> => transactionsRepo.addManyDedup(items);

const excludedIds = (): Set<string> =>
  exchangeExcludedTransactionIds(
    storedRows().map(({ id, marker }) => ({ id, exchangeCounterpartHoldingId: marker })),
  );

// An import row of -40 000 on the card, Converted to a manual USD leg while it
// is still the user's, then adopted by the reconnect sync: it is the bank's row
// and carries the Convert's pair id and marker.
const adoptedConvertToDollars = async () => {
  insertRow({ id: 'i1', time: T, amount_minor_units: -40_000 });
  await transactionsRepo.recordExchangeCounterpart({
    direction: 'record-destination',
    counterpartHoldingId: 'usd',
    counterpartType: 'card',
    amountMinorUnits: 1_000,
    existingTransactionId: 'i1',
    existingHoldingId: 'card',
    time: T,
  });
  const markedPairId = storedRows().find((row) => row.id === 'i1')?.pairId;
  const manualLegId = storedRows().find((row) => row.holdingId === 'usd')?.id ?? '';

  return {
    inserted: await sync([syncItem('k1', T + SECOND, { amountMinorUnits: -40_000 })]),
    markedPairId,
    manualLegId,
  };
};

// An import row of -40 000 on the card, Converted into a term deposit while it is
// still the user's: the deposit takes the contribution and the row carries the
// pair id and the `deposit` marker.
const convertedIntoDeposit = async (): Promise<void> => {
  run(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
     VALUES ('deposit', 'account', 'Deposit', 'term_deposit', 'UAH', 0,
       '{"contributions":[{"amountMinorUnits":500000,"date":${T}}],"annualRatePct":10,"termMonths":12,"recapitalization":true,"compounding":"monthly"}')`,
  );
  insertRow({ id: 'i1', time: T, amount_minor_units: -40_000 });
  await transactionsRepo.recordExchangeCounterpart({
    direction: 'record-destination',
    counterpartHoldingId: 'deposit',
    counterpartType: 'term_deposit',
    amountMinorUnits: 40_000,
    existingTransactionId: 'i1',
    existingHoldingId: 'card',
    time: T,
  });
};

// The deposit source leg Converted again, into the dollar card, then adopted: the
// dollar leg joins the pair and the row keeps the marker of the deposit.
const adoptedDepositSourceConvertedToDollars = async (): Promise<string> => {
  await convertedIntoDeposit();
  await transactionsRepo.recordExchangeCounterpart({
    direction: 'record-destination',
    counterpartHoldingId: 'usd',
    counterpartType: 'card',
    amountMinorUnits: 1_000,
    existingTransactionId: 'i1',
    existingHoldingId: 'card',
    time: T,
  });
  await sync([syncItem('k1', T + SECOND, { amountMinorUnits: -40_000 })]);

  return storedRows().find((row) => row.holdingId === 'usd')?.id ?? '';
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  run(
    `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES
      ('card', 'account', 'Card', 'card', 'UAH', ${BALANCE}),
      ('other', 'account', 'Other card', 'card', 'UAH', 0),
      ('usd', 'account', 'Dollar card', 'card', 'USD', 0),
      ('cash', 'account', 'Cash', 'cash', 'UAH', 0)`,
  );
});

describe('a sync item adopts its import twin', () => {
  it('turns each import row into the sync row of its own purchase, keeping its own category', async () => {
    insertRow({ id: 'i1', time: T, category: 'food' });
    insertRow({ id: 'i2', time: T + 30 * SECOND, category: 'cafe' });

    const inserted = await sync([syncItem('k1', T + 5 * SECOND), syncItem('k2', T + 40 * SECOND)]);

    expect(inserted).toBe(0);
    expect(storedRows()).toMatchObject([
      { id: 'i1', source: 'monobank', externalId: 'k1', category: 'food', time: T + 5 * SECOND },
      { id: 'i2', source: 'monobank', externalId: 'k2', category: 'cafe', time: T + 40 * SECOND },
    ]);
    expect(balanceOf()).toBe(BALANCE);
  });

  it('adopts only the earliest of two import rows for one purchase', async () => {
    insertRow({ id: 'i1', time: T });
    insertRow({ id: 'i2', time: T + 30 * SECOND });

    const inserted = await sync([syncItem('k1', T + 20 * SECOND)]);

    expect(inserted).toBe(0);
    expect(storedRows()).toHaveLength(2);
    expect(sourcesOf()).toEqual(['monobank', 'import']);
    expect(ledgerSumOf()).toBe(-10_000);
  });

  it('inserts the second purchase when one import row has been given to the first', async () => {
    insertRow({ id: 'i1', time: T });

    const inserted = await sync([syncItem('k1', T + 5 * SECOND), syncItem('k2', T + 40 * SECOND)]);

    expect(inserted).toBe(1);
    expect(storedRows()).toHaveLength(2);
    expect(sourcesOf()).toEqual(['monobank', 'monobank']);
  });

  it('overwrites the bank-owned columns and keeps the id', async () => {
    insertRow({
      id: 'i1',
      time: T,
      category: 'gifts',
      comment: 'from file',
      description: 'Shop from file',
    });

    await sync([
      syncItem('k1', T + 7 * SECOND, {
        description: 'Rozetka',
        mcc: 5311,
        counterIban: 'UA213223130000026007233566001',
        category: 'shopping',
        comment: 'bank note',
      }),
    ]);

    expect(storedRows()).toEqual([
      expect.objectContaining({
        id: 'i1',
        source: 'monobank',
        externalId: 'k1',
        description: 'Rozetka',
        mcc: 5311,
        counterIban: 'UA213223130000026007233566001',
        time: T + 7 * SECOND,
        category: 'gifts',
        comment: 'from file',
      }),
    ]);
  });

  it('fills a category and a comment the import row never had', async () => {
    insertRow({ id: 'i1', time: T, category: null, comment: null });

    await sync([syncItem('k1', T, { category: 'groceries', comment: 'bank note' })]);

    expect(storedRows()).toMatchObject([{ id: 'i1', category: 'groceries', comment: 'bank note' }]);
  });

  it('fills a missing category by the name rule an inserted row would get', async () => {
    run(
      `INSERT INTO category_rules (id, category, matchers)
       VALUES ('rozetka', 'gifts', '[{"type":"nameIs","text":"Rozetka"}]')`,
    );
    insertRow({ id: 'i1', time: T, category: null });

    await sync([syncItem('k1', T, { description: 'Rozetka', category: 'shopping' })]);

    expect(storedRows()).toMatchObject([{ id: 'i1', category: 'gifts' }]);
  });

  it('inserts a purchase no import row is near, as it always did', async () => {
    const inserted = await sync([syncItem('k1', T)]);

    expect(inserted).toBe(1);
    expect(sourcesOf()).toEqual(['monobank']);
  });

  it.each([
    ['61 seconds before', -61 * SECOND, ['import', 'monobank']],
    ['60 seconds before', -60 * SECOND, ['monobank']],
    ['60 seconds after', 60 * SECOND, ['monobank']],
    ['61 seconds after', 61 * SECOND, ['monobank', 'import']],
  ])('reaches an import row dated %s only up to the window', async (_name, offset, sources) => {
    insertRow({ id: 'i1', time: T + offset });

    await sync([syncItem('k1', T)]);

    expect(sourcesOf()).toEqual(sources);
  });

  it('never adopts a row of another holding of the account', async () => {
    insertRow({ id: 'on-other-card', time: T, holding_id: 'other' });
    insertRow({ id: 'on-cash', time: T, holding_id: 'cash' });

    const inserted = await sync([syncItem('k1', T)]);

    expect(inserted).toBe(1);
    expect(sourcesOf()).toEqual(['import', 'import', 'monobank']);
  });

  it('never adopts a row of another currency', async () => {
    insertRow({ id: 'i1', time: T, holding_id: 'usd' });

    const inserted = await sync([syncItem('k1', T)]);

    expect(inserted).toBe(1);
    expect(sourcesOf()).toEqual(['import', 'monobank']);
  });

  it('leaves an import row with no bank twin alone and inserts the bank row it lacks', async () => {
    const hour = 3_600 * SECOND;

    insertRow({ id: 'i1', time: T - hour, amount_minor_units: -1_000 });
    insertRow({ id: 'i2', time: T + hour, amount_minor_units: -2_000 });
    insertRow({ id: 'i3', time: T + 3 * hour, amount_minor_units: -3_000 });
    insertRow({ id: 'i4', time: T + 5 * hour, amount_minor_units: -9_900 });

    const inserted = await sync([
      syncItem('k1', T - hour + 2 * SECOND, { amountMinorUnits: -1_000 }),
      syncItem('k2', T + hour + SECOND, { amountMinorUnits: -2_000 }),
      syncItem('k3', T + 4 * hour, { amountMinorUnits: -4_000 }),
    ]);

    expect(inserted).toBe(1);
    expect(storedRows()).toHaveLength(5);
    expect(sourcesOf()).toEqual(['monobank', 'monobank', 'import', 'monobank', 'import']);
  });

  it('refreshes an adopted row on the next sync and never adopts again', async () => {
    insertRow({ id: 'i1', time: T });
    insertRow({ id: 'i2', time: T + 30 * SECOND });
    const items = [syncItem('k1', T + 5 * SECOND), syncItem('k2', T + 40 * SECOND)];

    await sync(items);
    const adopted = storedRows();
    const inserted = await sync(items);

    expect(inserted).toBe(0);
    expect(storedRows()).toEqual(adopted);
  });

  it('never adopts for a refetched key, so the import row that was left stays', async () => {
    insertRow({ id: 'i1', time: T });
    insertRow({ id: 'i2', time: T + 30 * SECOND });
    const items = [syncItem('k1', T + 20 * SECOND)];

    await sync(items);
    await sync(items);

    expect(sourcesOf()).toEqual(['monobank', 'import']);
  });

  it('never adopts a refund for a purchase of the same size', async () => {
    insertRow({ id: 'i1', time: T, amount_minor_units: 5_000 });

    const inserted = await sync([syncItem('k1', T)]);

    expect(inserted).toBe(1);
    expect(sourcesOf()).toEqual(['import', 'monobank']);
  });

  it('adopts a purchase and its reversal each by its own sign', async () => {
    insertRow({ id: 'i1', time: T });
    insertRow({ id: 'i2', time: T + 10 * SECOND, amount_minor_units: 5_000 });

    const inserted = await sync([
      syncItem('k1', T + SECOND),
      syncItem('k2', T + 12 * SECOND, { amountMinorUnits: 5_000 }),
    ]);

    expect(inserted).toBe(0);
    expect(sourcesOf()).toEqual(['monobank', 'monobank']);
    expect(ledgerSumOf()).toBe(0);
  });

  it('adopts a still pending purchase at its bank-owned hold flag, which a settled fetch then refreshes', async () => {
    insertRow({ id: 'i1', time: T, amount_minor_units: -30_000 });

    await sync([syncItem('k1', T, { amountMinorUnits: -30_000, hold: true })]);

    expect(storedRows()).toMatchObject([{ id: 'i1', source: 'monobank', hold: 1 }]);

    await sync([syncItem('k1', T, { amountMinorUnits: -33_000, hold: false })]);

    expect(storedRows()).toMatchObject([{ id: 'i1', amount: -33_000, hold: 0 }]);
  });

  it('does not adopt a purchase whose amount differs, a pending file amount against a settled tip', async () => {
    insertRow({ id: 'i1', time: T, amount_minor_units: -30_000 });

    const inserted = await sync([syncItem('k1', T, { amountMinorUnits: -33_000 })]);

    expect(inserted).toBe(1);
    expect(sourcesOf()).toEqual(['import', 'monobank']);
  });

  it('keeps a loan link, its source and its rejected flag', async () => {
    insertRow({
      id: 'manual-link',
      time: T,
      loan_holding_id: 'loan-a',
      loan_link_source: 'manual',
    });
    insertRow({
      id: 'auto-link',
      time: T + 10 * SECOND,
      amount_minor_units: -6_000,
      loan_holding_id: 'loan-b',
      loan_link_source: 'auto',
    });
    insertRow({
      id: 'rejected',
      time: T + 20 * SECOND,
      amount_minor_units: -7_000,
      loan_link_rejected: 1,
    });

    await sync([
      syncItem('k1', T),
      syncItem('k2', T + 10 * SECOND, { amountMinorUnits: -6_000 }),
      syncItem('k3', T + 20 * SECOND, { amountMinorUnits: -7_000 }),
    ]);

    expect(storedRows()).toMatchObject([
      { id: 'manual-link', loanHoldingId: 'loan-a', loanLinkSource: 'manual' },
      { id: 'auto-link', loanHoldingId: 'loan-b', loanLinkSource: 'auto' },
      { id: 'rejected', loanHoldingId: null, loanLinkRejected: 1 },
    ]);
  });

  it('adopts a legacy import row beside a stored synced row of the same size and time', async () => {
    insertRow({ id: 'legacy-import', time: T });
    insertRow({ id: 'earlier-sync', time: T, source: 'monobank', external_id: 'k0' });

    const inserted = await sync([syncItem('k1', T + 20 * SECOND)]);

    expect(inserted).toBe(0);
    expect(storedRows()).toHaveLength(2);
    expect(sourcesOf()).toEqual(['monobank', 'monobank']);
  });

  it('only refreshes a stored synced row and never adopts for it', async () => {
    insertRow({ id: 'i1', time: T });
    insertRow({ id: 'earlier-sync', time: T, source: 'monobank', external_id: 'k0' });

    await sync([syncItem('k0', T)]);

    expect(sourcesOf()).toEqual(['import', 'monobank']);
  });

  it('never adopts a manual row, which stays the user’s to delete', async () => {
    insertRow({ id: 'typed', time: T, source: 'manual', external_id: null });

    const inserted = await sync([syncItem('k1', T)]);

    expect(inserted).toBe(1);
    expect(sourcesOf()).toEqual(['manual', 'monobank']);
  });

  it('adopts for a Binance row the same way', async () => {
    insertRow({ id: 'i1', time: T });

    const inserted = await sync([syncItem('b1', T + SECOND, { source: 'binance', mcc: null })]);

    expect(inserted).toBe(0);
    expect(storedRows()).toMatchObject([{ id: 'i1', source: 'binance', externalId: 'b1' }]);
  });

  it('adopts for one copy of an item an overlapping page carried twice', async () => {
    insertRow({ id: 'i1', time: T });

    const inserted = await sync([syncItem('k1', T), syncItem('k1', T)]);

    expect(inserted).toBe(0);
    expect(storedRows()).toHaveLength(1);
    expect(sourcesOf()).toEqual(['monobank']);
  });

  it('holds a later import of the same statement as it holds any synced row', async () => {
    insertRow({ id: 'i1', time: T });
    await sync([syncItem('k1', T + 5 * SECOND)]);

    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [
        {
          holdingId: 'card',
          amountMinorUnits: -5_000,
          time: T,
          source: 'import',
          externalId: 'i1',
        },
      ],
    });

    expect(imported).toBe(0);
    expect(storedRows()).toHaveLength(1);
    expect(balanceOf()).toBe(BALANCE);
  });

  it('puts the adopted row into the import boundary like an inserted one', async () => {
    insertRow({ id: 'i1', time: T });
    await sync([syncItem('k1', T + 20 * SECOND)]);

    await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [
        {
          holdingId: 'card',
          amountMinorUnits: -1_000,
          time: T - 5 * 60 * SECOND,
          source: 'import',
          externalId: 'older',
        },
      ],
    });

    expect(storedRows()).toHaveLength(2);
    expect(balanceOf()).toBe(BALANCE);
  });
});

describe('a sync item adopting its import twin and the balance', () => {
  it('leaves the holding exactly as it was and the ledger with one row per purchase', async () => {
    run("UPDATE holdings SET balance_minor_units = 0 WHERE id = 'card'");

    await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [
        { holdingId: 'card', amountMinorUnits: -5_000, time: T, source: 'import', externalId: 'a' },
        {
          holdingId: 'card',
          amountMinorUnits: -3_000,
          time: T + 3_600 * SECOND,
          source: 'import',
          externalId: 'b',
        },
      ],
      closingBalance: {
        minorUnits: 82_000,
        currency: 'UAH',
        asOfSeconds: (T + 3_600 * SECOND) / 1000,
      },
    });
    const holdingAfterImport = holdingsSnapshot();

    const inserted = await sync([
      syncItem('k1', T + 4 * SECOND),
      syncItem('k2', T + 3_600 * SECOND + 6 * SECOND, { amountMinorUnits: -3_000 }),
    ]);

    expect(inserted).toBe(0);
    expect(storedRows()).toHaveLength(2);
    expect(ledgerSumOf()).toBe(-8_000);
    expect(balanceOf()).toBe(82_000);
    expect(holdingsSnapshot()).toEqual(holdingAfterImport);
  });

  it('reverses only the amount of an import row deleted before the reconnect, which the sync then inserts', async () => {
    insertRow({ id: 'i1', time: T });

    await transactionsRepo.remove('i1');

    expect(balanceOf()).toBe(BALANCE + 5_000);

    const inserted = await sync([syncItem('k1', T + SECOND)]);

    expect(inserted).toBe(1);
    expect(storedRows()).toMatchObject([{ source: 'monobank', externalId: 'k1' }]);
    expect(balanceOf()).toBe(BALANCE + 5_000);
  });

  it('keeps the exchange pair of an import row a Convert marked, whose manual leg alone is then deleted, and drops its marker', async () => {
    const { inserted, markedPairId, manualLegId } = await adoptedConvertToDollars();

    expect(inserted).toBe(0);
    expect(markedPairId).toEqual(expect.any(String));
    expect(storedRows().find((row) => row.id === 'i1')).toMatchObject({
      source: 'monobank',
      externalId: 'k1',
      pairId: markedPairId,
      marker: 'usd',
    });
    expect(await transactionsRepo.removePlan(manualLegId)).toMatchObject({
      split: false,
      exchange: { kind: 'syncedKept', names: ['Card'] },
      balanceChanges: [{ name: 'Dollar card', currency: 'USD', minorUnits: -1_000 }],
    });

    const cardBalance = balanceOf();
    await transactionsRepo.remove(manualLegId);

    expect(storedRows()).toMatchObject([
      { id: 'i1', source: 'monobank', pairId: markedPairId, marker: null },
    ]);
    expect(excludedIds()).toEqual(new Set());
    expect(balanceOf('usd')).toBe(0);
    expect(balanceOf()).toBe(cardBalance);
  });

  it('drops the marker of an adopted row when the other holding of its Convert is deleted', async () => {
    const { markedPairId } = await adoptedConvertToDollars();
    const cardBalance = balanceOf();

    await transactionsRepo.removeHolding('usd');

    expect(storedRows()).toMatchObject([
      { id: 'i1', source: 'monobank', pairId: markedPairId, marker: null },
    ]);
    expect(excludedIds()).toEqual(new Set());
    expect(balanceOf()).toBe(cardBalance);
  });

  it('clears the marker of an adopted deposit source leg when the deposit is deleted', async () => {
    await convertedIntoDeposit();
    await sync([syncItem('k1', T + SECOND, { amountMinorUnits: -40_000 })]);
    const cardBalance = balanceOf();

    expect(storedRows()).toMatchObject([{ id: 'i1', source: 'monobank', marker: 'deposit' }]);

    await transactionsRepo.removeHolding('deposit');

    expect(storedRows()).toMatchObject([{ id: 'i1', source: 'monobank', marker: null }]);
    expect(excludedIds()).toEqual(new Set());
    expect(balanceOf()).toBe(cardBalance);
  });

  describe('a bank-owned row of a split group', () => {
    const insertBankRowOfSplit = (columns: Record<string, SqlParameter>): void => {
      insertRow({
        id: 'bank-row',
        source: 'monobank',
        change_group_id: 'group',
        exchange_counterpart_holding_id: 'usd',
        ...columns,
      });
    };
    const insertReturn = (): void => {
      insertRow({
        id: 'return',
        holding_id: 'cash',
        amount_minor_units: 5_000,
        source: 'manual',
        external_id: null,
        change_group_id: 'group',
      });
    };

    it('keeps a marker only the split group reaches, which names no leg this delete removes', async () => {
      insertBankRowOfSplit({});
      insertReturn();

      await transactionsRepo.remove('return');

      expect(storedRows()).toMatchObject([{ id: 'bank-row', marker: 'usd' }]);
    });

    it('clears the marker when the same pair held the leg it names, removed with the split', async () => {
      insertBankRowOfSplit({ exchange_pair_id: 'pair' });
      insertReturn();
      insertRow({
        id: 'dollar-leg',
        holding_id: 'usd',
        amount_minor_units: 1_000,
        source: 'manual',
        external_id: null,
        exchange_pair_id: 'pair',
        exchange_counterpart_holding_id: 'card',
      });

      await transactionsRepo.remove('return');

      expect(storedRows()).toMatchObject([{ id: 'bank-row', pairId: 'pair', marker: null }]);
    });
  });

  describe('an adopted deposit source leg Converted again, into the dollar card', () => {
    it('keeps the deposit marker when only the dollar leg is deleted', async () => {
      const dollarLegId = await adoptedDepositSourceConvertedToDollars();

      expect(storedRows().find((row) => row.id === 'i1')?.marker).toBe('deposit');

      await transactionsRepo.remove(dollarLegId);

      expect(storedRows()).toMatchObject([{ id: 'i1', source: 'monobank', marker: 'deposit' }]);
      expect(excludedIds()).toEqual(new Set(['i1']));
      expect(balanceOf('usd')).toBe(0);
    });

    it('keeps the deposit marker when the dollar card is deleted', async () => {
      await adoptedDepositSourceConvertedToDollars();

      await transactionsRepo.removeHolding('usd');

      expect(storedRows()).toMatchObject([{ id: 'i1', source: 'monobank', marker: 'deposit' }]);
      expect(excludedIds()).toEqual(new Set(['i1']));
    });

    it('clears the deposit marker when the deposit is deleted', async () => {
      await adoptedDepositSourceConvertedToDollars();

      await transactionsRepo.removeHolding('deposit');

      expect(storedRows().find((row) => row.id === 'i1')?.marker).toBeNull();
    });
  });
});

describe('a statement import never adopts', () => {
  it('inserts two import rows of one amount within 60 seconds', async () => {
    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [
        { holdingId: 'card', amountMinorUnits: -5_000, time: T, source: 'import', externalId: 'a' },
        {
          holdingId: 'card',
          amountMinorUnits: -5_000,
          time: T + 30 * SECOND,
          source: 'import',
          externalId: 'b',
        },
      ],
    });

    expect(imported).toBe(2);
    expect(sourcesOf()).toEqual(['import', 'import']);
  });

  it('leaves a stored import row an incoming import row of the same amount and time beside it', async () => {
    insertRow({ id: 'i1', time: T });

    const imported = await transactionsRepo.importRows({
      holdingId: 'card',
      rows: [
        {
          holdingId: 'card',
          amountMinorUnits: -5_000,
          time: T + 10 * SECOND,
          source: 'import',
          externalId: 'other-file-key',
        },
      ],
    });

    expect(imported).toBe(1);
    expect(storedRows()).toMatchObject([
      { id: 'i1', source: 'import', externalId: 'i1' },
      { source: 'import', externalId: 'other-file-key' },
    ]);
  });
});
