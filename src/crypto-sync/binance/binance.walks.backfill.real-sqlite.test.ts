// The backfill of the other coins over the REAL repos on a real `node:sqlite` engine: the records a
// connected account holds from before its walks read every coin, read over the syncs that follow
// the one that recorded the start.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { ...actual, database: client.database, write: client.write };
});

import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import {
  historyRequestOf,
  openBinanceDatabase,
  storedRowsOf,
} from '@kiko/test-support/binance-real-sqlite';
import type { DatabaseSync } from 'node:sqlite';
import {
  ACCOUNT_ID,
  BACKFILL_AT,
  type BackfillWalk,
  backfillRangesOf,
  KIND_OF,
  MAXIMUM_RUNS,
  NOW,
  recordOf,
  SINCE,
  servedFetch,
} from '@kiko/test-support/binance-backfill-world';
import { walkMarksOf } from '@kiko/test-support/walk-marks';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';

import { syncBinancePayHistory } from './binance.pay-history';
import { syncBinanceEarnHistory } from './binance.earn-history';
import { syncBinanceTransactions } from './binance.transactions';
import { syncBinanceTransferHistory } from './binance.transfer-history';

const MARKS = { cursor: SINCE, multiCoinSince: SINCE, multiCoinSeen: true };
const HOUR_MS = 3_600_000;
const USDT_ORDERS = 41;
const BTC_ORDERS = 5;

type Records = ReturnType<typeof recordOf>[];

const walk = (name: BackfillWalk, records: Records) => {
  const deps = {
    now: () => NOW,
    fetchImpl: servedFetch(records),
    readCredentials: async () => ({ apiKey: 'key', secret: 'secret' }),
  };
  const request = historyRequestOf(NOW);

  return match(name)
    .with('capital', () => syncBinanceTransactions(request, deps))
    .with('pay', () => syncBinancePayHistory(request, deps))
    .with('transfer', () => syncBinanceTransferHistory(request, deps))
    .with('earn', () => syncBinanceEarnHistory(request, deps))
    .exhaustive();
};

const owedBackfill = (name: BackfillWalk) =>
  backfillRangesOf(walkMarksOf(mockDatabase, ACCOUNT_ID, name));

/** Whether the stored list of a walk holds a range, which is what the history caption counts. */
const owesRange = (name: BackfillWalk): boolean => {
  const state = parseExchangeState(
    (
      mockDatabase
        .prepare('SELECT exchange_state FROM sync_state WHERE account_id = ?')
        .get(ACCOUNT_ID) as { exchange_state: string }
    ).exchange_state,
  );

  return (
    state.kind === 'parsed' &&
    (state.walks[name].pending ?? []).some((ground) => ground.kind !== 'point')
  );
};

/** One sync after another until the walk owes no backfill range. */
const syncUntilRead = async (name: BackfillWalk, records: Records) => {
  for (let sync = 1; sync <= MAXIMUM_RUNS; sync += 1) {
    await walk(name, records);

    if (owedBackfill(name).length === 0) {
      return;
    }
  }
};

const rowsOnHolding = (coin: string) =>
  storedRowsOf(mockDatabase).filter((row) => row.holding_name.endsWith(` ${coin}`));

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('a Pay history that holds USDT orders from before the walk read every coin', () => {
  const orders = [
    ...Array.from({ length: USDT_ORDERS }, (_unused, position) =>
      recordOf('pay', {
        id: `usdt-${position}`,
        coin: 'USDT',
        time: BACKFILL_AT + position * HOUR_MS,
        units: 1_000 + position,
        send: true,
      }),
    ),
    ...Array.from({ length: BTC_ORDERS }, (_unused, position) =>
      recordOf('pay', {
        id: `btc-${position}`,
        coin: 'BTC',
        time: BACKFILL_AT + position * HOUR_MS,
        units: 100 + position,
        send: true,
      }),
    ),
  ];

  beforeEach(() => {
    mockDatabase = openBinanceDatabase({ pay: MARKS });
  });

  it('imports the 41 USDT Pay orders over the next syncs and skips the 5 BTC orders', async () => {
    await syncUntilRead('pay', orders);

    expect(rowsOnHolding('USDT')).toHaveLength(USDT_ORDERS);
    expect(storedRowsOf(mockDatabase)).toHaveLength(USDT_ORDERS);
    expect(owedBackfill('pay')).toEqual([]);
  });

  it('imports nothing more on the sync after the backfill was read', async () => {
    await syncUntilRead('pay', orders);
    await walk('pay', orders);

    expect(storedRowsOf(mockDatabase)).toHaveLength(USDT_ORDERS);
  });
});

describe('a capital history that holds a USDT withdrawal from before the walk read every coin', () => {
  const withdrawal = recordOf('withdraw', {
    id: 'withdrawal-1',
    coin: 'USDT',
    time: NOW - 260 * DAY_MS,
    units: 25_000,
  });

  beforeEach(() => {
    mockDatabase = openBinanceDatabase({ capital: MARKS });
  });

  it('keeps a range owed after the first sync, which reads a part of the ground', async () => {
    await walk('capital', [withdrawal]);

    expect(owedBackfill('capital')).not.toEqual([]);
    expect(owesRange('capital')).toBe(true);
  });

  it('imports the USDT withdrawal on Spot through the capital backfill', async () => {
    await syncUntilRead('capital', [withdrawal]);

    expect(storedRowsOf(mockDatabase)).toEqual([
      expect.objectContaining({
        external_id: `${ACCOUNT_ID}:withdraw:withdrawal-1`,
        holding_name: 'Binance Spot · USDT',
        amount_minor_units: -25_000,
      }),
    ]);
  });

  it('owes no range once every backfill window was read', async () => {
    await syncUntilRead('capital', [withdrawal]);

    expect(owedBackfill('capital')).toEqual([]);
    expect(owesRange('capital')).toBe(false);
  });
});

describe.each(['transfer', 'earn'] as const)('a %s history that holds only BTC before', (name) => {
  const btc = recordOf(KIND_OF[name], {
    id: 'btc-1',
    coin: 'BTC',
    time: BACKFILL_AT,
    units: 1_000,
  });

  beforeEach(() => {
    mockDatabase = openBinanceDatabase({ [name]: MARKS });
  });

  it('finds no non-BTC record in the backfill and writes no row', async () => {
    await syncUntilRead(name, [btc]);

    expect(owedBackfill(name)).toEqual([]);
    expect(storedRowsOf(mockDatabase)).toEqual([]);
  });
});
