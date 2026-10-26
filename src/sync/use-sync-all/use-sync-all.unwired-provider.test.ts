import { right } from 'fnts/either';
import type { AccountRow } from '@kiko/db';
import { act, renderHook } from '@testing-library/react-native';

const mockRunSync = jest.fn();
const mockRunCryptoSync = jest.fn();
const mockRefreshMarketData = jest.fn();
const mockRunLoanAutoLink = jest.fn();
jest.mock('@kiko/monobank/sync', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));
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
jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: (...args: unknown[]) => mockRefreshMarketData(...args),
}));
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: (...args: unknown[]) => mockRunLoanAutoLink(...args),
}));

import { useSyncAll } from './use-sync-all';

const account = (overrides: Partial<AccountRow>): AccountRow => ({
  id: 'a',
  name: 'Account',
  kind: 'crypto',
  institution: null,
  bankId: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  currency: 'USD',
  createdAt: 0,
  ...overrides,
});

describe('useSyncAll with an unwired provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunSync.mockResolvedValue({ importedTransactions: 0 });
    mockRunCryptoSync.mockResolvedValue({ syncedHoldings: 1 });
    mockRefreshMarketData.mockResolvedValue(right(undefined));
    mockRunLoanAutoLink.mockResolvedValue(undefined);
  });

  it("syncs every other account when one account's provider is not wired", async () => {
    const accounts = [
      account({ id: 'bin', name: 'Binance', institution: 'binance' }),
      account({ id: 'w', name: 'Cold storage', institution: 'btc_wallet' }),
      account({ id: 'mono', name: 'Monobank', kind: 'bank', institution: 'monobank' }),
    ];
    const { result } = await renderHook(() => useSyncAll(accounts));

    await act(async () => {
      await result.current.syncAll();
    });

    expect(mockRunCryptoSync.mock.calls).toEqual([
      [{ providerId: 'btc_wallet', targetAccountId: 'w' }],
    ]);
    expect(mockRunSync).toHaveBeenCalledWith({ targetAccountId: 'mono' });
    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
    expect(result.current.failures).toEqual([]);
  });
});
