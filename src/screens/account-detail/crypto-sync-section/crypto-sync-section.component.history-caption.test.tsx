import { act, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { AccountRow, HoldingRow } from '@kiko/db';

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

const account = {
  id: 'a',
  name: 'Exchange',
  kind: 'crypto',
  institution: 'binance',
  sortOrder: 0,
  createdAt: 0,
} as unknown as AccountRow;

const holding = {
  id: 'h1',
  accountId: 'a',
  type: 'crypto_asset',
  currency: 'BTC',
  metadata: { binanceAsset: 'BTC', syncedAt: 1_700_000_000_000 },
} as unknown as HoldingRow;

// No walk ever recorded a cursor, so the history is behind and the caption shows.
const renderBehind = () => {
  mockSyncState = {
    data: [{ exchangeState: JSON.stringify({ version: 1, walks: {} }) }],
    isLoading: false,
  };

  return render(<CryptoSyncSection account={account} holdings={[holding]} />);
};

describe('CryptoSyncSection: the pending history caption', () => {
  it('names Binance in the pending caption', async () => {
    const { getByText } = await renderBehind();

    expect(
      getByText(
        'Some Binance transaction history is not imported yet. Kiko will keep importing on each sync.',
      ),
    ).toBeTruthy();
  });

  describe('in Ukrainian', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('renders the pending caption in Ukrainian, naming Binance', async () => {
      const { getByText } = await renderBehind();

      expect(
        getByText(
          'Частину історії транзакцій Binance ще не імпортовано. Кіко продовжить імпорт під час наступних синхронізацій.',
        ),
      ).toBeTruthy();
    });
  });
});
