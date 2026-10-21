import { act, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { AccountRow, HoldingRow } from '@kiko/db';
import type { ExchangeStateSeed } from '@kiko/test-support/walk-marks';

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

const HOLDING_SYNCED_AT = 1_700_000_000_000;

const HISTORY_CAPTION = 'Some Binance transaction history is not imported yet.';

const LINE_PREFIX = 'Not imported: ';

const LINE_PREFIX_UK = 'Не імпортовано: ';

const CONVERT_ENTRY = 'convert-unrecognized:r1:1700000000000';

const accountOf = (institution: string): AccountRow =>
  ({
    id: 'a',
    name: 'Exchange',
    kind: 'crypto',
    institution,
    sortOrder: 0,
    createdAt: 0,
  }) as unknown as AccountRow;

const syncedHolding = {
  id: 'h1',
  accountId: 'a',
  type: 'crypto_asset',
  currency: 'BTC',
  metadata: { binanceAsset: 'BTC', syncedAt: HOLDING_SYNCED_AT },
} as unknown as HoldingRow;

// Every walk's cursor at the holding stamp: the history is current, so no caption shows.
const currentWalks = (): Partial<ExchangeStateSeed> => ({
  walks: Object.fromEntries(
    ['capital', 'pay', 'transfer', 'earn', 'convert'].map((walk) => [
      walk,
      { cursor: HOLDING_SYNCED_AT },
    ]),
  ),
});

const renderText = (text: string, institution = 'binance', isLoading = false) => {
  mockSyncState = { data: [{ exchangeState: text }], isLoading };

  return render(<CryptoSyncSection account={accountOf(institution)} holdings={[syncedHolding]} />);
};

const renderWith = (state: Record<string, unknown>, institution?: string, isLoading?: boolean) =>
  renderText(JSON.stringify({ version: 1, walks: {}, ...state }), institution, isLoading);

describe('CryptoSyncSection: the not-imported line', () => {
  beforeEach(() => {
    mockIsSyncing = false;
  });

  it('shows no line when the list is empty or absent', async () => {
    const empty = await renderWith({ notImported: [] });

    expect(empty.queryByText(LINE_PREFIX, { exact: false })).toBeNull();

    const absent = await renderWith({});

    expect(absent.queryByText(LINE_PREFIX, { exact: false })).toBeNull();
  });

  it('names the kind and its count, with the exchange, for one entry', async () => {
    const { getByText } = await renderWith({ notImported: [CONVERT_ENTRY] });

    expect(
      getByText(
        'Not imported: Convert orders Kiko does not recognize (1). Kiko does not import these Binance records yet.',
      ),
    ).toBeTruthy();
  });

  it('counts two entries of a kind as a bare (2) and joins the kinds in the order of the kind list', async () => {
    const { getByText } = await renderWith({
      notImported: [
        'fiat-unrecognized:f1:5',
        'convert-unrecognized:c1:1',
        'p2p-sale:s1:2',
        'convert-unrecognized:c2:3',
      ],
    });

    expect(
      getByText(
        'Not imported: P2P sales (1), Convert orders Kiko does not recognize (2), fiat operations Kiko does not recognize (1). Kiko does not import these Binance records yet.',
      ),
    ).toBeTruthy();
  });

  it('names the known kind only when an entry of an unknown kind sits beside it', async () => {
    const { getByText } = await renderWith({ notImported: ['bybit-x:1:2', 'p2p-sale:1:2'] });

    expect(
      getByText('Not imported: P2P sales (1). Kiko does not import these Binance records yet.'),
    ).toBeTruthy();
  });

  it.each([
    ['p2p-sale:1:2', 'P2P sales (1)'],
    ['p2p-advertiser:1:2', 'P2P orders as advertiser (1)'],
    ['p2p-amount:1:2', 'P2P orders with unclear amounts (1)'],
    ['p2p-unrecognized:1:2', 'P2P orders Kiko does not recognize (1)'],
    ['convert-unrecognized:1:2', 'Convert orders Kiko does not recognize (1)'],
    ['fiat-unrecognized:1:2', 'fiat operations Kiko does not recognize (1)'],
  ])('shows the copy of the kind of %s', async (entry, item) => {
    const { getByText } = await renderWith({ notImported: [entry] });

    expect(
      getByText(`Not imported: ${item}. Kiko does not import these Binance records yet.`),
    ).toBeTruthy();
  });

  it('keeps the line while a sync is in flight, since it states what the last walk found', async () => {
    mockIsSyncing = true;

    const { getByText } = await renderWith({ notImported: [CONVERT_ENTRY] });

    expect(getByText(LINE_PREFIX, { exact: false })).toBeTruthy();
  });

  it('shows no line while the state row loads', async () => {
    const { queryByText } = await renderWith({ notImported: [CONVERT_ENTRY] }, 'binance', true);

    expect(queryByText(LINE_PREFIX, { exact: false })).toBeNull();
  });

  it('shows no line for a wallet account', async () => {
    const { queryByText } = await renderWith({ notImported: [CONVERT_ENTRY] }, 'btc_wallet');

    expect(queryByText(LINE_PREFIX, { exact: false })).toBeNull();
  });

  it('shows no line for a state this build cannot read', async () => {
    const { queryByText } = await renderText('{not json');

    expect(queryByText(LINE_PREFIX, { exact: false })).toBeNull();
  });

  it('shows no line for a list that is no list', async () => {
    const { queryByText } = await renderWith({ notImported: CONVERT_ENTRY });

    expect(queryByText(LINE_PREFIX, { exact: false })).toBeNull();
  });

  it('shows the line without the history caption when every cursor is current', async () => {
    const { getByText, queryByText } = await renderWith({
      ...currentWalks(),
      notImported: [CONVERT_ENTRY],
    });

    expect(getByText(LINE_PREFIX, { exact: false })).toBeTruthy();
    expect(queryByText(HISTORY_CAPTION, { exact: false })).toBeNull();
  });
});

describe('CryptoSyncSection: the not-imported line in Ukrainian', () => {
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

  it('renders the line from the Ukrainian catalog with a bare count', async () => {
    const { getByText } = await renderWith({
      notImported: ['convert-unrecognized:c1:1', 'convert-unrecognized:c2:3'],
    });

    expect(
      getByText(
        'Не імпортовано: операції Convert, яких Кіко не розпізнає (2). Кіко поки не імпортує ці записи Binance.',
      ),
    ).toBeTruthy();
  });

  it('shows no line when the list is empty', async () => {
    const { queryByText } = await renderWith({ notImported: [] });

    expect(queryByText(LINE_PREFIX_UK, { exact: false })).toBeNull();
  });
});
