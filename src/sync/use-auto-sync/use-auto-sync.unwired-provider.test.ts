import { right } from 'fnts/either';
import { renderHook, waitFor } from '@testing-library/react-native';

const mockRunSync = jest.fn();
const mockRunCryptoSync = jest.fn();
const mockRefreshMarketData = jest.fn();
const mockListQuery = jest.fn();
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
jest.mock('@kiko/sync/refresh-market-data', () => {
  const actual = jest.requireActual('@kiko/sync/refresh-market-data');

  return {
    ...actual,
    refreshMarketData: (...args: unknown[]) => mockRefreshMarketData(...args),
  };
});
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: { getQuery: jest.fn() },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    listQuery: (...args: unknown[]) => mockListQuery(...args),
  },
}));
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: (...args: unknown[]) => mockRunLoanAutoLink(...args),
}));

import { useAutoSync } from './use-auto-sync';

describe('useAutoSync with an unwired provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunSync.mockResolvedValue({ importedTransactions: 0 });
    mockRunCryptoSync.mockResolvedValue({ syncedHoldings: 1 });
    mockRefreshMarketData.mockResolvedValue(right(undefined));
    mockRunLoanAutoLink.mockResolvedValue(undefined);
  });

  it("syncs every other account on open when one account's provider is not wired", async () => {
    mockListQuery.mockResolvedValue([
      { id: 'bin', name: 'Binance', institution: 'binance' },
      { id: 'w', name: 'Cold storage', institution: 'btc_wallet' },
    ]);

    await renderHook(() => useAutoSync());

    await waitFor(() => expect(mockRunLoanAutoLink).toHaveBeenCalledTimes(1));
    expect(mockRunCryptoSync.mock.calls).toEqual([
      [{ providerId: 'btc_wallet', targetAccountId: 'w' }],
    ]);
  });
});
