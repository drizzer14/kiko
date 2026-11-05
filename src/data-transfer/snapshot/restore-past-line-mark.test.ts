// src/data-transfer/snapshot/restore-past-line-mark.test.ts
//
// A Bybit holding's metadata will name ledger rows by id (the mark of the past line), so a `.kiko`
// restore must give back every row with the id it was exported under, and the holding with its
// metadata whole. The real export read, the real restore and the real tables run on a fully
// migrated `node:sqlite` engine, through JSON text, as a file travels.
//
// `overwrittenRowIds` is seeded here as a plain metadata key, by raw SQL, so the proof rests on
// the restore alone and not on the code that writes the mark.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import maybe, { foldMap } from 'fnts/maybe';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { buildNetWorthSeries } from '@kiko/statistics/net-worth-series';

import { EXPORT_VERSION } from '../crypto/envelope';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';
import { LAST_SCALE_2_USDT_VERSION } from './with-usdt-rescaled';

const SET_AT = Date.UTC(2026, 2, 4, 9);
const IMPORTED_AT = Date.UTC(2026, 2, 3, 9, 45);
// 09:45 read as Kyiv wall clock in March (UTC+2).
const REZONED_AT = Date.UTC(2026, 2, 3, 7, 45);
const EXCHANGED_AT = Date.UTC(2026, 2, 6, 10);
const TYPED_AT = Date.UTC(2026, 2, 5, 12);
const BYBIT_FILL_AT = Date.UTC(2026, 2, 1, 8);
const READ_AT = Date.UTC(2026, 2, 10, 12);

const IMPORT_KEY_BASE = `holding-btc ${IMPORTED_AT / 1000} 250000 coffee`;
const CURRENT_IMPORT_KEY = `${IMPORT_KEY_BASE}␟1`;
const LEGACY_IMPORT_KEY = `${IMPORT_KEY_BASE} 1`;
const REZONED_IMPORT_KEY = `holding-btc ${REZONED_AT / 1000} 250000 coffee␟1`;

const BTC_METADATA = {
  bybitAsset: 'BTC:unified',
  balanceReadAt: READ_AT,
  overwrittenRowIds: [
    'row-exchange-leg',
    'row-import',
    'row-sets-balance',
    'row-split-return',
    'row-typed',
  ],
};

const USDT_METADATA = {
  bybitAsset: 'USDT:unified',
  balanceReadAt: READ_AT,
  overwrittenRowIds: ['usdt-sets-balance', 'usdt-typed'],
};

const SOURCE_BY_ROW_ID = {
  'row-bybit': 'bybit',
  'row-exchange-cash': 'manual',
  'row-exchange-leg': 'manual',
  'row-import': 'import',
  'row-sets-balance': 'manual',
  'row-split-payment': 'manual',
  'row-split-return': 'manual',
  'row-typed': 'manual',
  'usdt-bybit': 'bybit',
  'usdt-sets-balance': 'manual',
  'usdt-typed': 'manual',
};

const ALL_ROW_IDS = Object.keys(SOURCE_BY_ROW_ID);

type Parameter = string | number | null;

type SeedRow = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  source?: 'bybit' | 'import';
  description?: string;
  category?: string;
  setsBalance?: boolean;
  exchangeCounterpartHoldingId?: string;
  exchangePairId?: string;
  changeGroupId?: string;
  externalId?: string;
};

type SeedHolding = {
  id: string;
  accountId: string;
  type: string;
  currency: string;
  balance: number;
  balanceSetAt?: number;
  balanceSetRowId?: string;
  metadata?: object;
};

