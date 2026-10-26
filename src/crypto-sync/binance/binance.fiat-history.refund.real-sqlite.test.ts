// A fiat order or payment has one `status`, and a refund is a later status of the same record
// (Refunding, Refunded). A record read `Successful` or `Completed` makes a row; when a later read
// of it is Refunding or Refunded the walk removes that row in the same commit as its marks and
// lists the record as not imported. These cases run both walks over the real repos on a real
// `node:sqlite` engine, so what the user sees (rows, row totals, the list) is read back from the
// database and never from a fake.
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
  rowTotalsOf,
  storedRowsOf,
} from '@kiko/test-support/binance-real-sqlite';
import type { DatabaseSync } from 'node:sqlite';
import { transactionsRepo } from '@kiko/transactions/repo';
import { walkMarksOf } from '@kiko/test-support/walk-marks';
import { exchangeStateDepsOf } from '@kiko/crypto-sync/exchange/walk';

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

type Deps = Partial<BinanceFiatOrderHistoryDeps & BinanceFiatPaymentHistoryDeps>;

type FiatRecord = { orderNo: string; status?: string; createTime: number };

type RefundKind = {
  name: string;
  walkId: 'fiatOrders' | 'fiatPayments';
  keyPart: 'fiat' | 'fiatpay';
  coin: 'EUR' | 'BTC';
  settledWord: string;
  /** The minor units the fixture record settles for. */
  units: number;
  recordOf: (over?: Partial<FiatRecord>) => FiatRecord;
  /** A walk of one run that reads `records` as the deposits (buys) Binance serves. */
  walk: (records: FiatRecord[], over?: Deps) => Promise<unknown>;
};

const ORDERS: RefundKind = {
  name: 'fiat order',
  walkId: 'fiatOrders',
  keyPart: 'fiat',
  coin: 'EUR',
  settledWord: 'Successful',
  units: 10_000,
  recordOf: fiatOrderOf,
  walk: (records, over = {}) =>
    syncBinanceFiatOrderHistory(historyRequestOf(NOW), {
      now: () => NOW,
      readCredentials: credentials,
      fetchFiatOrders: fiatServerOf({ '0': records.map((record) => fiatOrderOf(record)) }, 500),
      ...over,
    }),
};

const PAYMENTS: RefundKind = {
  name: 'fiat payment',
  walkId: 'fiatPayments',
  keyPart: 'fiatpay',
  coin: 'BTC',
  settledWord: 'Completed',
  units: 100_000,
  recordOf: fiatPaymentOf,
  walk: (records, over = {}) =>
    syncBinanceFiatPaymentHistory(historyRequestOf(NOW), {
      now: () => NOW,
      readCredentials: credentials,
      fetchFiatPayments: fiatServerOf({ '0': records.map((record) => fiatPaymentOf(record)) }, 100),
      ...over,
    }),
};

/** Enough runs for the re-scan to read the record again, whichever lane the walk is. */
const RUNS = 4;

const runs = async (kind: RefundKind, records: FiatRecord[], over: Deps = {}): Promise<void> => {
  for (let run = 0; run < RUNS; run += 1) {
    await kind.walk(records, over);
  }
};

const entryOf = (record: FiatRecord): string =>
  `fiat-unrecognized:${record.orderNo}:${record.createTime}`;

const keysOf = (): string[] => storedRowsOf(mockDatabase).map((stored) => stored.external_id);

const keyOf = (kind: RefundKind, orderNo: string): string =>
  `${BINANCE_ACCOUNT_ID}:${kind.keyPart}:${orderNo}:${kind.coin}`;

const marksOf = (kind: RefundKind) => {
  const { cursor, rescan } = walkMarksOf(mockDatabase, BINANCE_ACCOUNT_ID, kind.walkId);

  return { cursor, rescan };
};

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

