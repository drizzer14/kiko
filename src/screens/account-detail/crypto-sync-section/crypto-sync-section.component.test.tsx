import type { ReactNode } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { DAY_MS, formatDateTime } from '@kiko/dates';
import type { AccountRow, HoldingRow } from '@kiko/db';

import CryptoSyncSection from './crypto-sync-section.component';

const mockUseLiveQuery = jest.fn();
const mockSync = jest.fn();
const mockUseCryptoSync = jest.fn();
const mockDisconnect = jest.fn();
const mockSyncReminders = jest.fn().mockResolvedValue(undefined);

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: (...args: unknown[]) => mockSyncReminders(...args),
  drainReminderResponses: async () => [],
}));
jest.mock('@kiko/sync/use-crypto-sync', () => ({
  useCryptoSync: () => mockUseCryptoSync(),
}));
jest.mock('@kiko/crypto-sync/disconnect', () => ({
  disconnectCryptoAccount: (...args: unknown[]) => mockDisconnect(...args),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
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
jest.mock('@kiko/design-system/components/wallet-address-field', () => {
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
jest.mock('@kiko/design-system/components/binance-credentials-field', () => {
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

// The Button variant maps to a themed fill inside a react-native-unistyles
// `variants` block that the project's Jest mock strips from the resolved style,
// so the fill is not observable on the host tree (and onAccent/textPrimary are
// both white, so the label color cannot tell primary from secondaryTonal apart
// either). Mock Button to record the `variant` it receives — following the
// contribution-buttons precedent — while still rendering the label so every
// getByText/press assertion is unaffected.
const mockButtonProps: { variant?: string; children?: ReactNode; icon?: string }[] = [];

jest.mock('@kiko/design-system/components/button', () => {
  const { Pressable, Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: (props: {
      variant?: string;
      children?: ReactNode;
      onPress: () => void;
      disabled?: boolean;
      icon?: string;
      testID?: string;
    }) => {
      mockButtonProps.push({ variant: props.variant, children: props.children, icon: props.icon });

      return (
        <Pressable testID={props.testID} onPress={props.onPress} disabled={props.disabled}>
          {props.children !== undefined && <RNText>{props.children}</RNText>}
        </Pressable>
      );
    },
  };
});

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const account = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a',
  name: 'Cold storage',
  kind: 'crypto',
  institution: null,
  bankId: null,
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
  balanceSetAt: null,
  balanceSetRowId: null,
  metadata,
  sortOrder: 0,
  closedAt: null,
  createdAt: 0,
});

/**
 * Seed the two connected-accounts live queries, keyed on the institution each one was built
 * for.
 */
const setConnected = (connected: { btc_wallet?: AccountRow[]; binance?: AccountRow[] }): void => {
  mockUseLiveQuery.mockImplementation((query: { __institution: 'btc_wallet' | 'binance' }) => ({
    data: connected[query.__institution] ?? [],
  }));
};

const CONNECTED_WALLET_SYNCED_AT = 1_700_000_000_000;

// Shared by every "already connected to a wallet" test below — each one only
// differs in what it asserts afterward, never in how the section itself is
// rendered.
const renderConnectedWallet = () =>
  render(
    <CryptoSyncSection
      account={account({ institution: 'btc_wallet' })}
      holdings={[holding({ walletAddress: ADDRESS, syncedAt: CONNECTED_WALLET_SYNCED_AT })]}
    />,
  );

// Shared by every test below that has no synced holding yet (no connection,
// or connected with nothing to show a "last sync" stamp for) — each one only
// differs in what account override and assertion it needs.
const renderSection = (overrides: Partial<AccountRow> = {}) =>
  render(<CryptoSyncSection account={account(overrides)} holdings={[]} />);

describe('CryptoSyncSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockButtonProps.length = 0;
    mockSync.mockResolvedValue(true);
    mockUseCryptoSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    mockDisconnect.mockResolvedValue(undefined);
    setConnected({});
  });

  it('shows the heading, a Wallet/Binance source picker, and the wallet field by default', async () => {
    const { getByText, getByLabelText, queryByLabelText } = await renderSection();

    expect(getByText('Synchronization')).toBeTruthy();
    expect(getByText('Wallet')).toBeTruthy();
    expect(getByText('Binance')).toBeTruthy();
    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByLabelText('binance-field')).toBeNull();
  });

  it('switches to the Binance field when the Binance chip is selected', async () => {
    const { getByText, getByLabelText, queryByLabelText } = await renderSection();

    await fireEvent.press(getByText('Binance'));

    expect(getByLabelText('binance-field')).toBeTruthy();
    expect(queryByLabelText('wallet-field')).toBeNull();
  });

  it('runs a wallet connect sync with the address when the wallet field connects', async () => {
    const { getByLabelText } = await renderSection();

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
    const { getByText, getByLabelText } = await renderSection();

    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() =>
      expect(mockSync).toHaveBeenCalledWith({ providerId: 'binance', targetAccountId: 'a' }),
    );
  });

  it.each([true, false])(
    'connecting Binance re-plans the reminders after the sync (sync succeeded: %s), since a synced account sends none',
    async (synced) => {
      mockSync.mockResolvedValue(synced);
      const { getByText, getByLabelText } = await renderSection();

      await fireEvent.press(getByText('Binance'));
      await fireEvent.press(getByLabelText('binance-field'));

      await waitFor(() => expect(mockSyncReminders).toHaveBeenCalledTimes(1));
      expect(mockSync.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncReminders.mock.invocationCallOrder[0] ?? 0,
      );
    },
  );

  it.each([true, false])(
    'connecting a wallet re-plans the reminders after the sync (sync succeeded: %s), since a synced account sends none',
    async (synced) => {
      mockSync.mockResolvedValue(synced);
      const { getByLabelText } = await renderSection();

      await fireEvent.press(getByLabelText('wallet-field'));

      await waitFor(() => expect(mockSyncReminders).toHaveBeenCalledTimes(1));
      expect(mockSync.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncReminders.mock.invocationCallOrder[0] ?? 0,
      );
    },
  );

  it('still shows the wallet field (no "connected elsewhere" hint) when another account holds a wallet', async () => {
    // Multi-connection: each crypto account connects independently, so
    // another account already holding a wallet no longer blocks this one's field.
    setConnected({ btc_wallet: [account({ id: 'other', institution: 'btc_wallet' })] });
    const { getByLabelText, queryByText } = await renderSection();

    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByText('Wallet is already connected to another account')).toBeNull();
  });

  it('still shows the Binance field when another account already holds Binance', async () => {
    setConnected({ binance: [account({ id: 'other', institution: 'binance' })] });
    const { getByText, getByLabelText } = await renderSection();

    await fireEvent.press(getByText('Binance'));

    expect(getByLabelText('binance-field')).toBeTruthy();
  });

  it('once connected to a wallet, shows Sync + last sync and Disconnect, no picker or fields', async () => {
    const { getByText, queryByText, queryByLabelText } = await renderConnectedWallet();

    expect(getByText('Sync')).toBeTruthy();
    expect(getByText('Disconnect')).toBeTruthy();
    const stamp = formatDateTime(CONNECTED_WALLET_SYNCED_AT, { uses24Hour: true });
    expect(getByText(new RegExp(stamp.replace(/[.]/g, '\\.')))).toBeTruthy();
    expect(queryByText('Binance')).toBeNull();
    expect(queryByLabelText('wallet-field')).toBeNull();
  });

  it('puts Sync and Disconnect side by side in a single row', async () => {
    const { getByTestId } = await renderConnectedWallet();

    // The two buttons now share one horizontal row rather than stacking.
    const row = getByTestId('crypto-sync-actions-row');
    expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row');
  });

  it('keeps Sync and Disconnect both neutral (secondaryTonal)', async () => {
    mockButtonProps.length = 0;
    await renderConnectedWallet();

    // Sync is now the same lower-emphasis `secondaryTonal` tint as Disconnect
    // beside it — the pinned account-detail Sync button style.
    const syncEntry = mockButtonProps.find((entry) => entry.children === 'Sync');
    const disconnectEntry = mockButtonProps.find((entry) => entry.children === 'Disconnect');
    expect(syncEntry?.variant).toBe('secondaryTonal');
    expect(disconnectEntry?.variant).toBe('secondaryTonal');
  });

  it('uses the Kiko UI sync glyph for Sync and the open-lock glyph for Disconnect', async () => {
    mockButtonProps.length = 0;
    await renderConnectedWallet();

    // Sync-now takes the iOS-18 rotate glyph; Disconnect takes the open-lock
    // glyph mirroring the lock used by the Connect affordance.
    const syncEntry = mockButtonProps.find((entry) => entry.children === 'Sync');
    const disconnectEntry = mockButtonProps.find((entry) => entry.children === 'Disconnect');
    expect(syncEntry?.icon).toBe('arrow.trianglehead.2.clockwise.rotate.90');
    expect(disconnectEntry?.icon).toBe('lock.open');
  });

  it('shows Never when a connected account has no synced holding yet', async () => {
    const { getByText } = await renderSection({ institution: 'binance' });

    expect(getByText(/Last sync: Never/)).toBeTruthy();
  });

  it('re-syncs a connected wallet account without an address', async () => {
    const { getByText } = await renderSection({ institution: 'btc_wallet' });

    await fireEvent.press(getByText('Sync'));

    await waitFor(() =>
      expect(mockSync).toHaveBeenCalledWith({ providerId: 'btc_wallet', targetAccountId: 'a' }),
    );
  });

  it('confirms via the themed sheet before disconnecting Binance, then disconnects with the provider id', async () => {
    const { getByText, getByTestId } = await renderSection({ institution: 'binance' });

    await fireEvent.press(getByText('Disconnect'));

    // The themed ConfirmSheet (not a native Alert.alert) opens with a
    // provider-specific TITLE ("Disconnect Binance") and body, even though the
    // trigger button label itself is the single word "Disconnect".
    expect(getByText('Disconnect Binance')).toBeTruthy();
    expect(getByText(/stored API key/)).toBeTruthy();
    expect(mockDisconnect).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId('crypto-disconnect-confirm'));

    await waitFor(() => expect(mockDisconnect).toHaveBeenCalledWith('a', 'binance'));
  });

  it('re-plans the reminders after a Disconnect, since the manual account takes them again', async () => {
    const { getByText, getByTestId } = await renderSection({ institution: 'binance' });

    await fireEvent.press(getByText('Disconnect'));
    await fireEvent.press(getByTestId('crypto-disconnect-confirm'));

    await waitFor(() => expect(mockSyncReminders).toHaveBeenCalledTimes(1));
    expect(mockDisconnect.mock.invocationCallOrder[0]).toBeLessThan(
      mockSyncReminders.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('re-plans nothing after a failed Disconnect', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockDisconnect.mockRejectedValue(new Error('keychain locked'));
    const { getByText, getByTestId } = await renderSection({ institution: 'binance' });

    await fireEvent.press(getByText('Disconnect'));
    await fireEvent.press(getByTestId('crypto-disconnect-confirm'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(mockSyncReminders).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('disconnects nothing when the themed Disconnect confirm is dismissed via Cancel', async () => {
    const { getByText } = await renderSection({ institution: 'binance' });

    await fireEvent.press(getByText('Disconnect'));
    await fireEvent.press(getByText('Cancel'));

    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it('shows Syncing… while a sync is in flight and surfaces the hook error', async () => {
    mockUseCryptoSync.mockReturnValue({
      isSyncing: true,
      error: 'Binance request failed: 401',
      sync: mockSync,
    });
    const { getByText } = await renderSection({ institution: 'binance' });

    expect(getByText('Syncing…')).toBeTruthy();
    expect(getByText('Binance request failed: 401')).toBeTruthy();
  });

  it('shows the lagging-history caption when the Binance history walk is more than a day behind the balance sync', async () => {
    const { getByText } = await render(
      <CryptoSyncSection
        account={account({ institution: 'binance' })}
        holdings={[
          holding({
            binanceAsset: 'BTC',
            binanceHistoryCursor: CONNECTED_WALLET_SYNCED_AT - 3 * DAY_MS,
            syncedAt: CONNECTED_WALLET_SYNCED_AT,
          }),
        ]}
      />,
    );

    expect(
      getByText('Some Binance deposit and withdrawal history is not imported yet.', {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it('shows no caption once the Binance history walk is caught up', async () => {
    const { queryByText } = await render(
      <CryptoSyncSection
        account={account({ institution: 'binance' })}
        holdings={[
          holding({
            binanceAsset: 'BTC',
            binanceHistoryCursor: CONNECTED_WALLET_SYNCED_AT - 2 * 60 * 60 * 1000,
            syncedAt: CONNECTED_WALLET_SYNCED_AT,
          }),
        ]}
      />,
    );

    expect(
      queryByText('Some Binance deposit and withdrawal history is not imported yet.', {
        exact: false,
      }),
    ).toBeNull();
  });

  it('hides the lagging-history caption while a sync is in flight, even when the history walk is behind', async () => {
    mockUseCryptoSync.mockReturnValue({ isSyncing: true, error: undefined, sync: mockSync });

    const { queryByText } = await render(
      <CryptoSyncSection
        account={account({ institution: 'binance' })}
        holdings={[
          holding({
            binanceAsset: 'BTC',
            binanceHistoryCursor: CONNECTED_WALLET_SYNCED_AT - 3 * DAY_MS,
            syncedAt: CONNECTED_WALLET_SYNCED_AT,
          }),
        ]}
      />,
    );

    expect(
      queryByText('Some Binance deposit and withdrawal history is not imported yet.', {
        exact: false,
      }),
    ).toBeNull();
  });

  it('never shows the Binance caption for a wallet account', async () => {
    const { queryByText } = await renderConnectedWallet();

    expect(
      queryByText('Some Binance deposit and withdrawal history is not imported yet.', {
        exact: false,
      }),
    ).toBeNull();
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

    const { getByText, queryByText } = await renderSection();

    expect(getByText('Синхронізація')).toBeTruthy();
    expect(getByText('Джерело')).toBeTruthy();
    expect(queryByText('Synchronization')).toBeNull();
  });

  it('renders the never label in Ukrainian for an unsynced provider', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByText } = await renderSection({ institution: 'binance' });

    expect(getByText(/Ніколи/)).toBeTruthy();
  });
});
