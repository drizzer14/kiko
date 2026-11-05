import { act, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { providerDisplayName } from '@kiko/crypto-sync/provider';

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
// The section reads the tracked-coin rules through the exchange barrels, which load the
// credentials modules and their react-native-keychain binding, absent under Jest.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

const SYNCED_AT = 1_700_000_000_000;

const accountOf = (institution: string): AccountRow =>
  ({
    id: 'a',
    name: 'Exchange',
    kind: 'crypto',
    institution,
    sortOrder: 0,
    createdAt: 0,
  }) as unknown as AccountRow;

const holdingOf = (institution: string): HoldingRow =>
  ({
    id: 'h1',
    accountId: 'a',
    type: 'crypto_asset',
    currency: 'BTC',
    metadata: {
      [institution === 'bybit' ? 'bybitAsset' : 'binanceAsset']: 'BTC',
      syncedAt: SYNCED_AT,
    },
  }) as unknown as HoldingRow;

const renderState = (institution: string, state: string | Record<string, unknown>) => {
  mockSyncState = {
    data: [
      {
        exchangeState: typeof state === 'string' ? state : JSON.stringify({ version: 1, ...state }),
      },
    ],
    isLoading: false,
  };

  return render(
    <CryptoSyncSection account={accountOf(institution)} holdings={[holdingOf(institution)]} />,
  );
};

// The registry wires no Bybit entry yet, so the name reads as the raw id.
const BYBIT_NAME = providerDisplayName('bybit', i18n.t);

const PENDING_FRAGMENT = 'transaction history is not imported yet';

const untrackedLine = (tickers: string, exchange: string): string =>
  `Not tracked: ${tickers}. Kiko does not import a currency its ${exchange} sync does not support.`;

describe('CryptoSyncSection for a Bybit account', () => {
  it('lists a fiat code outside the five as not tracked, naming the exchange, with no amount', async () => {
    const { getByText } = await renderState('bybit', {
      walks: {},
      untrackedCoins: { balance: ['GBP', 'PEPE'], history: [] },
    });

    expect(getByText(untrackedLine('GBP, PEPE', BYBIT_NAME))).toBeTruthy();
  });

  it('reads the same stored list by the rule of each exchange: Binance quotes GBP, Bybit does not', async () => {
    const lists = { walks: {}, untrackedCoins: { balance: ['GBP', 'PEPE'], history: [] } };
    const binance = await renderState('binance', lists);

    expect(binance.getByText(untrackedLine('PEPE', 'Binance'))).toBeTruthy();
    expect(binance.queryByText('GBP', { exact: false })).toBeNull();
  });

  it('shows the oversized line of a Bybit coin, as the coin lines are shown', async () => {
    const { getByText } = await renderState('bybit', {
      walks: {},
      oversizedCoins: { balance: ['BTC'], history: [] },
    });

    expect(
      getByText('BTC: Kiko could not import an amount exactly, so it was skipped.'),
    ).toBeTruthy();
  });

  it('pauses the history on a state this build cannot read, naming the exchange', async () => {
    const { getByText } = await renderState('bybit', '{not json');

    expect(
      getByText(i18n.t('accountDetail.exchangeHistoryPaused', { exchange: BYBIT_NAME })),
    ).toBeTruthy();
  });

  it('never shows the history as behind, for a state with no cursor or an owed range, where Binance does', async () => {
    const stateWithOwedRange = {
      walks: { capital: { cursor: SYNCED_AT, pending: [{ start: 1, end: 3 }] } },
    };

    for (const state of [{ walks: {} }, stateWithOwedRange]) {
      const binance = await renderState('binance', state);
      const bybit = await renderState('bybit', state);

      expect(binance.getByText(PENDING_FRAGMENT, { exact: false })).toBeTruthy();
      expect(bybit.queryByText(PENDING_FRAGMENT, { exact: false })).toBeNull();
    }
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

    it('names the exchange in the not-tracked line', async () => {
      const { getByText } = await renderState('bybit', {
        walks: {},
        untrackedCoins: { balance: ['GBP'], history: [] },
      });

      expect(
        getByText(
          `Не відстежуються: GBP. Кіко не імпортує валюту, яку не підтримує синхронізація ${BYBIT_NAME}.`,
        ),
      ).toBeTruthy();
    });

    it('keeps the Binance line byte-identical', async () => {
      const { getByText } = await renderState('binance', {
        walks: {},
        untrackedCoins: { balance: ['PEPE'], history: [] },
      });

      expect(
        getByText(
          'Не відстежуються: PEPE. Кіко не імпортує валюту, яку не підтримує синхронізація Binance.',
        ),
      ).toBeTruthy();
    });
  });
});
