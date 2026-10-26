// The unit tests in `binance.p2p-history.test.ts` fake the repos. This file runs the P2P walk over
// the REAL repos on a real `node:sqlite` engine (the shipped migrations): a buy of a fiat asset
// lands on a Funding holding created at zero, the probe 3 shape of 80 orders imports its 77
// completed buys and lists nothing, and a P2P buy and the Convert that follows it leave the
// Funding holding at zero.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () =>
  require('@kiko/test-support/real-sqlite').databaseClientOver(() => mockDatabase),
);
jest.mock('./binance.credentials', () => ({
  clearCredentials: async () => undefined,
}));

import {
  BINANCE_ACCOUNT_ID,
  historyRequestOf,
  holdingBalancesOf,
  notImportedOf,
  openBinanceDatabase,
  rowLabelOf,
  rowTotalsOf,
  storedRowsOf,
} from '@kiko/test-support/binance-real-sqlite';
import type { DatabaseSync } from 'node:sqlite';
import { seedWalkMarks } from '@kiko/test-support/walk-marks';

import { NOW } from './binance.pay-test-fixtures';
import { syncBinanceConvertHistory } from './binance.convert-history';
import { convertRecordOf, convertServerOf } from './binance.convert-test-fixtures';
import { P2P_CREATED_AT, p2pOrderOf, p2pServerOf } from './binance.p2p-test-fixtures';
import { type BinanceP2pHistoryDeps, syncBinanceP2pHistory } from './binance.p2p-history';

const HOUR_MS = 3_600_000;

const credentials = async () => ({ apiKey: 'api-key', secret: 'secret' });

const runP2pWalk = (fetchP2pOrders: BinanceP2pHistoryDeps['fetchP2pOrders']) =>
  syncBinanceP2pHistory(historyRequestOf(NOW), {
    now: () => NOW,
    readCredentials: credentials,
    fetchP2pOrders,
  });

const runConvertWalk = (fetchConvertHistory: ReturnType<typeof convertServerOf>) =>
  syncBinanceConvertHistory(historyRequestOf(NOW), {
    now: () => NOW,
    readCredentials: credentials,
    fetchConvertHistory,
  });

beforeEach(() => {
  mockDatabase = openBinanceDatabase({
    p2p: { cursor: NOW - 2 * HOUR_MS },
    convert: { cursor: NOW - 2 * HOUR_MS },
  });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  mockDatabase.close();
});

describe('the P2P walk on real SQLite', () => {
  it('puts a buy of a fiat asset on the Funding fiat holding, created at zero', async () => {
    const order = p2pOrderOf({
      asset: 'UAH',
      fiat: 'UAH',
      amount: '4000',
      takerAmount: '4000',
      takerCommission: undefined,
      totalPrice: '4000',
    });

    const result = await runP2pWalk(p2pServerOf([order]));

    expect(result.imported).toBe(1);
    expect(holdingBalancesOf(mockDatabase)).toEqual({ 'Binance Funding · UAH': 0 });
    expect(storedRowsOf(mockDatabase)).toEqual([
      expect.objectContaining({
        holding_name: 'Binance Funding · UAH',
        amount_minor_units: 400_000,
        untracked_counterpart: 'p2p:UAH:4000.00',
        comment: '4000 UAH',
        operation: 'p2p',
        exchange_counterpart_holding_id: null,
      }),
    ]);
    expect(rowLabelOf(storedRowsOf(mockDatabase)[0])).toBe('P2P purchase (UAH)');
  });

  it('imports the 77 completed buys of the probe 3 orders and lists nothing', async () => {
    const orders = [
      ...Array.from({ length: 77 }, (_unused, position) =>
        p2pOrderOf({
          orderNumber: `completed-${position}`,
          createTime: P2P_CREATED_AT - position * 1_000,
        }),
      ),
      ...['CANCELLED', 'CANCELLED', 'CANCELLED_BY_SYSTEM'].map((orderStatus, position) =>
        p2pOrderOf({
          orderNumber: `cancelled-${position}`,
          orderStatus,
          createTime: P2P_CREATED_AT - (77 + position) * 1_000,
        }),
      ),
    ];

    const result = await runP2pWalk(p2pServerOf(orders));

    expect(result.imported).toBe(77);
    expect(storedRowsOf(mockDatabase)).toHaveLength(77);
    expect(
      storedRowsOf(mockDatabase).every((row) => row.amount_minor_units === 9_990_000_000),
    ).toBe(true);
    expect(holdingBalancesOf(mockDatabase)).toEqual({ 'Binance Funding · USDT': 0 });
    expect(rowTotalsOf(mockDatabase)).toEqual({ 'Binance Funding · USDT': 77 * 9_990_000_000 });
    expect(notImportedOf(mockDatabase)).toEqual([]);
  });

  it('keeps one row of an order when a second run reads it again, and lists a sale once', async () => {
    const server = p2pServerOf([
      p2pOrderOf(),
      p2pOrderOf({ orderNumber: 'sale-1', tradeType: 'SELL' }),
    ]);

    await runP2pWalk(server);
    const readsOfFirstRun = server.mock.calls.length;
    seedWalkMarks(mockDatabase, BINANCE_ACCOUNT_ID, 'p2p', { cursor: NOW - 2 * HOUR_MS });
    const second = await runP2pWalk(server);

    expect(server.mock.calls.length).toBeGreaterThan(readsOfFirstRun);
    expect(second.imported).toBe(0);
    expect(storedRowsOf(mockDatabase)).toHaveLength(1);
    expect(notImportedOf(mockDatabase)).toEqual([`p2p-sale:sale-1:${P2P_CREATED_AT}`]);
  });

  it('leaves the Funding UAH holding at zero after a P2P buy of UAH and its Convert', async () => {
    const buy = p2pOrderOf({
      asset: 'UAH',
      fiat: 'UAH',
      amount: '1000',
      takerAmount: '1000',
      takerCommission: undefined,
      totalPrice: '1000',
    });

    await runP2pWalk(p2pServerOf([buy]));
    await runConvertWalk(convertServerOf([convertRecordOf()]));

    expect(holdingBalancesOf(mockDatabase)).toEqual({
      'Binance Funding · UAH': 0,
      'Binance Funding · USDT': 0,
    });
    expect(rowTotalsOf(mockDatabase)).toEqual({
      'Binance Funding · UAH': 0,
      'Binance Funding · USDT': 2_410_000_000,
    });
    expect(
      storedRowsOf(mockDatabase).map((row) => [
        row.operation,
        row.holding_name,
        row.amount_minor_units,
      ]),
    ).toEqual([
      ['convert', 'Binance Funding · UAH', -100_000],
      ['convert', 'Binance Funding · USDT', 2_410_000_000],
      ['p2p', 'Binance Funding · UAH', 100_000],
    ]);
  });
});
