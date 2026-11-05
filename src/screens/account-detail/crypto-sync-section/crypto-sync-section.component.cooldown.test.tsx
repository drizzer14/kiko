import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { setBinanceCooldownUntil } from '@kiko/crypto-sync/binance';

import CryptoSyncSection from './crypto-sync-section.component';

const mockSync = jest.fn();
const mockFetchAccount = jest.fn();

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
  disconnectCryptoAccount: async () => undefined,
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({ getString: async () => '' }));
jest.mock('@kiko/crypto-sync/binance/binance.client', () => ({
  fetchAccount: (...args: unknown[]) => mockFetchAccount(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: async () => Symbol('saved'),
}));

const COOLING_TEXT = 'Too many requests to Binance. Try again later.';

// A disconnect keeps the Binance holdings but clears the account's connection and drops the
// holding's `syncedAt` and the sync state's `balanceSyncedAt`, so the kept holding has no stamp.
const keptHolding = (accountId: string): HoldingRow =>
  ({
    id: 'kept-1',
    accountId,
    type: 'crypto_asset',
    currency: 'BTC',
    metadata: { binanceAsset: 'BTC' },
  }) as unknown as HoldingRow;

const disconnectedAccount = (id: string): AccountRow =>
  ({
    id,
    name: 'Exchange',
    kind: 'crypto',
    institution: null,
    bankId: 'binance',
    sortOrder: 0,
    createdAt: 0,
  }) as unknown as AccountRow;

const connectWithNewKey = async (accountId: string) => {
  const view = await render(
    <CryptoSyncSection
      account={disconnectedAccount(accountId)}
      holdings={[keptHolding(accountId)]}
    />,
  );

  await fireEvent.changeText(view.getByPlaceholderText('Binance API key'), 'new-api-key');
  await fireEvent.changeText(view.getByPlaceholderText('Binance API secret'), 'new-secret');
  await act(async () => {
    await fireEvent.press(view.getByText('Connect Binance'));
  });

  return view;
};

describe('CryptoSyncSection — a new Binance key during a cooldown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue(true);
    mockFetchAccount.mockResolvedValue({ balances: [] });
  });

  it('shows the cooling text and runs no sync, instead of a false success on the kept holdings', async () => {
    setBinanceCooldownUntil('cooldown-section-blocked', Date.now() + 60_000);

    const view = await connectWithNewKey('cooldown-section-blocked');

    expect(await view.findByText(COOLING_TEXT)).toBeTruthy();
    expect(mockFetchAccount).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    expect(view.queryByText('Binance connected')).toBeNull();
  });

  it('connects the account through the sync once no cooldown holds', async () => {
    const view = await connectWithNewKey('cooldown-section-free');

    expect(await view.findByText('Binance connected')).toBeTruthy();
    expect(mockSync).toHaveBeenCalledWith({
      providerId: 'binance',
      targetAccountId: 'cooldown-section-free',
    });
    expect(view.queryByText(COOLING_TEXT)).toBeNull();
  });
});
