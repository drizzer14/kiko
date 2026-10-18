import type { ReactNode } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import {
  type ExchangeStateSeed,
  type WalkName,
  WALK_NAMES,
  withWalkMarkSeeds,
  withWalkMarks,
} from '@kiko/test-support/walk-marks';
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
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: {
    getQuery: (accountId: string) => ({
      __syncState: true,
      __accountId: accountId,
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
  },
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

const ACCOUNT_ID = 'a';

const account = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: ACCOUNT_ID,
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
  accountId: ACCOUNT_ID,
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
 * for. The `sync_state` query answers only for the account the section renders: a query built
 * for another account id finds no row.
 */
const setConnected = (connected: { btc_wallet?: AccountRow[]; binance?: AccountRow[] }): void => {
  mockUseLiveQuery.mockImplementation(
    (query: {
      __institution: 'btc_wallet' | 'binance';
      __syncState?: true;
      __accountId?: string;
    }) => {
      if (query.__syncState !== true) {
        return { data: connected[query.__institution] ?? [] };
      }

      return query.__accountId === ACCOUNT_ID ? syncStateResult : { data: [], isLoading: false };
    },
  );
};

// What the account's own `sync_state` live query returns: the rows, and whether its first read is
// still queued.
let syncStateResult: { data: { exchangeState: string }[]; isLoading: boolean } = {
  data: [],
  isLoading: false,
};

const setSyncState = (state: ExchangeStateSeed, isLoading = false): void => {
  syncStateResult = { data: [{ exchangeState: JSON.stringify(state) }], isLoading };
};

const CONNECTED_WALLET_SYNCED_AT = 1_700_000_000_000;

const HOUR_MS = 60 * 60 * 1000;

const HISTORY_CAPTION = 'Some Binance transaction history is not imported yet.';

const PAUSED_CAPTION =
  'Binance history import is paused because Kiko could not read its saved import progress. Disconnect and reconnect Binance to fix this. Your holdings and transactions are kept.';

// The four forward cursors of the history walks, each `behindMs` behind the balance sync.
const walkCursors = (
  behindMs: number,
  over: Partial<Record<WalkName, number>> = {},
): ExchangeStateSeed =>
  withWalkMarkSeeds(
    {},
    ACCOUNT_ID,
    Object.fromEntries(
      WALK_NAMES.map((walkName) => [
        walkName,
        { cursor: over[walkName] ?? CONNECTED_WALLET_SYNCED_AT - behindMs },
      ]),
    ),
  );

// A connected Binance account whose spot holding the balance sync stamped, over the given walk
// state row (and whether that row's first read is still queued).
const renderBinance = (
  state: ExchangeStateSeed,
  isLoading = false,
  metadata: Record<string, unknown> = {},
) => {
  setSyncState(state, isLoading);

  return render(
    <CryptoSyncSection
      account={account({ institution: 'binance' })}
      holdings={[
        holding({ binanceAsset: 'BTC', syncedAt: CONNECTED_WALLET_SYNCED_AT, ...metadata }),
      ]}
    />,
  );
};

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
    syncStateResult = { data: [], isLoading: false };
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
    // another account already holding a wallet does not block this one's field.
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

  it('shows the lagging-history caption when the Binance history walks are more than a day behind the balance sync', async () => {
    const { getByText } = await renderBinance(walkCursors(3 * DAY_MS));

    expect(getByText(HISTORY_CAPTION, { exact: false })).toBeTruthy();
  });

  it('shows the caption when only the Earn walk is behind: the other three cursors are current', async () => {
    const { getByText } = await renderBinance(
      walkCursors(HOUR_MS, { earn: CONNECTED_WALLET_SYNCED_AT - 3 * DAY_MS }),
    );

    expect(getByText(HISTORY_CAPTION, { exact: false })).toBeTruthy();
  });

  it('shows the caption when a walk has no cursor yet, though the capital walk is current', async () => {
    const { getByText } = await renderBinance(
      withWalkMarks({}, ACCOUNT_ID, 'capital', { cursor: CONNECTED_WALLET_SYNCED_AT - HOUR_MS }),
    );

    expect(getByText(HISTORY_CAPTION, { exact: false })).toBeTruthy();
  });

  it('shows no caption once every Binance history walk is caught up', async () => {
    const { queryByText } = await renderBinance(walkCursors(2 * HOUR_MS));

    expect(queryByText(HISTORY_CAPTION, { exact: false })).toBeNull();
  });

  it('reads the state row, not the old walk keys an upgraded device still holds behind in the metadata', async () => {
    const behind = CONNECTED_WALLET_SYNCED_AT - 3 * DAY_MS;
    const { queryByText } = await renderBinance(walkCursors(HOUR_MS), false, {
      binanceHistoryCursor: behind,
      binancePayHistoryCursor: behind,
      binanceTransferHistoryCursor: behind,
      binanceEarnHistoryCursor: behind,
    });

    expect(queryByText(HISTORY_CAPTION, { exact: false })).toBeNull();
  });

  it('shows no caption while the state row is loading, though its cursors are behind', async () => {
    const { queryByText } = await renderBinance(walkCursors(3 * DAY_MS), true);

    expect(queryByText(HISTORY_CAPTION, { exact: false })).toBeNull();
  });

  it('shows no caption while the cursors are current and only a Transfer point is owed', async () => {
    const { queryByText } = await renderBinance(
      withWalkMarks(walkCursors(2 * HOUR_MS), ACCOUNT_ID, 'transfer', {
        pending: [{ start: 5, end: 7, kind: 'point', series: 'MAIN_FUNDING' }],
      }),
    );

    expect(queryByText(HISTORY_CAPTION, { exact: false })).toBeNull();
  });

  it.each([
    ['a range owed in every type', { start: 5, end: 7 }],
    ['a range owed in one type', { start: 5, end: 7, series: 'MAIN_FUNDING' }],
  ])(
    'shows the caption while the cursors are current and the Transfer walk owes %s',
    async (_label, owed) => {
      const { getByText } = await renderBinance(
        withWalkMarks(walkCursors(2 * HOUR_MS), ACCOUNT_ID, 'transfer', { pending: [owed] }),
      );

      expect(getByText(HISTORY_CAPTION, { exact: false })).toBeTruthy();
    },
  );

  it('hides the lagging-history caption while a sync is in flight, even when the history walk is behind', async () => {
    mockUseCryptoSync.mockReturnValue({ isSyncing: true, error: undefined, sync: mockSync });

    const { queryByText } = await renderBinance(walkCursors(3 * DAY_MS));

    expect(queryByText(HISTORY_CAPTION, { exact: false })).toBeNull();
  });

  it('never shows the Binance caption for a wallet account', async () => {
    const { queryByText } = await renderConnectedWallet();

    expect(queryByText(HISTORY_CAPTION, { exact: false })).toBeNull();
  });

  describe('a walk state this build cannot read', () => {
    // The column is stored as text, so a state no build reads is seeded as text, not as a seed
    // object.
    const renderMalformed = (text: string, isLoading = false) => {
      syncStateResult = { data: [{ exchangeState: text }], isLoading };

      return render(
        <CryptoSyncSection
          account={account({ institution: 'binance' })}
          holdings={[holding({ binanceAsset: 'BTC', syncedAt: CONNECTED_WALLET_SYNCED_AT })]}
        />,
      );
    };

    it.each([
      ['text that is not JSON', '{not json'],
      ['a state of another version', '{"version":2,"walks":{}}'],
      ['a state with no walks', '{"version":1}'],
    ])('shows the paused caption for %s', async (_label, text) => {
      const { getByText } = await renderMalformed(text);

      expect(getByText(PAUSED_CAPTION)).toBeTruthy();
    });

    it('shows the paused caption instead of the behind caption, never both', async () => {
      const { getByText, queryByText } = await renderMalformed('{not json');

      expect(getByText(PAUSED_CAPTION)).toBeTruthy();
      expect(queryByText(HISTORY_CAPTION, { exact: false })).toBeNull();
    });

    it('shows the paused caption while a sync is in flight: a paused history does not flash', async () => {
      mockUseCryptoSync.mockReturnValue({ isSyncing: true, error: undefined, sync: mockSync });

      const { getByText } = await renderMalformed('{not json');

      expect(getByText(PAUSED_CAPTION)).toBeTruthy();
    });

    it('shows no caption while the state row is loading', async () => {
      const { queryByText } = await renderMalformed('{not json', true);

      expect(queryByText(PAUSED_CAPTION)).toBeNull();
      expect(queryByText(HISTORY_CAPTION, { exact: false })).toBeNull();
    });

    it('shows no paused caption on a state that parses, an unreadable entry too', async () => {
      const { queryByText } = await renderMalformed('{"version":1,"walks":{"pay":"oops"}}');

      expect(queryByText(PAUSED_CAPTION)).toBeNull();
    });

    it('never shows the paused caption for a wallet account', async () => {
      syncStateResult = { data: [{ exchangeState: '{not json' }], isLoading: false };

      const { queryByText } = await renderConnectedWallet();

      expect(queryByText(PAUSED_CAPTION)).toBeNull();
      expect(queryByText(/history import is paused/)).toBeNull();
    });

    it('reads the account sync_state row through a live query on the sync_state table', async () => {
      await renderMalformed('{not json');

      expect(mockUseLiveQuery).toHaveBeenCalledWith(
        expect.objectContaining({ __syncState: true, __accountId: ACCOUNT_ID }),
        ['sync_state'],
      );
    });
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

describe('CryptoSyncSection — paused caption localization', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockUseCryptoSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    setConnected({});
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the paused caption in Ukrainian, naming Binance twice', async () => {
    syncStateResult = { data: [{ exchangeState: '{not json' }], isLoading: false };

    const { getByText } = await render(
      <CryptoSyncSection
        account={account({ institution: 'binance' })}
        holdings={[holding({ binanceAsset: 'BTC', syncedAt: CONNECTED_WALLET_SYNCED_AT })]}
      />,
    );

    expect(
      getByText(
        'Імпорт історії Binance призупинено: Кіко не зміг прочитати збережений стан імпорту. Щоб це виправити, відключіть і знову підключіть Binance. Ваші активи й транзакції збережуться.',
      ),
    ).toBeTruthy();
  });
});