const run = (statement: string, ...parameters: Parameter[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const openDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON;');

  return database;
};

const insertRow = (row: SeedRow): void => {
  run(
    `INSERT INTO transactions
       (id, holding_id, amount_minor_units, time, source, description, category, sets_balance,
        exchange_counterpart_holding_id, exchange_pair_id, change_group_id, external_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.holdingId,
    row.amountMinorUnits,
    row.time,
    row.source ?? 'manual',
    row.description ?? '',
    row.category ?? null,
    row.setsBalance === true ? 1 : 0,
    row.exchangeCounterpartHoldingId ?? null,
    row.exchangePairId ?? null,
    row.changeGroupId ?? null,
    row.externalId ?? null,
  );
};

const insertHolding = (holding: SeedHolding): void => {
  run(
    `INSERT INTO holdings
       (id, account_id, name, type, currency, balance_minor_units, balance_set_at,
        balance_set_row_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    holding.id,
    holding.accountId,
    holding.id,
    holding.type,
    holding.currency,
    holding.balance,
    holding.balanceSetAt ?? null,
    holding.balanceSetRowId ?? null,
    foldMap(maybe(holding.metadata), (metadata) => JSON.stringify(metadata)) ?? null,
  );
};

// A Bybit account that was read, disconnected, typed into, and read again: every kind of row the
// app writes on a Bybit holding while it is disconnected (a typed row, a balance edit, an
// Exchange leg whose other leg is on a cash holding, a split's return), the account's own
// Bybit rows, and an import row, which the app never writes there and only a hand-made file can
// hold. The marks name the rows that are not Bybit's, as the seed of the mark will.
const seedBybitLedger = (): void => {
  run(
    `INSERT INTO accounts (id, name, kind, institution, currency)
     VALUES ('account-bybit', 'Bybit', 'crypto', 'bybit', 'USD')`,
  );
  run(
    `INSERT INTO accounts (id, name, kind, currency)
     VALUES ('account-cash', 'Wallet', 'cash', 'USD')`,
  );
  run('INSERT INTO settings (id, dedup_keys_upgraded, import_times_rezoned) VALUES (1, 1, 1)');
  insertHolding({
    id: 'holding-btc',
    accountId: 'account-bybit',
    type: 'crypto_asset',
    currency: 'BTC',
    balance: 100_000_000,
    balanceSetAt: SET_AT,
    balanceSetRowId: 'row-sets-balance',
    metadata: BTC_METADATA,
  });
  insertHolding({
    id: 'holding-usdt',
    accountId: 'account-bybit',
    type: 'crypto_asset',
    currency: 'USDT',
    balance: 7_000,
    balanceSetAt: SET_AT,
    balanceSetRowId: 'usdt-sets-balance',
    metadata: USDT_METADATA,
  });
  insertHolding({
    id: 'holding-cash',
    accountId: 'account-cash',
    type: 'cash',
    currency: 'USD',
    balance: 99_500,
  });

  insertRow({
    id: 'row-bybit',
    holdingId: 'holding-btc',
    amountMinorUnits: 5_000_000,
    time: BYBIT_FILL_AT,
    source: 'bybit',
    externalId: 'BTC:unified:fill-1',
  });
  insertRow({
    id: 'row-typed',
    holdingId: 'holding-btc',
    amountMinorUnits: 50_000_000,
    time: TYPED_AT,
    description: 'typed',
    category: 'food',
  });
  insertRow({
    id: 'row-sets-balance',
    holdingId: 'holding-btc',
    amountMinorUnits: 10_000_000,
    time: SET_AT,
    setsBalance: true,
  });
  insertRow({
    id: 'row-exchange-leg',
    holdingId: 'holding-btc',
    amountMinorUnits: -20_000_000,
    time: EXCHANGED_AT,
    exchangeCounterpartHoldingId: 'holding-cash',
    exchangePairId: 'row-exchange-cash',
  });
  insertRow({
    id: 'row-exchange-cash',
    holdingId: 'holding-cash',
    amountMinorUnits: 100_000,
    time: EXCHANGED_AT,
    exchangeCounterpartHoldingId: 'holding-btc',
    exchangePairId: 'row-exchange-cash',
  });
  insertRow({
    id: 'row-split-payment',
    holdingId: 'holding-cash',
    amountMinorUnits: -500,
    time: TYPED_AT,
    description: 'split',
    category: 'food',
    changeGroupId: 'group-split',
  });
  insertRow({
    id: 'row-split-return',
    holdingId: 'holding-btc',
    amountMinorUnits: 30_000,
    time: TYPED_AT,
    description: 'split',
    changeGroupId: 'group-split',
  });
  insertRow({
    id: 'row-import',
    holdingId: 'holding-btc',
    amountMinorUnits: 250_000,
    time: IMPORTED_AT,
    source: 'import',
    description: 'coffee',
    externalId: CURRENT_IMPORT_KEY,
  });

  insertRow({
    id: 'usdt-bybit',
    holdingId: 'holding-usdt',
    amountMinorUnits: 4_000,
    time: BYBIT_FILL_AT,
    source: 'bybit',
    externalId: 'USDT:unified:fill-2',
  });
  insertRow({
    id: 'usdt-typed',
    holdingId: 'holding-usdt',
    amountMinorUnits: 2_000,
    time: TYPED_AT,
    description: 'typed',
    category: 'food',
  });
  insertRow({
    id: 'usdt-sets-balance',
    holdingId: 'holding-usdt',
    amountMinorUnits: 1_000,
    time: SET_AT,
    setsBalance: true,
  });
};

const throughJson = (snapshot: DataSnapshot): DataSnapshot => JSON.parse(JSON.stringify(snapshot));

// The type declares every key as present, and a file of an old build lacks some of them.
const withoutKeys = <Row extends object>(row: Row, keys: string[]): Row =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key))) as Row;

