import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import '../../../design-system/unistyles';

import { formatDateTime } from '../../../dates/format';
import type { AccountRow, HoldingRow } from '../../../db/schema';
import { i18n } from '../../../i18n';

import CryptoSyncSection from './crypto-sync-section.component';

const mockUseLiveQuery = jest.fn();
const mockSync = jest.fn();
const mockUseCryptoSync = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('../../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../../use-crypto-sync', () => ({
  useCryptoSync: () => mockUseCryptoSync(),
}));
jest.mock('../../../crypto-sync/disconnect', () => ({
  disconnectCryptoAccount: (...args: unknown[]) => mockDisconnect(...args),
}));
jest.mock('../../../repositories/accounts.repo', () => ({
  accountsRepo: {
    connectedQuery: (institution: string) => ({
      __institution: institution,
      toSQL: () => ({ sql: '', params: [institution] }),
    }),
  },
}));
// The two fields are tested on their own; here each collapses to one pressable
// that fires `onConnect` with a fixture, so the section's wiring is what is
// under test.
jest.mock('../wallet-address-field', () => {
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: (address: string) => Promise<boolean> }) => (
      <Pressable
        accessibilityLabel="wallet-field"
        onPress={() => onConnect('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')}
      >
        <Text>wallet field</Text>
      </Pressable>
    ),
  };
});
jest.mock('../binance-credentials-field', () => {
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: () => Promise<boolean> }) => (
      <Pressable accessibilityLabel="binance-field" onPress={() => onConnect()}>
        <Text>binance field</Text>
      </Pressable>
    ),
  };
});

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const account = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a',
  name: 'Cold storage',
  kind: 'crypto',
  institution: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: 0,
  ...overrides,
});

const holding = (metadata: unknown): HoldingRow => ({
  id: 'h1',
  accountId: 'a',
  name: 'BTC Wallet',
  type: 'crypto_asset',
  currency: 'BTC',
  icon: null,
  color: null,
  balanceMinorUnits: 0,
  syncedBalanceMinorUnits: null,
  metadata,
  sortOrder: 0,
  closedAt: null,
  createdAt: 0,
});

/** Seed the two connected-accounts live queries, keyed on the institution each one was built for. */
const setConnected = (connected: { btc_wallet?: AccountRow[]; binance?: AccountRow[] }): void => {
  mockUseLiveQuery.mockImplementation((query: { __institution: 'btc_wallet' | 'binance' }) => ({
    data: connected[query.__institution] ?? [],
  }));
};

