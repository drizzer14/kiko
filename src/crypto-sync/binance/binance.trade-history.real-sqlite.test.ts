// The unit tests in `binance.trade-history.test.ts` fake the repos. This file runs the trade read
// over the REAL repos on a real `node:sqlite` engine (the shipped migrations): an order that fills
// again is rewritten under the same keys through the real upsert, which keeps the markers of its
// first write, its fee is one row, every row stays out of the statistics, and a delete reaches the
// rows of one order and no others.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});
jest.mock('./binance.credentials', () => ({
  clearCredentials: async () => undefined,
}));

import { DatabaseSync } from 'node:sqlite';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { exchangeExcludedTransactionIds } from '@kiko/statistics/exchange-exclusion';

import { NOW } from './binance.pay-test-fixtures';
import { coinHoldingName } from './binance.holding-keys';
import { createBinanceHistoryRun } from './binance.history-budget';
import { type FillServer, fillOf, fillReadsOf, listed } from './binance.trade-test-fixtures';
import { type BinanceTradeHistoryDeps, syncBinanceTradeHistory } from './binance.trade-history';

const ACCOUNT_ID = 'acc-1';
const OTHER_ACCOUNT_ID = 'acc-2';
const COINS = ['BTC', 'ETH', 'BNB', 'USDT'] as const;
const ORDER_A = 100;
const ORDER_B = 200;
const ORDER_X = 300;
const BALANCE = 7_000;
const TEXTS = { BTC: '1/0', ETH: '2/0', BNB: '5/0', USDT: '1000/0' };

// One fill is 0.01 BTC for 600 USDT, so an order of n fills is n times these.
const BTC_PER_FILL = 1_000_000;
const USDT_PER_FILL = -60_000_000_000;

type StoredRow = {
  id: string;
  external_id: string;
  amount_minor_units: number;
  holding_name: string;
  exchange_counterpart_holding_id: string | null;
  exchange_pair_id: string | null;
  untracked_counterpart: string | null;
  operation: string | null;
  source: string;
};

const server: FillServer & { listing: ReturnType<typeof listed>[] } = {
  listing: [],
  fills: {},
  pageLimit: 3,
};

const openDatabase = (): DatabaseSync => {
  const rawDatabase = new DatabaseSync(':memory:');

  applyAllMigrations(rawDatabase);
  rawDatabase.exec('PRAGMA foreign_keys = ON;');

  for (const account of [ACCOUNT_ID, OTHER_ACCOUNT_ID]) {
    rawDatabase
      .prepare(
        "INSERT INTO accounts (id, name, kind, institution) VALUES (?, 'Binance', 'crypto', 'binance')",
      )
      .run(account);

    for (const coin of COINS) {
      rawDatabase
        .prepare(
          `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
           VALUES (?, ?, ?, 'crypto_asset', ?, ?, ?)`,
        )
        .run(
          `h-${coin}-${account}`,
          account,
          coinHoldingName(coin, 'spot'),
          coin,
          BALANCE,
          JSON.stringify({ binanceAsset: coin }),
        );
    }
  }

  return rawDatabase;
};

const runRead = (
  accountId = ACCOUNT_ID,
  overrides: Partial<BinanceTradeHistoryDeps> = {},
): ReturnType<typeof syncBinanceTradeHistory> =>
  syncBinanceTradeHistory(
    {
      targetAccountId: accountId,
      run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
      spotBalanceTexts: TEXTS,
    },
    {
      now: () => NOW,
      pageLimit: server.pageLimit,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      fetchExchangeSymbols: async () => ({
        symbols: server.listing,
        unreadable: 0,
        usedApiWeight1m: undefined,
      }),
      ...fillReadsOf(server),
      ...overrides,
    },
  );

const storedRows = (): StoredRow[] =>
  mockDatabase
    .prepare(
      `SELECT transactions.id, external_id, amount_minor_units, holdings.name AS holding_name,
              exchange_counterpart_holding_id, exchange_pair_id, untracked_counterpart, operation,
              source
         FROM transactions JOIN holdings ON holdings.id = transactions.holding_id
         ORDER BY external_id`,
    )
    .all() as StoredRow[];

const amountsOf = (): Record<string, number> =>
  Object.fromEntries(storedRows().map((row) => [row.external_id, row.amount_minor_units]));

const markersOf = (rows: StoredRow[]) =>
  rows.map(
    ({
      id,
      external_id,
      exchange_counterpart_holding_id,
      exchange_pair_id,
      untracked_counterpart,
      operation,
    }) => ({
      id,
      external_id,
      exchange_counterpart_holding_id,
      exchange_pair_id,
      untracked_counterpart,
      operation,
    }),
  );

