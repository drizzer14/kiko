const mockRunSync = jest.fn();
const mockRunCryptoSync = jest.fn();

jest.mock('../../monobank/sync', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));
jest.mock('../../crypto-sync/run-crypto-sync', () => ({
  runCryptoSync: (...args: unknown[]) => mockRunCryptoSync(...args),
}));

import type { SyncableAccount } from './sync-jobs';
import { syncJobsFor } from './sync-jobs';

const syncable = (overrides: Partial<SyncableAccount>): SyncableAccount => ({
  id: 'acc',
  name: 'Account',
  institution: null,
  ...overrides,
});

describe('syncJobsFor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds a Monobank job that runs the sync TARGETED at that account id', () => {
    const jobs = syncJobsFor(syncable({ id: 'mono-1', name: 'Monobank', institution: 'monobank' }));

    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('Monobank');

    jobs[0].run();

    // Each Monobank job now carries its OWN account id, so the per-account token,
    // cursor, and single-flight all key off it — no more shared `runSync({})`.
    expect(mockRunSync).toHaveBeenCalledWith({ targetAccountId: 'mono-1' });
  });

  it('gives every connected Monobank account its OWN targeted job', () => {
    syncJobsFor(syncable({ id: 'mono-a', name: 'A', institution: 'monobank' }))[0].run();
    syncJobsFor(syncable({ id: 'mono-b', name: 'B', institution: 'monobank' }))[0].run();

    expect(mockRunSync).toHaveBeenNthCalledWith(1, { targetAccountId: 'mono-a' });
    expect(mockRunSync).toHaveBeenNthCalledWith(2, { targetAccountId: 'mono-b' });
  });

  it('builds a re-sync job for a connected crypto account', () => {
    const jobs = syncJobsFor(syncable({ id: 'bin-1', name: 'Binance', institution: 'binance' }));

    expect(jobs).toHaveLength(1);

    jobs[0].run();

    expect(mockRunCryptoSync).toHaveBeenCalledWith({
      providerId: 'binance',
      targetAccountId: 'bin-1',
    });
  });

  it('contributes no job for a manual account', () => {
    expect(syncJobsFor(syncable({ id: 'm', name: 'Cash', institution: null }))).toEqual([]);
  });
});
