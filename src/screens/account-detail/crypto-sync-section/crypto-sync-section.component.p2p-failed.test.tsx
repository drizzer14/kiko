import { act, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { walkStateFake } from '@kiko/test-support/walk-marks';
import { createBinanceHistoryRun, syncBinanceP2pHistory } from '@kiko/crypto-sync/binance';

import CryptoSyncSection from './crypto-sync-section.component';

// The section reads the account's own `sync_state` row through one live query; `mockSyncState` is
// what that query answers. The rest of the section's wiring is tested in
// `crypto-sync-section.component.test.tsx`.
let mockSyncState: { data: { exchangeState: string }[]; isLoading: boolean };

let mockIsSyncing = false;

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
  useCryptoSync: () => ({ isSyncing: mockIsSyncing, error: undefined, sync: async () => true }),
}));
jest.mock('@kiko/crypto-sync/disconnect', () => ({
  disconnectCryptoAccount: async () => undefined,
}));
// The section reads the tracked-coin rule through the Binance barrel, which loads the credentials
// module and its react-native-keychain binding, absent under Jest.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

const captionIn = (lng: 'en' | 'uk'): string =>
  i18n.t('accountDetail.exchangeP2pReadFailed', { exchange: 'Binance', lng });

const CAPTION = captionIn('en');

const NOW = 1_700_000_000_000;

const HOUR_MS = 3_600_000;

const ACCOUNT_ID = 'a';

const accountOf = (institution: string): AccountRow =>
  ({
    id: ACCOUNT_ID,
    name: 'Exchange',
    kind: 'crypto',
    institution,
    sortOrder: 0,
    createdAt: 0,
  }) as unknown as AccountRow;

const syncedHolding = {
  id: 'h1',
  accountId: ACCOUNT_ID,
  type: 'crypto_asset',
  currency: 'BTC',
  metadata: { binanceAsset: 'BTC', syncedAt: NOW },
} as unknown as HoldingRow;

const renderText = (text: string, institution = 'binance', isLoading = false) => {
  mockSyncState = { data: [{ exchangeState: text }], isLoading };

  return render(<CryptoSyncSection account={accountOf(institution)} holdings={[syncedHolding]} />);
};

const renderWalks = (walks: Record<string, unknown>, institution?: string, isLoading?: boolean) =>
  renderText(JSON.stringify({ version: 1, walks }), institution, isLoading);

const failedP2p = { cursor: NOW - HOUR_MS, readFailedAt: NOW };

const envelopeFetch = (body: unknown) =>
  (async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
  })) as unknown as typeof fetch;

const GOOD_ENVELOPE = { code: '000000', message: 'success', data: [], total: 0, success: true };

const REFUSING_ENVELOPE = { code: '-1', message: 'refused' };

/** The real client reads the page, so a refusing envelope is the real parse failure. */
const walkOver = (storedP2p: Record<string, unknown>, body: unknown) => {
  const fake = walkStateFake({ accountId: ACCOUNT_ID, unknown: { walks: { p2p: storedP2p } } });
  const walk = () =>
    syncBinanceP2pHistory(
      {
        targetAccountId: ACCOUNT_ID,
        run: createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined }),
      },
      {
        now: () => NOW,
        fetchImpl: envelopeFetch(body),
        readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
        ensureHoldings: async () => undefined,
        addTransactions: async (rows: unknown[]) => rows.length,
        ...fake.freshDeps(),
        listHoldings: fake.listHoldings,
      },
    );

  return {
    walk,
    stateText: async () => (await fake.deps.readExchangeState(ACCOUNT_ID)) ?? '',
  };
};

describe('CryptoSyncSection: the P2P read-failed caption', () => {
  beforeEach(() => {
    mockIsSyncing = false;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the caption after a P2P page answers a refusing envelope, and the walk still rejects', async () => {
    const world = walkOver({ cursor: NOW - HOUR_MS }, REFUSING_ENVELOPE);

    await expect(world.walk()).rejects.toMatchObject({ name: 'BinanceHistoryParseError' });

    const { getByText } = await renderText(await world.stateText());

    expect(getByText(CAPTION)).toBeTruthy();
  });

  it('drops the caption after the next run reads a good page', async () => {
    const failed = walkOver({ cursor: NOW - HOUR_MS }, REFUSING_ENVELOPE);

    await expect(failed.walk()).rejects.toMatchObject({ name: 'BinanceHistoryParseError' });

    const shown = await renderText(await failed.stateText());

    expect(shown.queryByText(CAPTION)).toBeTruthy();
    await shown.unmount();

    const good = walkOver(failedP2p, GOOD_ENVELOPE);

    await expect(good.walk()).resolves.toBeDefined();

    const { queryByText } = await renderText(await good.stateText());

    expect(queryByText(CAPTION)).toBeNull();
  });

  it('shows the caption for a stored mark, naming the exchange', async () => {
    const { getByText } = await renderWalks({ p2p: failedP2p });

    expect(getByText(CAPTION)).toBeTruthy();
  });

  it('keeps the caption while a sync is in flight, since it states what the last read found', async () => {
    mockIsSyncing = true;

    const { getByText } = await renderWalks({ p2p: failedP2p });

    expect(getByText(CAPTION)).toBeTruthy();
  });

  it('shows no caption when the P2P walk holds no mark', async () => {
    const { queryByText } = await renderWalks({ p2p: { cursor: NOW } });

    expect(queryByText(CAPTION)).toBeNull();
  });

  it('shows no caption for a mark that is no time', async () => {
    const { queryByText } = await renderWalks({ p2p: { cursor: NOW, readFailedAt: 'yesterday' } });

    expect(queryByText(CAPTION)).toBeNull();
  });

  it('shows no caption for the mark of another walk', async () => {
    const { queryByText } = await renderWalks({ pay: failedP2p, p2p: { cursor: NOW } });

    expect(queryByText(CAPTION)).toBeNull();
  });

  it('shows no caption while the state row loads', async () => {
    const { queryByText } = await renderWalks({ p2p: failedP2p }, 'binance', true);

    expect(queryByText(CAPTION)).toBeNull();
  });

  it('shows no caption for a wallet account', async () => {
    const { queryByText } = await renderWalks({ p2p: failedP2p }, 'btc_wallet');

    expect(queryByText(CAPTION)).toBeNull();
  });

  it('shows no caption for a state this build cannot read', async () => {
    const { queryByText } = await renderText('{not json');

    expect(queryByText(CAPTION)).toBeNull();
  });
});

describe('CryptoSyncSection: the P2P read-failed caption in Ukrainian', () => {
  beforeEach(async () => {
    mockIsSyncing = false;
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the Ukrainian sentence of the catalogue, not the English one', async () => {
    const { getByText, queryByText } = await renderWalks({ p2p: failedP2p });

    expect(captionIn('uk')).not.toBe(CAPTION);
    expect(getByText(captionIn('uk'))).toBeTruthy();
    expect(queryByText(CAPTION)).toBeNull();
  });
});
