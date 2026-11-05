import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { runCryptoSync } from '@kiko/crypto-sync/run-crypto-sync';

import BinanceCredentialsField from '.';

const mockRunBalanceSync = jest.fn();
const mockFetchAccount = jest.fn();
const mockSaveCredentials = jest.fn();

// The REAL run and its join are under test: only what the run reaches into is replaced, as in
// run-crypto-sync.test.ts (the repos and op-sqlite behind the sync, the history walks, and the
// keychain whose native binding is absent under Jest).
jest.mock('@kiko/crypto-sync/sync', () => ({
  runBalanceSync: (...args: unknown[]) => mockRunBalanceSync(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.transactions', () => ({
  syncBinanceTransactions: async () => ({ imported: 0, complete: true }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.pay-history', () => ({
  syncBinancePayHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.transfer-history', () => ({
  syncBinanceTransferHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.earn-history', () => ({
  syncBinanceEarnHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.convert-history', () => ({
  syncBinanceConvertHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.dust-history', () => ({
  syncBinanceDustHistory: async () => ({ imported: 0 }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.p2p-history', () => ({
  syncBinanceP2pHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.fiat-history', () => ({
  syncBinanceFiatOrderHistory: async () => ({ imported: 0, complete: true }),
  syncBinanceFiatPaymentHistory: async () => ({ imported: 0, complete: true }),
}));
jest.mock('@kiko/crypto-sync/binance/binance.trade-history', () => ({
  syncBinanceTradeHistory: async () => ({ imported: 0 }),
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: {
    getQuery: async () => [],
    patchExchangeState: async () => undefined,
  },
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({ getString: async () => '' }));
jest.mock('@kiko/crypto-sync/binance/binance.client', () => ({
  fetchAccount: (...args: unknown[]) => mockFetchAccount(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
}));

const RUNNING_TEXT = 'Kiko is still finishing the last Binance sync. Try again later.';

const ACCOUNT_ID = 'running-sync-account';

// The Connect sync the screens hand the field: the real run for this account.
const connectSync = async (): Promise<boolean> => {
  await runCryptoSync({ providerId: 'binance', targetAccountId: ACCOUNT_ID });

  return true;
};

const pressConnect = async (view: Awaited<ReturnType<typeof render>>): Promise<void> => {
  await act(async () => {
    await fireEvent.press(view.getByText('Connect Binance'));
  });
};

describe('BinanceCredentialsField — a Connect that would join the run of a disconnected pair', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAccount.mockResolvedValue({ balances: [] });
    mockSaveCredentials.mockResolvedValue(Symbol('saved'));
  });

  it('shows the running text and starts no second balance sync, then connects once the old run ends', async () => {
    const oldRun = { resolve: () => {} };
    mockRunBalanceSync.mockReturnValueOnce(
      new Promise((resolve) => {
        oldRun.resolve = () => resolve({ syncedHoldings: 1 });
      }),
    );
    mockRunBalanceSync.mockResolvedValue({ syncedHoldings: 1 });
    // The app-open sync, still in flight when the user disconnects and types a new pair.
    const appOpenSync = runCryptoSync({ providerId: 'binance', targetAccountId: ACCOUNT_ID });
    const view = await render(
      <BinanceCredentialsField accountId={ACCOUNT_ID} onConnect={connectSync} />,
    );

    await fireEvent.changeText(view.getByPlaceholderText('Binance API key'), 'new-api-key');
    await fireEvent.changeText(view.getByPlaceholderText('Binance API secret'), 'new-secret');
    await pressConnect(view);

    expect(await view.findByText(RUNNING_TEXT)).toBeTruthy();
    expect(mockRunBalanceSync).toHaveBeenCalledTimes(1);
    expect(mockFetchAccount).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(view.queryByText('Binance connected')).toBeNull();

    oldRun.resolve();
    await appOpenSync;
    await pressConnect(view);

    expect(await view.findByText('Binance connected')).toBeTruthy();
    expect(view.queryByText(RUNNING_TEXT)).toBeNull();
    expect(mockFetchAccount).toHaveBeenCalledWith('new-api-key', 'new-secret');
    expect(mockSaveCredentials).toHaveBeenCalledWith(ACCOUNT_ID, {
      apiKey: 'new-api-key',
      secret: 'new-secret',
    });
    expect(mockRunBalanceSync).toHaveBeenCalledTimes(2);
  });
});
