import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './binance.pay-test-fixtures';
import { syncBinanceP2pHistory } from './binance.p2p-history';
import { syncBinancePayHistory } from './binance.pay-history';
import { syncBinanceEarnHistory } from './binance.earn-history';
import { syncBinanceDustHistory } from './binance.dust-history';
import { syncBinanceTransactions } from './binance.transactions';
import { createBinanceHistoryRun } from './binance.history-budget';
import { syncBinanceConvertHistory } from './binance.convert-history';
import { syncBinanceTransferHistory } from './binance.transfer-history';
import { syncBinanceFiatOrderHistory, syncBinanceFiatPaymentHistory } from './binance.fiat-history';

type WalkRequest = Parameters<typeof syncBinanceConvertHistory>[0];

type WalkCase = {
  name: string;
  call: (request: WalkRequest, deps: Record<string, unknown>) => Promise<unknown>;
  /** The requests of the walk's deps that reject: the pages of the walk's own reads. */
  readers: string[];
};

const WALKS: WalkCase[] = [
  {
    name: 'capital',
    call: (request, deps) => syncBinanceTransactions(request, deps),
    readers: ['fetchDepositHistory', 'fetchWithdrawHistory'],
  },
  {
    name: 'convert',
    call: (request, deps) => syncBinanceConvertHistory(request, deps),
    readers: ['fetchConvertHistory'],
  },
  {
    name: 'pay',
    call: (request, deps) => syncBinancePayHistory(request, deps),
    readers: ['fetchPayHistory'],
  },
  {
    name: 'dust',
    call: (request, deps) => syncBinanceDustHistory(request, deps),
    readers: ['fetchDustHistory'],
  },
  {
    name: 'transfer',
    call: (request, deps) => syncBinanceTransferHistory(request, deps),
    readers: ['fetchUniversalTransfers'],
  },
  {
    name: 'earn',
    call: (request, deps) => syncBinanceEarnHistory(request, deps),
    readers: ['fetchEarnRecords'],
  },
  {
    name: 'p2p',
    call: (request, deps) => syncBinanceP2pHistory(request, deps),
    readers: ['fetchP2pOrders'],
  },
  {
    name: 'fiat orders',
    call: (request, deps) => syncBinanceFiatOrderHistory(request, deps),
    readers: ['fetchFiatOrders'],
  },
  {
    name: 'fiat payments',
    call: (request, deps) => syncBinanceFiatPaymentHistory(request, deps),
    readers: ['fetchFiatPayments'],
  },
];

describe.each(WALKS)('the $name walk', ({ call, readers }) => {
  it('counts every request that rejects as a call of its lane, and rethrows its error', async () => {
    const accountId = `acc-failed-call-${readers[0]}`;
    const fake = walkStateFake({ accountId, alongside: [] });
    const run = createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });
    const record = jest.spyOn(run.budget, 'record');
    const failure = new Error('boom');
    const requested = { count: 0 };
    const rejecting = async (): Promise<never> => {
      requested.count += 1;

      throw failure;
    };

    await expect(
      call(
        { targetAccountId: accountId, run },
        {
          now: () => NOW,
          fetchImpl: (async () => ({})) as unknown as typeof fetch,
          readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
          ensureHoldings: async () => undefined,
          addTransactions: async (rows: unknown[]) => rows.length,
          storedExternalIds: async () => new Set<string>(),
          latestTransactionTime: async () => undefined,
          // The uid read of the Pay walk is a request that is counted on its own.
          fetchAccount: async () => {
            requested.count += 1;

            return { balances: [], uid: 'uid' };
          },
          ...Object.fromEntries(readers.map((reader) => [reader, rejecting])),
          ...fake.freshDeps(),
          listHoldings: fake.listHoldings,
        },
      ),
    ).rejects.toBe(failure);

    expect(requested.count).toBeGreaterThan(0);
    expect(record).toHaveBeenCalledTimes(requested.count);
  });
});