describe('CryptoSyncSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue(true);
    mockUseCryptoSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    mockDisconnect.mockResolvedValue(undefined);
    setConnected({});
  });

  it('shows the heading, a Wallet/Binance source picker, and the wallet field by default', async () => {
    const { getByText, getByLabelText, queryByLabelText } = await render(
      <CryptoSyncSection account={account()} holdings={[]} />,
    );

    expect(getByText('Synchronization')).toBeTruthy();
    expect(getByText('Wallet')).toBeTruthy();
    expect(getByText('Binance')).toBeTruthy();
    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByLabelText('binance-field')).toBeNull();
  });

  it('switches to the Binance field when the Binance chip is selected', async () => {
    const { getByText, getByLabelText, queryByLabelText } = await render(
      <CryptoSyncSection account={account()} holdings={[]} />,
    );

    await fireEvent.press(getByText('Binance'));

    expect(getByLabelText('binance-field')).toBeTruthy();
    expect(queryByLabelText('wallet-field')).toBeNull();
  });

  it('runs a wallet connect sync with the address when the wallet field connects', async () => {
    const { getByLabelText } = await render(
      <CryptoSyncSection account={account()} holdings={[]} />,
    );

    await fireEvent.press(getByLabelText('wallet-field'));

    await waitFor(() =>
      expect(mockSync).toHaveBeenCalledWith({
        providerId: 'btc_wallet',
        targetAccountId: 'a',
        address: ADDRESS,
      }),
    );
  });

  it('runs a Binance connect sync when the Binance field connects', async () => {
    const { getByText, getByLabelText } = await render(
      <CryptoSyncSection account={account()} holdings={[]} />,
    );

    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() =>
      expect(mockSync).toHaveBeenCalledWith({ providerId: 'binance', targetAccountId: 'a' }),
    );
  });

  it('hides the wallet field and hints when another account already holds the wallet connection', async () => {
    setConnected({ btc_wallet: [account({ id: 'other', institution: 'btc_wallet' })] });
    const { getByText, queryByLabelText } = await render(
      <CryptoSyncSection account={account()} holdings={[]} />,
    );

    expect(queryByLabelText('wallet-field')).toBeNull();
    expect(getByText('Wallet is already connected to another account')).toBeTruthy();
  });

  it('once connected to a wallet, shows Sync now + last sync and Disconnect Wallet, no picker or fields', async () => {
    const syncedAt = 1_700_000_000_000;
    const { getByText, queryByText, queryByLabelText } = await render(
      <CryptoSyncSection
        account={account({ institution: 'btc_wallet' })}
        holdings={[holding({ walletAddress: ADDRESS, syncedAt })]}
      />,
    );

    expect(getByText('Sync now')).toBeTruthy();
    expect(getByText('Disconnect Wallet')).toBeTruthy();
    const stamp = formatDateTime(syncedAt);
    expect(getByText(new RegExp(stamp.replace(/[.]/g, '\\.')))).toBeTruthy();
    expect(queryByText('Binance')).toBeNull();
    expect(queryByLabelText('wallet-field')).toBeNull();
  });

  it('spaces the last-sync line and Sync now button as widely as Sync now and Disconnect', async () => {
    // The three stacked connected-state elements — the "last synced" line, the
    // "Sync now" button, and the "Disconnect" button — must be evenly spaced.
    // The gap inside the status/actions group (last sync ↔ Sync now) must equal
    // the section root's gap (the actions group ↔ Disconnect).
    const { getByTestId, toJSON } = await render(
      <CryptoSyncSection
        account={account({ institution: 'btc_wallet' })}
        holdings={[holding({ walletAddress: ADDRESS, syncedAt: 1_700_000_000_000 })]}
      />,
    );

    const rootGap = StyleSheet.flatten(toJSON()?.props.style).gap;
    const groupGap = StyleSheet.flatten(getByTestId('crypto-sync-status-actions').props.style).gap;

    expect(groupGap).toBe(rootGap);
  });

  it('shows Never when a connected account has no synced holding yet', async () => {
    const { getByText } = await render(
      <CryptoSyncSection account={account({ institution: 'binance' })} holdings={[]} />,
    );

    expect(getByText(/Last sync: Never/)).toBeTruthy();
  });

  it('re-syncs a connected wallet account without an address', async () => {
    const { getByText } = await render(
      <CryptoSyncSection account={account({ institution: 'btc_wallet' })} holdings={[]} />,
    );

    await fireEvent.press(getByText('Sync now'));

    await waitFor(() =>
      expect(mockSync).toHaveBeenCalledWith({ providerId: 'btc_wallet', targetAccountId: 'a' }),
    );
  });

  it('confirms before disconnecting Binance, then disconnects with the provider id', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      (buttons ?? []).find((button) => button.style === 'destructive')?.onPress?.();
    });
    const { getByText } = await render(
      <CryptoSyncSection account={account({ institution: 'binance' })} holdings={[]} />,
    );

    await fireEvent.press(getByText('Disconnect Binance'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Disconnect Binance',
      expect.stringContaining('stored API key'),
      expect.any(Array),
    );
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalledWith('a', 'binance'));
    alertSpy.mockRestore();
  });

  it('shows Syncing… while a sync is in flight and surfaces the hook error', async () => {
    mockUseCryptoSync.mockReturnValue({
      isSyncing: true,
      error: 'Binance request failed: 401',
      sync: mockSync,
    });
    const { getByText } = await render(
      <CryptoSyncSection account={account({ institution: 'binance' })} holdings={[]} />,
    );

    expect(getByText('Syncing…')).toBeTruthy();
    expect(getByText('Binance request failed: 401')).toBeTruthy();
  });
});

describe('CryptoSyncSection — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue(true);
    mockUseCryptoSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    setConnected({});
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the heading and Source label from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByText, queryByText } = await render(
      <CryptoSyncSection account={account()} holdings={[]} />,
    );

    expect(getByText('Синхронізація')).toBeTruthy();
    expect(getByText('Джерело')).toBeTruthy();
    expect(queryByText('Synchronization')).toBeNull();
  });

  it('renders the never label in Ukrainian for an unsynced provider', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByText } = await render(
      <CryptoSyncSection account={account({ institution: 'binance' })} holdings={[]} />,
    );

    expect(getByText(/Ніколи/)).toBeTruthy();
  });
});
