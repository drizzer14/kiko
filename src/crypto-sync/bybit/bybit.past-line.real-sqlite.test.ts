// The worked example of the design: 100 USDT deposited to Funding, moved to Unified, and 1 BTC
// bought with it at 100, which is worth 200 today. A real `runBalanceSync` writes the balance, the
// three history walks write their rows through the real repositories on a real `node:sqlite`
// engine (the shipped migrations), and the line is the one `buildNetWorthSeries` draws from what
// the database holds. No page with a spot row was read live: the log rows are built on the docs
// page's TRADE sample, and every route answers from the fake Bybit.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

import { DatabaseSync } from 'node:sqlite';
import { dayKeyOf } from '@kiko/prices/price-book';
import { holdingsRepo } from '@kiko/holdings/repo';
import { runBalanceSync } from '@kiko/crypto-sync/sync';
import { seedWalkMarks } from '@kiko/test-support/walk-marks';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { buildNetWorthSeries } from '@kiko/statistics/net-worth-series';
import type { SeriesTransaction } from '@kiko/statistics/holding-value-at';

import {
  FUND_PATH,
  KEY_INFO_PATH,
  UNIFIED_PATH,
  okAnswer,
  routedDeps,
} from './bybit.provider-test-fixtures';
import { syncBybitLogHistory } from './bybit.log-history';
import { depositRow } from './bybit.history-test-fixtures';
import { transferAt } from './bybit.transfer-test-fixtures';
import { API_KEY, SECRET } from './bybit.client-test-fixtures';
import { createBybitHistoryRun } from './bybit.history-budget';
import { quoteLegAt, spotAt } from './bybit.log-test-fixtures';
import { type BybitDeps, bybitProvider } from './bybit.provider';
import { fakeBybit, served } from './bybit.capital-test-fixtures';
import { syncBybitCapitalHistory } from './bybit.capital-history';
import { syncBybitTransferHistory } from './bybit.transfer-history';
import { fundCoin, fundResult, unifiedCoin, unifiedResult } from './bybit.balance-test-fixtures';

const ACCOUNT_ID = 'acc-1';

// A local calendar day of January 2026 at an hour, built from local fields: the line samples at
// local midnight, so no fixed-millisecond offset may stand for a day.
const at = (day: number, hour = 12): number => new Date(2026, 0, 1 + day, hour).getTime();

const FIRST_DAY = 0;
const DEPOSIT_DAY = 2;
const TRANSFER_DAY = 3;
const TRADE_DAY = 4;
const TODAY = 6;
const NOW = at(TODAY);

// X is BTC, and its price in USDT is shown by day. It is 60 before the deposit, which is what
// tells the readings apart there: the truth is 0. The rate tables price a coin in UAH, the one
// pivot of every conversion, so 1 USDT is set at 1 pivot unit and the line reads in USDT.
const PIVOT_PRICE_OF_USDT = '1';
const PRICE_BEFORE_THE_TRADE = 60;
const PRICE_ON = [60, 60, 60, 60, 70, 80];
const PRICE_TODAY = 200;

type Bought = { qty: string; fee: string; change: string };

type WorldOptions = {
  /** The BTC row of the buy: its amount, and the fee inside it. */
  bought: Bought;
  /** Whether the log walk runs. */
  withLog: boolean;
};

// The read lists the three holdings the example touches, each at its balance today.
const balanceDeps = (balanceOfBitcoin: string, time: number): BybitDeps => ({
  ...routedDeps({
    [KEY_INFO_PATH]: okAnswer({}),
    [UNIFIED_PATH]: okAnswer(
      unifiedResult([unifiedCoin('BTC', balanceOfBitcoin), unifiedCoin('USDT', '0')]),
    ),
    [FUND_PATH]: okAnswer(fundResult([fundCoin('USDT', '0')])),
  }).deps,
  now: () => time,
});

const NEXT_SYNC = NOW + 3_600_000;