describe.each([ORDERS, PAYMENTS])('a refunded $name on real SQLite', (kind) => {
  const settled = () => kind.recordOf({ status: kind.settledWord });
  const refunded = (status = 'Refunded') => kind.recordOf({ status });

  it.each(['Refunded', 'Refunding'])(
    'removes the row of a record read %s after it settled, and lists it once',
    async (status) => {
      await runs(kind, [settled()]);
      const balances = holdingBalancesOf(mockDatabase);

      expect(keysOf()).toEqual([keyOf(kind, settled().orderNo)]);
      expect(Object.values(rowTotalsOf(mockDatabase))).toEqual([kind.units]);

      await runs(kind, [refunded(status)]);

      expect(storedRowsOf(mockDatabase)).toEqual([]);
      expect(rowTotalsOf(mockDatabase)).toEqual({});
      expect(holdingBalancesOf(mockDatabase)).toEqual(balances);
      expect(notImportedOf(mockDatabase)).toEqual([entryOf(settled())]);
    },
  );

  it('keeps the row of a record read Refund Failed', async () => {
    await runs(kind, [settled()]);
    const before = storedRowsOf(mockDatabase);

    await runs(kind, [refunded('Refund Failed')]);

    expect(storedRowsOf(mockDatabase)).toEqual(before);
  });

  it('lists a record read Refunded that never had a row once, and removes no other row', async () => {
    const other = kind.recordOf({
      orderNo: 'other',
      status: kind.settledWord,
      createTime: FIAT_CREATED_AT + 1_000,
    });

    await runs(kind, [refunded(), other]);

    expect(keysOf()).toEqual([keyOf(kind, 'other')]);
    expect(notImportedOf(mockDatabase)).toEqual([entryOf(refunded())]);
  });

  it('removes a row the user categorized and noted together with its record', async () => {
    await runs(kind, [settled()]);
    const [{ id }] = storedRowsOf(mockDatabase);
    await transactionsRepo.setCategory({ transactionId: id, category: 'Gifts' });
    mockDatabase.prepare("UPDATE transactions SET comment = 'for Anna' WHERE id = ?").run(id);

    await runs(kind, [refunded()]);

    expect(storedRowsOf(mockDatabase)).toEqual([]);
    expect(notImportedOf(mockDatabase)).toEqual([entryOf(settled())]);
  });

  it('removes only the refunded record and keeps the rows of the others', async () => {
    const kept = kind.recordOf({
      orderNo: 'kept',
      status: kind.settledWord,
      createTime: FIAT_CREATED_AT + 1_000,
    });

    await runs(kind, [settled(), kept]);
    expect(storedRowsOf(mockDatabase)).toHaveLength(2);

    await runs(kind, [refunded(), kept]);

    expect(keysOf()).toEqual([keyOf(kind, 'kept')]);
    expect(notImportedOf(mockDatabase)).toEqual([entryOf(settled())]);
  });

  it('does not touch the row of the other walk that has the same order number', async () => {
    await ORDERS.walk([ORDERS.recordOf({ orderNo: 'shared' })]);
    await PAYMENTS.walk([PAYMENTS.recordOf({ orderNo: 'shared' })]);
    expect(keysOf()).toHaveLength(2);

    await runs(kind, [kind.recordOf({ orderNo: 'shared', status: 'Refunded' })]);

    expect(keysOf()).not.toContain(keyOf(kind, 'shared'));
    expect(keysOf()).toHaveLength(1);
  });

  it('brings the row back when the record is read settled again after a refund', async () => {
    await runs(kind, [settled()]);
    await runs(kind, [refunded()]);
    expect(storedRowsOf(mockDatabase)).toEqual([]);

    await runs(kind, [settled()]);

    expect(keysOf()).toEqual([keyOf(kind, settled().orderNo)]);
  });
});

describe.each([ORDERS, PAYMENTS])('the commit of a refund of a $name', (kind) => {
  const settled = () => kind.recordOf({ status: kind.settledWord });
  const refunded = () => kind.recordOf({ status: 'Refunded' });

  it('leaves the marks where they were when the removal fails, and a later run removes the row', async () => {
    await runs(kind, [settled()]);
    const marks = marksOf(kind);

    await expect(
      kind.walk([refunded()], {
        removeTransactions: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');

    expect(marksOf(kind)).toEqual(marks);
    expect(keysOf()).toEqual([keyOf(kind, settled().orderNo)]);
    expect(notImportedOf(mockDatabase)).toEqual([]);

    await runs(kind, [refunded()]);

    expect(storedRowsOf(mockDatabase)).toEqual([]);
    expect(notImportedOf(mockDatabase)).toEqual([entryOf(settled())]);
  });

  it('leaves the marks where they were when the entry write fails after the removal, and a later run lists it', async () => {
    await runs(kind, [settled()]);
    const marks = marksOf(kind);
    const { patchExchangeState } = exchangeStateDepsOf('binance');

    await expect(
      kind.walk([refunded()], {
        patchExchangeState: async (accountId, patches) => {
          if (patches.some((patch) => patch.kind === 'notImported')) {
            throw new Error('state write failed');
          }

          await patchExchangeState(accountId, patches);
        },
      }),
    ).rejects.toThrow('state write failed');

    expect(marksOf(kind)).toEqual(marks);
    expect(notImportedOf(mockDatabase)).toEqual([]);

    await runs(kind, [refunded()]);

    expect(storedRowsOf(mockDatabase)).toEqual([]);
    expect(notImportedOf(mockDatabase)).toEqual([entryOf(settled())]);
  });
});
