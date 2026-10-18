// `runCryptoSync` never starts a walk on a stored state this build cannot read. A walk that is
// started on one anyway fails before it reads Binance or writes the column: it would start from
// its floor on every run, since nothing it wrote would stick.
import type { HoldingRow } from '@kiko/db';
import type { WalkResult } from '@kiko/crypto-sync/exchange/walk';

import { syncBinancePayHistory } from './binance.pay-history';
import { syncBinanceEarnHistory } from './binance.earn-history';
import { syncBinanceTransactions } from './binance.transactions';
import { createBinanceHistoryRun } from './binance.history-budget';
import { syncBinanceTransferHistory } from './binance.transfer-history';

const NOW = Date.UTC(2026, 9, 15);

const requestOf = () => ({
  targetAccountId: 'acc-1',
  run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
});

const SPOT = { id: 'h-spot', accountId: 'acc-1', metadata: { binanceAsset: 'BTC' } } as HoldingRow;

const unreachable = () =>
  jest.fn(async (): Promise<never> => {
    throw new Error('a walk on an unreadable state must not read Binance');
  });

const sharedDeps = (stateText: string) => ({
  now: () => NOW,
  fetchImpl: unreachable(),
  readCredentials: async () => ({ apiKey: 'key', secret: 'secret' }),
  listHoldings: async () => [SPOT],
  readExchangeState: async () => stateText,
  patchExchangeState: jest.fn(async () => undefined),
});

type Case = [name: string, run: (shared: ReturnType<typeof sharedDeps>) => Promise<WalkResult>];

const CASES: Case[] = [
  [
    'capital',
    (shared) =>
      syncBinanceTransactions(requestOf(), {
        ...shared,
        fetchDepositHistory: unreachable(),
        fetchWithdrawHistory: unreachable(),
      }),
  ],
  [
    'pay',
    (shared) =>
      syncBinancePayHistory(requestOf(), {
        ...shared,
        fetchAccount: unreachable(),
        fetchPayHistory: unreachable(),
      }),
  ],
  [
    'transfer',
    (shared) =>
      syncBinanceTransferHistory(requestOf(), {
        ...shared,
        fetchUniversalTransfers: unreachable(),
      }),
  ],
  [
    'earn',
    (shared) => syncBinanceEarnHistory(requestOf(), { ...shared, fetchEarnRecords: unreachable() }),
  ],
];

const UNREADABLE_STATES = [
  ['text that is not JSON', '{not json'],
  ['a state of another version', '{"version":2,"walks":{}}'],
  ['a state with no walks', '{"version":1}'],
];

describe.each(CASES)('the %s walk', (_name, run) => {
  it.each(UNREADABLE_STATES)(
    'rejects before it reads Binance or writes the state, for %s',
    async (_label, text) => {
      const shared = sharedDeps(text);

      await expect(run(shared)).rejects.toMatchObject({ code: 'exchange-state-malformed' });
      expect(shared.patchExchangeState).not.toHaveBeenCalled();
      expect(shared.fetchImpl).not.toHaveBeenCalled();
    },
  );
});