const excludedIds = (): Set<string> =>
  exchangeExcludedTransactionIds(
    storedRows().map((row) => ({
      id: row.id,
      exchangeCounterpartHoldingId: row.exchange_counterpart_holding_id,
      untrackedCounterpart: row.untracked_counterpart,
    })),
  );

const holdingBalances = (): number[] =>
  (
    mockDatabase.prepare('SELECT balance_minor_units FROM holdings').all() as {
      balance_minor_units: number;
    }[]
  ).map((holding) => holding.balance_minor_units);

const keyOf = (symbol: string, orderId: number, coin: string, accountId = ACCOUNT_ID): string =>
  `${accountId}:trade:${symbol}:${orderId}:${coin}`;

const feeKeyOf = (symbol: string, orderId: number, coin: string, accountId = ACCOUNT_ID): string =>
  `${accountId}:trade:${symbol}:${orderId}:fee:${coin}`;

const seedUntrackedHistory = (ticker: string): void => {
  mockDatabase
    .prepare('INSERT INTO sync_state (account_id, exchange_state) VALUES (?, ?)')
    .run(
      ACCOUNT_ID,
      JSON.stringify({ version: 1, walks: {}, untrackedCoins: { balance: [], history: [ticker] } }),
    );
};

const idOfRow = (externalId: string): string => {
  const row = storedRows().find((stored) => stored.external_id === externalId);

  if (row === undefined) {
    throw new Error(`no stored row ${externalId}`);
  }

  return row.id;
};

