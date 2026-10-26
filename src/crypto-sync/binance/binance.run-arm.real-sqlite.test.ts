// `run-crypto-sync.test.ts` fakes every walk. This file runs the Binance arm through
// `runCryptoSync` with the Convert, P2P and fiat walks real, over the REAL repos on a real
// `node:sqlite` engine (the shipped migrations), and Binance answering through the reads: a P2P
// page that cannot be read, and a fiat orders re-scan that cannot read a day of the last two
// years, fail or log on their own and leave the walks around them importing.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () =>
  require('@kiko/test-support/real-sqlite').databaseClientOver(() => mockDatabase),
);

const mockFetchP2pOrders = jest.fn();
const mockFetchConvertHistory = jest.fn();
const mockFetchFiatOrders = jest.fn();
const mockFetchFiatPayments = jest.fn();
jest.mock('./binance.history-client', () => ({
  ...jest.requireActual('./binance.history-client'),
  fetchP2pOrders: (...args: unknown[]) => mockFetchP2pOrders(...args),
  fetchConvertHistory: (...args: unknown[]) => mockFetchConvertHistory(...args),
  fetchFiatOrders: (...args: unknown[]) => mockFetchFiatOrders(...args),
  fetchFiatPayments: (...args: unknown[]) => mockFetchFiatPayments(...args),
}));
jest.mock('./binance.credentials', () => ({
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
  clearCredentials: async () => undefined,
}));
// The run paces its requests on a real timer; the test reads no clock, so the pause is dropped.
jest.mock('./binance.history-budget', () => {
  const actual = jest.requireActual('./binance.history-budget');

  return {
    ...actual,
    createBinanceHistoryRun: (clock: { now: () => number }) =>
      actual.createBinanceHistoryRun({ now: clock.now, sleep: async () => undefined }),
  };
});
// The walks of the run that this file does not read are replaced by no-ops; the trade read, which
// comes after the P2P and fiat walks, records that it ran.
const mockTradeReads = jest.fn();
jest.mock('@kiko/crypto-sync/sync', () => ({
  runBalanceSync: async () => ({ syncedHoldings: 1 }),
}));
jest.mock('./binance.transactions', () => ({
  ...jest.requireActual('./binance.transactions'),
  syncBinanceTransactions: async () => ({ imported: 0, complete: true }),
}));
jest.mock('./binance.pay-history', () => ({
  syncBinancePayHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('./binance.transfer-history', () => ({
  syncBinanceTransferHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('./binance.earn-history', () => ({
  syncBinanceEarnHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('./binance.dust-history', () => ({
  syncBinanceDustHistory: async () => ({ imported: 0 }),
}));
jest.mock('./binance.trade-history', () => ({
  syncBinanceTradeHistory: async () => {
    mockTradeReads();

    return { imported: 0 };
  },
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_ACCOUNT_ID,
  openBinanceDatabase,
  storedRowsOf,
} from '@kiko/test-support/binance-real-sqlite';
import type { DatabaseSync } from 'node:sqlite';
import { runCryptoSync } from '@kiko/crypto-sync/run-crypto-sync';
import { seedWalkMarks, walkMarksOf } from '@kiko/test-support/walk-marks';

import { NOW } from './binance.pay-test-fixtures';
import { p2pServerOf } from './binance.p2p-test-fixtures';
import { BinanceHistoryParseError } from './binance.history-client';
import { convertRecordOf, convertServerOf } from './binance.convert-test-fixtures';
import { fiatOrderOf, fiatPageOf, fiatServerOf } from './binance.fiat-test-fixtures';

const HOUR_MS = 3_600_000;

let warn: jest.SpyInstance;

beforeEach(() => {
  mockDatabase = openBinanceDatabase({
    p2p: { cursor: NOW - 2 * HOUR_MS },
    convert: { cursor: NOW - 2 * HOUR_MS },
    fiatOrders: { cursor: NOW - 2 * HOUR_MS },
    fiatPayments: { cursor: NOW - 2 * HOUR_MS },
  });
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockFetchP2pOrders.mockImplementation(p2pServerOf([]));
  mockFetchConvertHistory.mockImplementation(convertServerOf([]));
  mockFetchFiatOrders.mockImplementation(fiatServerOf({}, 500));
  mockFetchFiatPayments.mockImplementation(fiatServerOf({}, 100));
});

afterEach(() => {
  jest.restoreAllMocks();
  mockFetchP2pOrders.mockReset();
  mockFetchConvertHistory.mockReset();
  mockFetchFiatOrders.mockReset();
  mockFetchFiatPayments.mockReset();
  mockTradeReads.mockReset();
  mockDatabase.close();
});

const runArm = () => runCryptoSync({ providerId: 'binance', targetAccountId: BINANCE_ACCOUNT_ID });

const fiatReads = (): number =>
  mockFetchFiatOrders.mock.calls.length + mockFetchFiatPayments.mock.calls.length;

describe('a run of the Binance arm with a P2P page that cannot be read', () => {
  it('keeps importing the other walks while a P2P page cannot be read, and logs it on every run', async () => {
    mockFetchP2pOrders.mockRejectedValue(new BinanceHistoryParseError());
    mockFetchConvertHistory.mockImplementation(convertServerOf([convertRecordOf()]));
    const laterReads: number[] = [];

    for (let run = 0; run < 2; run += 1) {
      const before = fiatReads();

      await runArm();
      laterReads.push(fiatReads() - before);
    }

    expect(storedRowsOf(mockDatabase)).toHaveLength(2);
    expect(storedRowsOf(mockDatabase).every((row) => row.operation === 'convert')).toBe(true);
    expect(walkMarksOf(mockDatabase, BINANCE_ACCOUNT_ID, 'p2p').cursor).toBe(NOW - 2 * HOUR_MS);
    expect(warn.mock.calls).toEqual([
      ['[binance sync] p2p history failed', { name: 'BinanceHistoryParseError', code: undefined }],
      ['[binance sync] p2p history failed', { name: 'BinanceHistoryParseError', code: undefined }],
    ]);
    expect(laterReads.every((reads) => reads > 0)).toBe(true);
    expect(mockTradeReads).toHaveBeenCalledTimes(2);
  });
});

describe('a run of the Binance arm with a re-scan that cannot read a day of the last two years', () => {
  const OWED = { start: NOW - 200 * DAY_MS, end: NOW - 199 * DAY_MS };

  const BEFORE = fiatOrderOf({ orderNo: 'before', createTime: NOW - 400 * DAY_MS });

  const AFTER = fiatOrderOf({ orderNo: 'after', createTime: NOW - 100 * DAY_MS });

  /** The orders of the world, answered by Binance but for the owed day, which `fails` instead. */
  const failingOnOwedDay = (fails: () => ReturnType<typeof fiatPageOf>) => {
    const server = fiatServerOf({ '0': [BEFORE, AFTER] }, 500);

    return jest.fn(
      async (
        apiKey: string,
        secret: string,
        type: '0' | '1',
        span: { start: number; end: number },
        page: number,
      ) =>
        span.start <= OWED.end && span.end >= OWED.start
          ? fails()
          : server(apiKey, secret, type, span, page),
    );
  };

  // The owed runs (the 2nd and the 4th of five) read the stuck day on its own: a page that cannot
  // be read rejects that walk, and every other run reads on.
  const FAILURES = [
    ['a page that drifts', () => fiatPageOf([], { total: 5 }), []],
    [
      'a page that cannot be read',
      (): never => {
        throw new BinanceHistoryParseError();
      },
      [1, 3],
    ],
  ] as const;

  it.each(FAILURES)(
    'logs the day a re-scan cannot read on every run while it stays stuck when %s, and runs the fiat payments and the trade read after it',
    async (_label, fails, rejectedRuns) => {
      seedWalkMarks(mockDatabase, BINANCE_ACCOUNT_ID, 'fiatOrders', {
        cursor: NOW,
        pending: [OWED],
      });
      mockFetchFiatOrders.mockImplementation(failingOnOwedDay(fails));
      const runs: { messages: string[]; stuckLogs: number; paymentReads: number }[] = [];

      for (let run = 0; run < 5; run += 1) {
        warn.mockClear();
        const readsBefore = mockFetchFiatPayments.mock.calls.length;

        await runArm();
        runs.push({
          messages: warn.mock.calls.map(([message]) => message),
          stuckLogs: warn.mock.calls.filter(([, detail]) => detail.code === 'fiat-rescan-stuck')
            .length,
          paymentReads: mockFetchFiatPayments.mock.calls.length - readsBefore,
        });
        expect(JSON.stringify(warn.mock.calls)).not.toMatch(/before|after|order-|\d{9}/);
      }

      expect(runs.map(({ stuckLogs }) => stuckLogs)).toEqual([1, 1, 1, 1, 1]);
      expect(
        runs.flatMap(({ messages }, run) =>
          messages.includes('[binance sync] fiat order history failed') ? [run] : [],
        ),
      ).toEqual(rejectedRuns);
      expect(runs.every(({ paymentReads }) => paymentReads > 0)).toBe(true);
      expect(mockTradeReads).toHaveBeenCalledTimes(5);
      expect(storedRowsOf(mockDatabase).map(({ external_id: key }) => key)).toEqual([
        `${BINANCE_ACCOUNT_ID}:fiat:after:EUR`,
        `${BINANCE_ACCOUNT_ID}:fiat:before:EUR`,
      ]);
      expect(walkMarksOf(mockDatabase, BINANCE_ACCOUNT_ID, 'fiatOrders').pending).toContainEqual(
        expect.objectContaining(OWED),
      );
    },
  );
});