// What forces each mirror of `restoreDataSnapshot` to run on this file, and a value it rewrites,
// so a restore that skips one cannot pass:
// - version `LAST_SCALE_2_USDT_VERSION`: `withUsdtRescaled`, which multiplies every USDT amount
//   by 10^6.
// - no `currency` on any account: `withAccountCurrencyDerived`, which sets the Bybit account
//   (BTC and USDT holdings) to the base currency, UAH, where the seed says USD.
// - no `balanceSetAt` on the holdings: `withLegacyBalanceSetAtBackfilled`, which reads it back
//   from the latest balance-set row.
// - no `setsBalance` on the rows and no `balanceSetRowId` on the holdings:
//   `withLegacyBalanceSetMarksDerived`, which marks the two balance-set rows and names them.
// - no `exchangePairId` on the rows: `withLegacyExchangePairsDerived`, which gives both legs of
//   the Exchange the smaller of their two ids.
// - no `dedupKeysUpgraded` on the settings: `withLegacyDedupKeysUpgraded`, which turns the import
//   row's legacy occurrence suffix into the `␟` form.
// - `importTimesRezoned: false` on the settings: `withImportTimesRezoned`, which moves the import
//   row to the instant its wall clock names in Kyiv, and its key with it.
const asFileOfOldVersion = (snapshot: DataSnapshot): DataSnapshot => ({
  ...snapshot,
  accounts: snapshot.accounts.map((account) => withoutKeys(account, ['currency'])),
  holdings: snapshot.holdings.map((holding) =>
    withoutKeys(holding, ['balanceSetAt', 'balanceSetRowId']),
  ),
  transactions: snapshot.transactions.map((row) => {
    const withoutNewerKeys = withoutKeys(row, ['setsBalance', 'exchangePairId']);

    return row.source === 'import'
      ? { ...withoutNewerKeys, externalId: LEGACY_IMPORT_KEY }
      : withoutNewerKeys;
  }),
  settings: snapshot.settings.map((row) => ({
    ...withoutKeys(row, ['dedupKeysUpgraded']),
    importTimesRezoned: false,
  })),
});

const restoredIntoNewDatabase = async (file: DataSnapshot, version: number): Promise<void> => {
  mockDatabase = openDatabase();
  await restoreDataSnapshot(file, version);
};

const allOf = (statement: string, ...parameters: Parameter[]): unknown[] =>
  mockDatabase.prepare(statement).all(...parameters);

