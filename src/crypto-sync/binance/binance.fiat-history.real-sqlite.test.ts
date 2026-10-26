// The unit tests in `binance.fiat-history.test.ts` fake the repos. This file runs the fiat orders
// and fiat payments walks over the REAL repos on a real `node:sqlite` engine (the shipped
// migrations): a deposit, a withdrawal and a card buy or sale land on Spot holdings with their
// markers, and a record read again adds nothing and keeps its marker.
let mockDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () =>
  require('@kiko/test-support/real-sqlite').databaseClientOver(() => mockDatabase),
);
jest.mock('./binance.credentials', () => ({
  clearCredentials: async () => undefined,
}));

import {
  historyRequestOf,
  notImportedOf,
  openBinanceDatabase,
  rowLabelOf,
  storedRowsOf,
} from '@kiko/test-support/binance-real-sqlite';
import type { DatabaseSync } from 'node:sqlite';

import {
  type BinanceFiatOrderHistoryDeps,
  type BinanceFiatPaymentHistoryDeps,
  syncBinanceFiatOrderHistory,
  syncBinanceFiatPaymentHistory,
} from './binance.fiat-history';
import {
  FIAT_CREATED_AT,
  fiatOrderOf,
  fiatPaymentOf,
  fiatServerOf,
} from './binance.fiat-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';

const HOUR_MS = 3_600_000;

const credentials = async () => ({ apiKey: 'api-key', secret: 'secret' });

const runOrderWalk = (fetchFiatOrders: BinanceFiatOrderHistoryDeps['fetchFiatOrders']) =>
  syncBinanceFiatOrderHistory(historyRequestOf(NOW), {
    now: () => NOW,
    readCredentials: credentials,
    fetchFiatOrders,
  });

const runPaymentWalk = (fetchFiatPayments: BinanceFiatPaymentHistoryDeps['fetchFiatPayments']) =>
  syncBinanceFiatPaymentHistory(historyRequestOf(NOW), {
    now: () => NOW,
    readCredentials: credentials,
    fetchFiatPayments,
  });

// How many reads of the first page of deposits (or buys) asked for a span holding `time`.
const readsOf = (server: jest.Mock, time: number): number =>
  server.mock.calls.filter(
    ([, , type, span, page]) =>
      type === '0' && page === 1 && span.start <= time && time <= span.end,
  ).length;

beforeEach(() => {
  mockDatabase = openBinanceDatabase({
    fiatOrders: { cursor: NOW - 2 * HOUR_MS },
    fiatPayments: { cursor: NOW - 2 * HOUR_MS },
  });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  mockDatabase.close();
});

describe('the fiat walks on real SQLite', () => {
  it('credits a successful deposit to the Spot fiat holding with the bank total', async () => {
    const result = await runOrderWalk(fiatServerOf({ '0': [fiatOrderOf()] }, 500));

    expect(result.imported).toBe(1);
    expect(storedRowsOf(mockDatabase)).toEqual([
      expect.objectContaining({
        holding_name: expect.stringContaining('EUR'),
        amount_minor_units: 10_000,
        untracked_counterpart: 'bank:EUR:100.00',
        comment: '100.00 EUR',
        operation: 'fiat',
        exchange_counterpart_holding_id: null,
      }),
    ]);
    expect(rowLabelOf(storedRowsOf(mockDatabase)[0])).toBe('Bank deposit (EUR)');
  });

  it('debits a successful withdrawal by its amount and its total fee', async () => {
    const withdrawal = fiatOrderOf({
      orderNo: 'withdrawal-1',
      indicatedAmount: '50.00',
      amount: '50.00',
      totalFee: '0.50',
    });

    await runOrderWalk(fiatServerOf({ '1': [withdrawal] }, 500));

    expect(storedRowsOf(mockDatabase)).toEqual([
      expect.objectContaining({
        amount_minor_units: -5_050,
        untracked_counterpart: 'bank:EUR:50.00',
        operation: 'fiat',
      }),
    ]);
    expect(rowLabelOf(storedRowsOf(mockDatabase)[0])).toBe('Bank withdrawal (EUR)');
  });

  it('imports a completed card buy and sale on the Spot coin holding', async () => {
    const sale = fiatPaymentOf({
      orderNo: 'sale-1',
      sourceAmount: '0.0005',
      obtainAmount: '1300',
      createTime: FIAT_CREATED_AT + 1_000,
    });

    await runPaymentWalk(fiatServerOf({ '0': [fiatPaymentOf()], '1': [sale] }, 100));

    const rows = storedRowsOf(mockDatabase);

    expect(
      rows.map((row) => [row.amount_minor_units, row.untracked_counterpart, row.operation]),
    ).toEqual([
      [100_000, 'card:UAH:2600.00', 'card'],
      [-50_000, 'card:UAH:1300.00', 'card'],
    ]);
    expect(rows.map(rowLabelOf)).toEqual(['Card purchase (UAH)', 'Sale to card (UAH)']);
  });

  it('adds nothing when later runs read the same records again', async () => {
    const orders = fiatServerOf({ '0': [fiatOrderOf()] }, 500);
    const payments = fiatServerOf({ '0': [fiatPaymentOf()] }, 100);
    const imported: number[] = [];

    for (let run = 0; run < 3; run += 1) {
      imported.push((await runOrderWalk(orders)).imported);
      imported.push((await runPaymentWalk(payments)).imported);
    }

    expect(imported).toEqual([1, 1, 0, 0, 0, 0]);
    expect(readsOf(orders, FIAT_CREATED_AT)).toBeGreaterThan(1);
    expect(readsOf(payments, FIAT_CREATED_AT)).toBeGreaterThan(1);
    expect(storedRowsOf(mockDatabase)).toHaveLength(2);
  });

  it('refreshes the amount of a stored record on its key and keeps its marker and note', async () => {
    await runOrderWalk(fiatServerOf({ '0': [fiatOrderOf()] }, 500));
    const later = fiatServerOf(
      { '0': [fiatOrderOf({ amount: '120.00', indicatedAmount: '120.00' })] },
      500,
    );

    await runOrderWalk(later);
    await runOrderWalk(later);

    expect(readsOf(later, FIAT_CREATED_AT)).toBeGreaterThan(0);
    expect(storedRowsOf(mockDatabase)).toEqual([
      expect.objectContaining({
        amount_minor_units: 12_000,
        untracked_counterpart: 'bank:EUR:100.00',
        comment: '100.00 EUR',
      }),
    ]);
  });

  it('lists a deposit whose status Kiko does not know once, with no row, over three runs', async () => {
    const server = fiatServerOf({ '0': [fiatOrderOf({ status: 'Finished' })] }, 500);

    await runOrderWalk(server);
    await runOrderWalk(server);
    await runOrderWalk(server);

    expect(readsOf(server, FIAT_CREATED_AT)).toBeGreaterThan(1);
    expect(storedRowsOf(mockDatabase)).toEqual([]);
    expect(notImportedOf(mockDatabase)).toEqual([`fiat-unrecognized:order-1:${FIAT_CREATED_AT}`]);
  });
});
