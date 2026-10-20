import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { DAY_MS, formatDateTime } from '@kiko/dates';
import type { AccountRow, HoldingRow } from '@kiko/db';
import type { ExchangeStateSeed } from '@kiko/test-support/walk-marks';

import CryptoSyncSection from './crypto-sync-section.component';

// The section reads the account's own `sync_state` row through one live query; `mockSyncState` is
// what that query answers. The rest of the section's wiring is tested in
// `crypto-sync-section.component.test.tsx`.
let mockSyncState: { data: { exchangeState: string }[]; isLoading: boolean };

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => mockSyncState,
}));
jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: async () => undefined,
  drainReminderResponses: async () => [],
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/sync/use-crypto-sync', () => ({
  useCryptoSync: () => ({ isSyncing: false, error: undefined, sync: async () => true }),
}));
jest.mock('@kiko/crypto-sync/disconnect', () => ({
  disconnectCryptoAccount: async () => undefined,
}));
// The section reads the tracked-coin rule through the Binance barrel, which loads the credentials
// module and its react-native-keychain binding, absent under Jest.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

const HOUR_MS = 60 * 60 * 1000;

const HOLDING_SYNCED_AT = 1_700_000_000_000;

const STAMP_MS = HOLDING_SYNCED_AT + 5 * HOUR_MS;

const HISTORY_CAPTION = 'Some Binance transaction history is not imported yet.';

const binanceAccount = {
  id: 'a',
  name: 'Exchange',
  kind: 'crypto',
  institution: 'binance',
  sortOrder: 0,
  createdAt: 0,
} as unknown as AccountRow;

const holdingSyncedAt = (syncedAt: number): HoldingRow =>
  ({
    id: 'h1',
    accountId: 'a',
    type: 'crypto_asset',
    currency: 'BTC',
    metadata: { binanceAsset: 'BTC', syncedAt },
  }) as unknown as HoldingRow;

// The account's stored state; a stamp given as `undefined` is left out of it, as one never written.
const renderWith = (state: Partial<ExchangeStateSeed>, holdings: HoldingRow[] = []) => {
  mockSyncState = {
    data: [{ exchangeState: JSON.stringify({ version: 1, walks: {}, ...state }) }],
    isLoading: false,
  };

  return render(<CryptoSyncSection account={binanceAccount} holdings={holdings} />);
};

const timeAs = (time: number): RegExp =>
  new RegExp(formatDateTime(time, { uses24Hour: true }).replace(/[.]/g, '\\.'));

// Every walk four days behind the holding stamp.
const behindWalks = (): Partial<ExchangeStateSeed> => ({
  walks: Object.fromEntries(
    ['capital', 'pay', 'transfer', 'earn'].map((walk) => [
      walk,
      { cursor: HOLDING_SYNCED_AT - 4 * DAY_MS },
    ]),
  ),
});

describe('CryptoSyncSection: the balance sync stamp of the account state', () => {
  it('shows the last sync time for a Binance account with no holding', async () => {
    const { getByText, queryByText } = await renderWith({ balanceSyncedAt: STAMP_MS });

    expect(getByText(timeAs(STAMP_MS))).toBeTruthy();
    expect(queryByText(/Never/)).toBeNull();
  });

  it.each([
    ['the holding stamp is the later', STAMP_MS + HOUR_MS, STAMP_MS + HOUR_MS],
    ['the state stamp is the later', STAMP_MS - HOUR_MS, STAMP_MS],
  ])('shows the later of the holding and state stamps: %s', async (_label, held, shown) => {
    const { getByText } = await renderWith({ balanceSyncedAt: STAMP_MS }, [holdingSyncedAt(held)]);

    expect(getByText(timeAs(shown))).toBeTruthy();
  });

  it.each([
    ['holds none', undefined],
    ['holds one it cannot read', 'x'],
  ])('shows the holding stamp when the state %s', async (_label, balanceSyncedAt) => {
    const { getByText } = await renderWith({ balanceSyncedAt }, [
      holdingSyncedAt(HOLDING_SYNCED_AT),
    ]);

    expect(getByText(timeAs(HOLDING_SYNCED_AT))).toBeTruthy();
  });

  it('shows Never when neither a stamp nor a synced holding exists', async () => {
    const { getByText } = await renderWith({});

    expect(getByText(/Last sync: Never/)).toBeTruthy();
  });

  it('reads the same value for the history caption: walks behind the stamp show it with no holding', async () => {
    const { getByText } = await renderWith({
      ...behindWalks(),
      balanceSyncedAt: HOLDING_SYNCED_AT,
    });

    expect(getByText(HISTORY_CAPTION, { exact: false })).toBeTruthy();
  });

  it('shows no caption for an account with no stamp and no holding: nothing to compare against', async () => {
    const { queryByText } = await renderWith(behindWalks());

    expect(queryByText(HISTORY_CAPTION, { exact: false })).toBeNull();
  });
});
