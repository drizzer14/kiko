import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import type { AccountRow } from '@kiko/db';
import { exchangeProviderRegistry } from '@kiko/crypto-sync/exchange/registry';
import { type ExchangeCatalogId, exchangeCatalog } from '@kiko/crypto-sync/exchange-catalog';

import CryptoSyncSection from './crypto-sync-section.component';

const mockSync = jest.fn();
const mockDisconnect = jest.fn();
const mockAccountsRepoCall = jest.fn();

// Every repo method reports its name, so a write the pick makes fails the test whichever method it
// reaches for.
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: new Proxy(
    {},
    {
      get:
        (_target, method) =>
        (...args: unknown[]) =>
          mockAccountsRepoCall(method, ...args),
    },
  ),
}));
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: [], isLoading: false }),
}));
jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: async () => undefined,
  drainReminderResponses: async () => [],
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/sync/use-crypto-sync', () => ({
  useCryptoSync: () => ({ isSyncing: false, error: undefined, sync: mockSync }),
}));
jest.mock('@kiko/crypto-sync/disconnect', () => ({
  disconnectCryptoAccount: (...args: unknown[]) => mockDisconnect(...args),
}));
// The section reads the tracked-coin rule through the Binance barrel, which loads the credentials
// module and its react-native-keychain binding, absent under Jest.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));
// Each field collapses to a marker: the section's choice of field is what is under test.
jest.mock('@kiko/design-system/components/wallet-address-field', () => {
  const { Text } = require('react-native');

  return { __esModule: true, default: () => <Text accessibilityLabel="wallet-field">wallet</Text> };
});
jest.mock('@kiko/design-system/components/binance-credentials-field', () => {
  const { Text } = require('react-native');

  return {
    __esModule: true,
    default: () => <Text accessibilityLabel="binance-field">binance</Text>,
  };
});

const fieldLabelById: Record<ExchangeCatalogId, string | null> = {
  binance: 'binance-field',
  btc_wallet: 'wallet-field',
  other: null,
};

const cryptoAccount = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a',
  name: 'Exchange',
  kind: 'crypto',
  institution: null,
  bankId: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  currency: 'UAH',
  createdAt: 0,
  ...overrides,
});

const renderSection = (overrides: Partial<AccountRow> = {}) =>
  render(<CryptoSyncSection account={cryptoAccount(overrides)} holdings={[]} />);

const CONNECT = 'Connect an exchange or wallet';

describe('CryptoSyncSection — connecting a crypto account', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue(true);
    mockDisconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the Binance key field directly when the bank id names Binance', async () => {
    const { getByLabelText, queryByLabelText, queryByText } = await renderSection({
      bankId: 'binance',
    });

    expect(getByLabelText('binance-field')).toBeTruthy();
    expect(queryByLabelText('wallet-field')).toBeNull();
    expect(queryByText(CONNECT)).toBeNull();
  });

  it('shows the wallet address field directly when the bank id names the Bitcoin wallet', async () => {
    const { getByLabelText, queryByLabelText, queryByText } = await renderSection({
      bankId: 'btc_wallet',
    });

    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByLabelText('binance-field')).toBeNull();
    expect(queryByText(CONNECT)).toBeNull();
  });

  it.each(exchangeCatalog.filter((entry) => entry.connectable))(
    'shows the connect field directly on an unconnected account of each connectable exchange catalog entry ($id)',
    async (entry) => {
      const { getByLabelText } = await renderSection({ bankId: entry.id, institution: null });

      expect(getByLabelText(fieldLabelById[entry.id] ?? '')).toBeTruthy();
    },
  );

  it.each([null, 'other', 'monobank'])(
    'shows Connect an exchange or wallet when the bank id names no wired provider (%s)',
    async (bankId) => {
      const { getByText, queryByLabelText } = await renderSection({ bankId });

      expect(getByText(CONNECT)).toBeTruthy();
      expect(queryByLabelText('wallet-field')).toBeNull();
      expect(queryByLabelText('binance-field')).toBeNull();
    },
  );

  it('lists every wired exchange and wallet in the connect sheet', async () => {
    const { getByText, getByTestId, queryByTestId } = await renderSection();

    await fireEvent.press(getByText(CONNECT));

    expect(getByTestId('connect-exchange-option-binance')).toBeTruthy();
    expect(getByTestId('connect-exchange-option-btc_wallet')).toBeTruthy();
    expect(queryByTestId('connect-exchange-option-other')).toBeNull();
    expect(getByText('Binance')).toBeTruthy();
    expect(getByText('Bitcoin wallet address')).toBeTruthy();
    expect(getByText('Connect with a read-only API key.')).toBeTruthy();
    expect(getByText('Connect with a public address.')).toBeTruthy();
  });

  it("shows the picked provider's field and Change exchange after a sheet pick", async () => {
    const { getByText, getByTestId, getByLabelText, queryByLabelText } = await renderSection();

    await fireEvent.press(getByText(CONNECT));
    await fireEvent.press(getByTestId('connect-exchange-option-binance'));

    expect(getByLabelText('binance-field')).toBeTruthy();
    expect(queryByLabelText('wallet-field')).toBeNull();
    expect(getByText('Change exchange or wallet')).toBeTruthy();
  });

  it('returns to Connect an exchange or wallet on Change exchange', async () => {
    const { getByText, getByTestId, queryByLabelText } = await renderSection();

    await fireEvent.press(getByText(CONNECT));
    await fireEvent.press(getByTestId('connect-exchange-option-btc_wallet'));
    await fireEvent.press(getByText('Change exchange or wallet'));

    expect(getByText(CONNECT)).toBeTruthy();
    expect(queryByLabelText('wallet-field')).toBeNull();
  });

  it('shows no Change exchange when the bank id names the provider', async () => {
    const { queryByText } = await renderSection({ bankId: 'binance' });

    expect(queryByText('Change exchange or wallet')).toBeNull();
  });

  it('saves nothing to the account when a provider is picked in the sheet', async () => {
    const { getByText, getByTestId } = await renderSection();

    await fireEvent.press(getByText(CONNECT));
    await fireEvent.press(getByTestId('connect-exchange-option-binance'));

    expect(mockAccountsRepoCall).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("titles the disconnect confirm with the registry's name and message", async () => {
    jest.replaceProperty(exchangeProviderRegistry, 'binance', {
      id: 'binance',
      displayNameKey: 'accountDetail.wallet',
      disconnectMessageKey: 'accountDetail.disconnectProviderMessage.wallet',
    });
    const { getByText, getByTestId } = await renderSection({ institution: 'binance' });

    await fireEvent.press(getByText('Disconnect'));

    expect(getByText('Disconnect Wallet')).toBeTruthy();
    expect(
      getByText('This clears the connection. Your BTC holding stays as a manual snapshot.'),
    ).toBeTruthy();

    await fireEvent.press(getByTestId('crypto-disconnect-confirm'));

    await waitFor(() => expect(mockDisconnect).toHaveBeenCalledWith('a', 'binance'));
  });
});