// The account over two syncs, each as the arm runs it: the balance read, then capital, transfer and
// log. The walks make the two USDT holdings, which no read has dated yet, and a row of a holding
// with no read date never counts, so the rows count from the second sync's read.
const syncWorld = async ({ bought, withLog }: WorldOptions): Promise<void> => {
  const bybit = fakeBybit();
  const depositAt = at(DEPOSIT_DAY, 10);

  bybit.world.deposit = [
    served(
      depositAt,
      depositRow({ id: 'deposit-1', coin: 'USDT', amount: '100', successAt: String(depositAt) }),
    ),
  ];
  bybit.world.transfer = [
    transferAt(at(TRANSFER_DAY, 10), {
      transferId: 'transfer-1',
      coin: 'USDT',
      amount: '100',
      fromAccountType: 'FUND',
      toAccountType: 'UNIFIED',
    }),
  ];
  bybit.world.log = [
    spotAt(at(TRADE_DAY, 10), { id: 'buy', orderId: 'order-1', ...bought }),
    quoteLegAt(at(TRADE_DAY, 10), {
      id: 'pay',
      orderId: 'order-1',
      qty: '-100',
      fee: '0',
      change: '-100',
    }),
  ];

  for (const walkName of ['capital', 'transfer', 'log'] as const) {
    seedWalkMarks(mockDatabase, ACCOUNT_ID, walkName, { cursor: at(FIRST_DAY, 0) });
  }

  const readBalances = (time: number) =>
    runBalanceSync(bybitProvider, balanceDeps(bought.change, time), {
      targetAccountId: ACCOUNT_ID,
      now: () => time,
    });

  await readBalances(NOW);

  const run = createBybitHistoryRun({ now: () => NOW, sleep: async () => undefined });
  const overrides = {
    now: () => NOW,
    fetchImpl: bybit.fetchImpl,
    readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
  };

  await syncBybitCapitalHistory({ targetAccountId: ACCOUNT_ID, run }, overrides);
  await syncBybitTransferHistory({ targetAccountId: ACCOUNT_ID, run }, overrides);

  if (withLog) {
    await syncBybitLogHistory({ targetAccountId: ACCOUNT_ID, run }, overrides);
  }

  await readBalances(NEXT_SYNC);
};

// The net-worth line of the whole account in USDT at local midnight of each day, from the first
// day to today, as `buildNetWorthSeries` draws it from the stored holdings and rows.
const lineOfAccount = async (): Promise<number[]> => {
  const holdings = await holdingsRepo.listByAccountQuery(ACCOUNT_ID);
  const rows = mockDatabase
    .prepare(
      `SELECT id, holding_id AS holdingId, time, amount_minor_units AS amountMinorUnits, source
         FROM transactions`,
    )
    .all() as (SeriesTransaction & { holdingId: string })[];
  const { points } = buildNetWorthSeries({
    holdings,
    transactionsByHolding: new Map(
      holdings.map(({ id }) => [id, rows.filter(({ holdingId }) => holdingId === id)]),
    ),
    historyRows: PRICE_ON.flatMap((price, day) => [
      { base: 'BTC', quote: 'UAH', day: dayKeyOf(at(day)), rate: String(price) },
      { base: 'USDT', quote: 'UAH', day: dayKeyOf(at(day)), rate: PIVOT_PRICE_OF_USDT },
    ]),
    baseCurrency: 'USDT',
    range: { from: at(FIRST_DAY, 0), to: at(TODAY, 0) },
    liveRateTable: { BTC: PRICE_TODAY, USDT: Number(PIVOT_PRICE_OF_USDT) },
    today: NOW,
  });

  return points.map(({ amount }) => amount);
};

const BOUGHT_WHOLE: Bought = { qty: '1', fee: '0', change: '1' };
// A fee of 0.1 % taken in BTC: the row is +0.999, and today's balance is 0.999.
const BOUGHT_WITH_FEE: Bought = { qty: '1', fee: '0.001', change: '0.999' };

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES (?, 'Bybit', 'crypto', 'bybit')",
    )
    .run(ACCOUNT_ID);
});

describe('the past line of the worked example, on real SQLite', () => {
  it('the past of the worked example equals the truth in each stretch', async () => {
    await syncWorld({ bought: BOUGHT_WHOLE, withLog: true });

    // Before the deposit 0, from the deposit to the trade 100, after the trade p on each day.
    expect(await lineOfAccount()).toEqual([0, 0, 100, 100, 70, 80, PRICE_TODAY]);
  });

  it('the past of the worked example with a fee of 0.1 % in the coin is 0.999 p after the trade', async () => {
    await syncWorld({ bought: BOUGHT_WITH_FEE, withLog: true });

    const line = await lineOfAccount();

    expect(line.slice(0, 4)).toEqual([0, 0, 100, 100]);
    expect(line[4]).toBeCloseTo(0.999 * 70, 8);
    expect(line[5]).toBeCloseTo(0.999 * 80, 8);
    expect(line[6]).toBeCloseTo(0.999 * PRICE_TODAY, 8);
  });

  it('the same world with no trade read draws the offset of the deposits alone', async () => {
    await syncWorld({ bought: BOUGHT_WHOLE, withLog: false });

    // With p = 60 before the deposit the line reads -40, where the truth is 0.
    expect(await lineOfAccount()).toEqual([
      PRICE_BEFORE_THE_TRADE - 100,
      PRICE_BEFORE_THE_TRADE - 100,
      PRICE_BEFORE_THE_TRADE,
      PRICE_BEFORE_THE_TRADE,
      70,
      80,
      PRICE_TODAY,
    ]);
  });
});