const storedRows = (): unknown[] => allOf('SELECT * FROM transactions ORDER BY id');

const storedHoldings = (): unknown[] => allOf('SELECT * FROM holdings ORDER BY id');

const rowIdsOf = (statement: string, ...parameters: Parameter[]): string[] =>
  (allOf(statement, ...parameters) as { id: string }[]).map((row) => row.id);

const sourceByRowId = (): Record<string, string> =>
  Object.fromEntries(
    (
      allOf('SELECT id, source FROM transactions ORDER BY id') as { id: string; source: string }[]
    ).map((row) => [row.id, row.source]),
  );

const metadataOf = (holdingId: string): unknown => {
  const row = mockDatabase.prepare('SELECT metadata FROM holdings WHERE id = ?').get(holdingId) as {
    metadata: string;
  };

  return JSON.parse(row.metadata);
};

const rowIdsOutsideBybit = (holdingId: string): string[] =>
  rowIdsOf(
    "SELECT id FROM transactions WHERE holding_id = ? AND source <> 'bybit' ORDER BY id",
    holdingId,
  );

// The net-worth line of the Bitcoin holding, as the Statistics screen draws it from what the
// database holds, one point per local midnight over the days around the seed's dates.
const lineOfBitcoinHolding = async (): Promise<number[]> => {
  const { holdings, transactions } = await readDataSnapshot();
  const holding = holdings.find(({ id }) => id === 'holding-btc');

  if (holding === undefined) {
    throw new Error('the seed should hold the Bitcoin holding');
  }

  const { points } = buildNetWorthSeries({
    holdings: [holding],
    transactionsByHolding: new Map([
      [holding.id, transactions.filter((row) => row.holdingId === holding.id)],
    ]),
    historyRows: [],
    baseCurrency: 'BTC',
    range: { from: new Date(2026, 1, 27).getTime(), to: new Date(2026, 2, 12).getTime() },
  });

  return points.map(({ amount }) => amount);
};

const expectRowIdsSourcesAndMarksKept = (): void => {
  expect(rowIdsOf('SELECT id FROM transactions ORDER BY id')).toEqual(ALL_ROW_IDS);
  expect(sourceByRowId()).toEqual(SOURCE_BY_ROW_ID);
  expect(metadataOf('holding-btc')).toEqual(BTC_METADATA);
  expect(metadataOf('holding-usdt')).toEqual(USDT_METADATA);
  expect(rowIdsOutsideBybit('holding-btc')).toEqual(BTC_METADATA.overwrittenRowIds);
  expect(rowIdsOutsideBybit('holding-usdt')).toEqual(USDT_METADATA.overwrittenRowIds);
};

