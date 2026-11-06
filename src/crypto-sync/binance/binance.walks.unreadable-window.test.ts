import * as walkModule from '@kiko/crypto-sync/exchange/walk';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './binance.pay-test-fixtures';
import { syncBinanceP2pHistory } from './binance.p2p-history';
import { syncBinancePayHistory } from './binance.pay-history';
import { syncBinanceEarnHistory } from './binance.earn-history';
import { isUnreadableWindowError } from './binance.walk-config';
import { syncBinanceTransactions } from './binance.transactions';
import { createBinanceHistoryRun } from './binance.history-budget';
import { syncBinanceConvertHistory } from './binance.convert-history';
import { syncBinanceTransferHistory } from './binance.transfer-history';
import { syncBinanceFiatOrderHistory, syncBinanceFiatPaymentHistory } from './binance.fiat-history';

jest.mock('@kiko/crypto-sync/exchange/walk/walk', () => ({
  ...jest.requireActual('@kiko/crypto-sync/exchange/walk/walk'),
  runWalkPlan: jest.fn(async () => ({ imported: 0, complete: true })),
}));

type WalkRequest = Parameters<typeof syncBinanceConvertHistory>[0];

type WalkCase = {
  name: string;
  call: (request: WalkRequest, deps: Record<string, unknown>) => Promise<unknown>;
};

const WALKS: WalkCase[] = [
  { name: 'convert', call: (request, deps) => syncBinanceConvertHistory(request, deps) },
  { name: 'transactions', call: (request, deps) => syncBinanceTransactions(request, deps) },
  { name: 'p2p', call: (request, deps) => syncBinanceP2pHistory(request, deps) },
  { name: 'transfer', call: (request, deps) => syncBinanceTransferHistory(request, deps) },
  { name: 'pay', call: (request, deps) => syncBinancePayHistory(request, deps) },
  { name: 'earn', call: (request, deps) => syncBinanceEarnHistory(request, deps) },
  { name: 'fiat orders', call: (request, deps) => syncBinanceFiatOrderHistory(request, deps) },
  { name: 'fiat payments', call: (request, deps) => syncBinanceFiatPaymentHistory(request, deps) },
];

describe.each(WALKS)('the $name walk', ({ call }) => {
  it('runs its plan with the Binance test of an unreadable window', async () => {
    const accountId = 'acc-unreadable-window';
    const fake = walkStateFake({ accountId, alongside: [] });
    const runWalkPlan = jest.mocked(walkModule.runWalkPlan);

    runWalkPlan.mockClear();

    await call(
      {
        targetAccountId: accountId,
        run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
      },
      {
        now: () => NOW,
        fetchImpl: (async () => ({})) as unknown as typeof fetch,
        readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
        ensureHoldings: async () => undefined,
        addTransactions: async (rows: unknown[]) => rows.length,
        storedExternalIds: async () => new Set<string>(),
        latestTransactionTime: async () => undefined,
        fetchAccount: async () => ({ balances: [], uid: 'uid' }),
        ...fake.freshDeps(),
        listHoldings: fake.listHoldings,
      },
    );

    expect(runWalkPlan).toHaveBeenCalledTimes(1);
    expect(runWalkPlan.mock.calls[0][0].isUnreadableWindowError).toBe(isUnreadableWindowError);
  });
});
