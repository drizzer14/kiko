const mockRunCryptoSync = jest.fn();

jest.mock('@kiko/crypto-sync/run-crypto-sync', () => ({
  runCryptoSync: (...args: unknown[]) => mockRunCryptoSync(...args),
}));
jest.mock('@kiko/crypto-sync/exchange/registry', () => ({
  exchangeProviderRegistry: {
    btc_wallet: {
      id: 'btc_wallet',
      displayNameKey: 'accountDetail.wallet',
      disconnectMessageKey: 'accountDetail.disconnectProviderMessage.wallet',
    },
  },
}));

import { type SyncableAccount, syncJobsFor } from './sync-jobs';

const syncable = (overrides: Partial<SyncableAccount>): SyncableAccount => ({
  id: 'acc',
  name: 'Account',
  institution: null,
  ...overrides,
});

describe('syncJobsFor with an unwired provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('contributes no job for a connected account whose provider the registry does not wire', () => {
    const jobs = syncJobsFor(syncable({ id: 'bin-1', name: 'Binance', institution: 'binance' }));

    expect(jobs).toEqual([]);
  });

  it('contributes no job for a connected account of the Bybit id, which no registry entry wires', () => {
    const jobs = syncJobsFor(syncable({ id: 'byb-1', name: 'Bybit', institution: 'bybit' }));

    expect(jobs).toEqual([]);
  });

  it("still builds the wired provider's job beside an unwired one", async () => {
    const jobs = [
      syncable({ id: 'bin-1', name: 'Binance', institution: 'binance' }),
      syncable({ id: 'w-1', name: 'Cold storage', institution: 'btc_wallet' }),
    ].flatMap(syncJobsFor);

    expect(jobs.map((job) => job.name)).toEqual(['Cold storage']);

    await jobs[0].run();

    expect(mockRunCryptoSync).toHaveBeenCalledWith({
      providerId: 'btc_wallet',
      targetAccountId: 'w-1',
    });
  });
});