beforeEach(() => {
  mockDatabase = openDatabase();
  server.listing = [listed('BTCUSDT', 'BTC', 'USDT')];
  server.fills = {};
  server.pageLimit = 3;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the trade read on real SQLite', () => {
  it('refreshes the amounts of a partly filled order under the same keys, keeping its first markers', async () => {
    server.fills.BTCUSDT = [fillOf(1, ORDER_A)];

    const first = await runRead();
    const firstRows = storedRows();

    server.fills.BTCUSDT.push(fillOf(2, ORDER_A));
    const second = await runRead();

    expect(first.imported).toBe(2);
    expect(second.imported).toBe(0);
    expect(amountsOf()).toEqual({
      [keyOf('BTCUSDT', ORDER_A, 'BTC')]: 2 * BTC_PER_FILL,
      [keyOf('BTCUSDT', ORDER_A, 'USDT')]: 2 * USDT_PER_FILL,
    });
    expect(markersOf(storedRows())).toEqual(markersOf(firstRows));
    expect(storedRows().map((row) => [row.holding_name, row.exchange_pair_id, row.source])).toEqual(
      [
        ['Binance Spot · BTC', `${ACCOUNT_ID}:trade:BTCUSDT:${ORDER_A}`, 'binance'],
        ['Binance Spot · USDT', `${ACCOUNT_ID}:trade:BTCUSDT:${ORDER_A}`, 'binance'],
      ],
    );
    expect(holdingBalances()).toEqual(Array(COINS.length * 2).fill(BALANCE));
    expect(excludedIds().size).toBe(2);
  });

  it('keeps one pair for an order that fills again after a page boundary cut it, and loses no fill', async () => {
    server.pageLimit = 4;
    server.fills.BTCUSDT = [1, 2, 3, 4].map((id) => fillOf(id, ORDER_A));
    await runRead();

    let arrived = false;
    const reads = fillReadsOf(server);

    server.pageLimit = 2;
    server.fills.BTCUSDT.push(fillOf(5, ORDER_A), fillOf(6, ORDER_X));
    await runRead(ACCOUNT_ID, {
      fetchOrderFills: async (...request) => {
        const page = await reads.fetchOrderFills(...request);

        if (page.rows.length < 2 && !arrived) {
          arrived = true;
          server.fills.BTCUSDT.push(fillOf(7, ORDER_A));
        }

        return page;
      },
    });

    expect(amountsOf()).toEqual({
      [keyOf('BTCUSDT', ORDER_A, 'BTC')]: 5 * BTC_PER_FILL,
      [keyOf('BTCUSDT', ORDER_A, 'USDT')]: 5 * USDT_PER_FILL,
      [keyOf('BTCUSDT', ORDER_X, 'BTC')]: BTC_PER_FILL,
      [keyOf('BTCUSDT', ORDER_X, 'USDT')]: USDT_PER_FILL,
    });

    await runRead();

    expect(amountsOf()).toEqual({
      [keyOf('BTCUSDT', ORDER_A, 'BTC')]: 6 * BTC_PER_FILL,
      [keyOf('BTCUSDT', ORDER_A, 'USDT')]: 6 * USDT_PER_FILL,
      [keyOf('BTCUSDT', ORDER_X, 'BTC')]: BTC_PER_FILL,
      [keyOf('BTCUSDT', ORDER_X, 'USDT')]: USDT_PER_FILL,
    });
    expect(excludedIds().size).toBe(4);
  });

  describe('a sold coin that Kiko does not track, with the commission in BNB', () => {
    const sold = {
      qty: '1000000',
      quoteQty: '10',
      isBuyer: false,
      commission: '0.0005',
      commissionAsset: 'BNB',
    };

    beforeEach(() => {
      seedUntrackedHistory('PEPE');
      server.listing = [listed('PEPEUSDT', 'PEPE', 'USDT')];
      server.fills.PEPEUSDT = [fillOf(1, ORDER_A, sold)];
    });

    it('refreshes the one row of the sale and the one fee row, never a second of either', async () => {
      await runRead();
      server.fills.PEPEUSDT.push(fillOf(2, ORDER_A, sold));
      await runRead();

      expect(amountsOf()).toEqual({
        [keyOf('PEPEUSDT', ORDER_A, 'USDT')]: 2_000_000_000,
        [feeKeyOf('PEPEUSDT', ORDER_A, 'BNB')]: -10_000,
      });
    });

    it('marks the sale with the coin and no pair, the fee with the pair and the leg it names', async () => {
      await runRead();
      server.fills.PEPEUSDT.push(fillOf(2, ORDER_A, sold));
      await runRead();

      const [leg, fee] = storedRows();
      expect(leg).toMatchObject({
        external_id: keyOf('PEPEUSDT', ORDER_A, 'USDT'),
        holding_name: 'Binance Spot · USDT',
        untracked_counterpart: 'asset:PEPE',
        exchange_pair_id: null,
        exchange_counterpart_holding_id: null,
        operation: 'trade',
      });
      expect(fee).toMatchObject({
        external_id: feeKeyOf('PEPEUSDT', ORDER_A, 'BNB'),
        holding_name: 'Binance Spot · BNB',
        exchange_pair_id: `${ACCOUNT_ID}:trade:PEPEUSDT:${ORDER_A}`,
        exchange_counterpart_holding_id: `h-USDT-${ACCOUNT_ID}`,
        untracked_counterpart: null,
        operation: 'trade-fee',
      });
      expect(excludedIds()).toEqual(new Set([leg?.id, fee?.id]));
    });
  });

  describe('deleting a trade', () => {
    // The orders share symbols and numbers on purpose: order B is another order of BTCUSDT, order A
    // of ETHUSDT has the number of order A of BTCUSDT, and the other wallet reads the same orders.
    beforeEach(async () => {
      server.listing = [listed('BTCUSDT', 'BTC', 'USDT'), listed('ETHUSDT', 'ETH', 'USDT')];
      server.fills = {
        BTCUSDT: [
          fillOf(1, ORDER_A, { commission: '0.0005', commissionAsset: 'BNB' }),
          fillOf(2, ORDER_B),
        ],
        ETHUSDT: [fillOf(1, ORDER_A, { qty: '0.5', quoteQty: '1500' })],
      };
      await runRead();
      await runRead(OTHER_ACCOUNT_ID);
    });

    const orderAKeys = [
      keyOf('BTCUSDT', ORDER_A, 'BTC'),
      keyOf('BTCUSDT', ORDER_A, 'USDT'),
      feeKeyOf('BTCUSDT', ORDER_A, 'BNB'),
    ];

    it('refuses a row the sync owns and deletes nothing', async () => {
      const before = storedRows().length;

      await expect(
        transactionsRepo.remove(idOfRow(keyOf('BTCUSDT', ORDER_A, 'BTC'))),
      ).rejects.toThrow('cannot delete a synced transaction');
      expect(storedRows()).toHaveLength(before);
      expect(before).toBe(14);
    });

    // The delete gate admits only a row the user typed or imported, so the rows are re-sourced
    // here to reach the pair walk, which is what keeps the delete to the rows of one order.
    it('takes the legs and the fee row of that order and no row of another order or wallet', async () => {
      mockDatabase.exec("UPDATE transactions SET source = 'import'");
      const before = storedRows().map((row) => row.external_id);

      await transactionsRepo.remove(idOfRow(keyOf('BTCUSDT', ORDER_A, 'BTC')));

      expect(orderAKeys.every((key) => before.includes(key))).toBe(true);
      expect(storedRows().map((row) => row.external_id)).toEqual(
        before.filter((externalId) => !orderAKeys.includes(externalId)),
      );
    });

    it('takes the same rows from the fee row as from a leg', async () => {
      mockDatabase.exec("UPDATE transactions SET source = 'import'");
      const before = storedRows().map((row) => row.external_id);

      await transactionsRepo.remove(idOfRow(feeKeyOf('BTCUSDT', ORDER_A, 'BNB')));

      expect(storedRows().map((row) => row.external_id)).toEqual(
        before.filter((externalId) => !orderAKeys.includes(externalId)),
      );
    });
  });
});