describe('restoring a Bybit holding whose metadata names its rows by id', () => {
  beforeEach(() => {
    mockDatabase = openDatabase();
    seedBybitLedger();
  });

  it("a restore keeps every row id and the holding's mark", async () => {
    const rowsBeforeRestore = storedRows();
    const holdingsBeforeRestore = storedHoldings();

    expectRowIdsSourcesAndMarksKept();

    await restoredIntoNewDatabase(throughJson(await readDataSnapshot()), EXPORT_VERSION);

    expectRowIdsSourcesAndMarksKept();
    expect(storedRows()).toEqual(rowsBeforeRestore);
    expect(storedHoldings()).toEqual(holdingsBeforeRestore);
  });

  it('a restored holding draws the same line', async () => {
    const lineBeforeRestore = await lineOfBitcoinHolding();

    // The mark leaves the five rows that are not Bybit's off the line, so it opens at the read's
    // balance less the one Bybit fill, and a restore that lost the mark would draw another line.
    expect(lineBeforeRestore.at(0)).toBe(0.95);
    expect(lineBeforeRestore.at(-1)).toBe(1);

    await restoredIntoNewDatabase(throughJson(await readDataSnapshot()), EXPORT_VERSION);

    expect(await lineOfBitcoinHolding()).toEqual(lineBeforeRestore);
  });

  it('a file of an old version keeps them through every mirror', async () => {
    const oldFile = asFileOfOldVersion(throughJson(await readDataSnapshot()));

    await restoredIntoNewDatabase(oldFile, LAST_SCALE_2_USDT_VERSION);

    expectRowIdsSourcesAndMarksKept();

    // The mirrors ran: each value below is the seed's only because the mirror rewrote it.
    expect(allOf('SELECT id, currency FROM accounts ORDER BY id')).toEqual([
      { id: 'account-bybit', currency: 'UAH' },
      { id: 'account-cash', currency: 'USD' },
    ]);
    expect(
      allOf(
        `SELECT id, balance_set_at AS balanceSetAt, balance_set_row_id AS balanceSetRowId
         FROM holdings WHERE id <> 'holding-cash' ORDER BY id`,
      ),
    ).toEqual([
      { id: 'holding-btc', balanceSetAt: SET_AT, balanceSetRowId: 'row-sets-balance' },
      { id: 'holding-usdt', balanceSetAt: SET_AT, balanceSetRowId: 'usdt-sets-balance' },
    ]);
    expect(rowIdsOf('SELECT id FROM transactions WHERE sets_balance = 1 ORDER BY id')).toEqual([
      'row-sets-balance',
      'usdt-sets-balance',
    ]);
    expect(
      allOf(
        `SELECT id, exchange_pair_id AS exchangePairId FROM transactions
         WHERE exchange_pair_id IS NOT NULL ORDER BY id`,
      ),
    ).toEqual([
      { id: 'row-exchange-cash', exchangePairId: 'row-exchange-cash' },
      { id: 'row-exchange-leg', exchangePairId: 'row-exchange-cash' },
    ]);
    expect(
      allOf("SELECT time, external_id AS externalId FROM transactions WHERE source = 'import'"),
    ).toEqual([{ time: REZONED_AT, externalId: REZONED_IMPORT_KEY }]);
    expect(
      allOf(
        `SELECT dedup_keys_upgraded AS dedupKeysUpgraded, import_times_rezoned AS importTimesRezoned
         FROM settings`,
      ),
    ).toEqual([{ dedupKeysUpgraded: 1, importTimesRezoned: 1 }]);
    expect(
      allOf(
        `SELECT id, balance_minor_units AS balance FROM holdings
         WHERE id IN ('holding-btc', 'holding-usdt') ORDER BY id`,
      ),
    ).toEqual([
      { id: 'holding-btc', balance: 100_000_000 },
      { id: 'holding-usdt', balance: 7_000_000_000 },
    ]);
    expect(
      allOf(
        `SELECT id, amount_minor_units AS amount FROM transactions
         WHERE holding_id = 'holding-usdt' ORDER BY id`,
      ),
    ).toEqual([
      { id: 'usdt-bybit', amount: 4_000_000_000 },
      { id: 'usdt-sets-balance', amount: 1_000_000_000 },
      { id: 'usdt-typed', amount: 2_000_000_000 },
    ]);
  });
});

// The other mirrors of `restoreDataSnapshot` cannot touch a Bybit holding or its rows, so no file
// can make them run on one:
// - `withCryptoCashHoldingsMoved` moves a `cash` holding of BTC, ETH or USDT; a Bybit holding is
//   `crypto_asset`, and the move changes only a holding's account and type, never an id.
// - `withBankAccountsBankIdBackfilled` reads `bank` accounts only; a Bybit account is `crypto`.
// - `withImplicitAccountsMerged` merges live `property` and `debt` accounts only.
// - `withStrayDepositBondBalanceCleaned` takes `term_deposit` and `bond` holdings only.
// - `withWalkStateMoved` reads a Spot BTC holding's `binanceAsset` and writes the sync state only.
// - `withLoanInterestReseeded`, `withTravelReseeded` and `withRatesNormalizedToUah` write the
//   categories and the rate tables, which hold no row and no holding.
