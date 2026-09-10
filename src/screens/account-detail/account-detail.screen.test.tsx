import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import type { ComponentProps, ReactNode } from 'react';
import { ActionSheetIOS, Alert, StyleSheet } from 'react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '../../design-system/unistyles';
import { formatDateTime } from '../../dates/format';
import { darkTheme } from '../../design-system/theme';
import { i18n } from '../../i18n';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';
import { HOLD_GESTURE_TEST_ID } from '../card-context-menu';

import AccountDetailScreen from './account-detail.screen';

// A grid card's delete menu is a react-native-gesture-handler long-press, so
// the screen must mount under a GestureHandlerRootView (the app supplies one at
// its root in production).
const gestureRootWrapper = ({ children }: { children: ReactNode }) => (
  <GestureHandlerRootView>{children}</GestureHandlerRootView>
);

// The Text primitive's tone -> color mapping lives in a react-native-unistyles
// variant that the project's Jest mock strips before a test can inspect it.
// Mock Text here — following the money-text/home test precedent — so the
// resolved `tone` MoneyText emits is observable via a testID, while the amount
// still renders as plain text so every getByText assertion is unaffected.
jest.mock('../../design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone, children }: { tone: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

const mockUseLiveQuery = jest.fn();
const mockSync = jest.fn();
const mockUseSync = jest.fn();
const mockReadToken = jest.fn();
const mockHasToken = jest.fn();
const mockSaveToken = jest.fn();
const mockFetchClientInfo = jest.fn();
const mockRemove = jest.fn();
const mockReorder = jest.fn();
const mockAccountSetIcon = jest.fn();
const mockAccountUpdate = jest.fn();
const mockDisconnect = jest.fn();

// HoldingCard (rendered inside this screen) subscribes to the native stack's
// `transitionEnd` event via `useNavigation` to defer its Liquid Glass one-shot
// until the push slide-in settles. These tests mount the screen with a spy
// navigation *prop* and no NavigationContainer, so the real `useNavigation`
// hook has no context and throws. Stub only `useNavigation` (keep the rest of
// the module real) with a navigation whose `addListener` is an inert
// noop-unsubscribe — the card simply never settles under test, which is fine.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    addListener: () => () => {},
    navigate: jest.fn(),
    setOptions: jest.fn(),
    goBack: jest.fn(),
  }),
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/sync/use-sync', () => ({
  useSync: () => mockUseSync(),
}));
jest.mock('../../monobank/disconnect', () => ({
  disconnectMonobank: (...args: unknown[]) => mockDisconnect(...args),
}));
jest.mock('../../monobank/token', () => ({
  readToken: () => mockReadToken(),
  hasToken: () => mockHasToken(),
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));
jest.mock('../../monobank/monobank.client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: (accountId: string) => ({
      __kind: 'byId',
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    connectedQuery: () => ({
      __kind: 'connected',
      toSQL: () => ({ sql: '', params: ['monobank'] }),
    }),
    setIcon: (...args: unknown[]) => mockAccountSetIcon(...args),
    update: (...args: unknown[]) => mockAccountUpdate(...args),
  },
}));
jest.mock('@kiko/holdings/holdings.repo', () => ({
  holdingsRepo: {
    listByAccountQuery: (accountId: string) => ({
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    remove: (...args: unknown[]) => mockRemove(...args),
    reorder: (...args: unknown[]) => mockReorder(...args),
  },
}));
jest.mock('@kiko/rates/rates.repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

// The crypto section is tested on its own; here it collapses to a marker view
// so the screen's kind-gating is what is under test.
jest.mock('./crypto-sync-section', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ account }: { account: { id: string } }) => (
      <View testID="crypto-sync-section" accessibilityLabel={`crypto-sync ${account.id}`} />
    ),
  };
});

type Account = {
  id: string;
  name: string;
  kind: string;
  institution?: string | null;
  icon?: string | null;
  color?: string | null;
};
type Holding = {
  id: string;
  name: string;
  currency: string;
  balanceMinorUnits: number;
  closedAt?: number | null;
  sortOrder?: number;
  type?: string;
  metadata?: Record<string, unknown> | null;
};
type Rate = { base: string; quote: string; rate: string };
type Settings = { baseCurrency: string; lastSyncAt?: number | null };

/**
 * Drive the five `useLiveQuery` calls, keying on the query's `__kind` (the
 * account-by-id and connected queries both subscribe to `['accounts']`, so the
 * table name alone can't tell them apart) and otherwise on the subscribed
 * table. `connected` defaults to the accounts currently marked
 * `institution: 'monobank'`; `settings` defaults to a UAH base.
 */
const setLiveData = (data: {
  accounts?: Account[];
  holdings?: Holding[];
  connected?: Account[];
  rates?: Rate[];
  settings?: Settings[];
}): void => {
  const accounts = data.accounts ?? [];
  const connected = data.connected ?? accounts.filter((a) => a.institution === 'monobank');
  mockUseLiveQuery.mockImplementation((query: { __kind?: string }, tables: string[]) => {
    if (query.__kind === 'connected') {
      return { data: connected };
    }
    if (tables[0] === 'holdings') {
      // A real holding row always carries a `type`; default it here so a fixture
      // that only cares about name/currency/balance still yields a valid type
      // for the card's color/icon derivation (an undefined type has no default
      // color and would throw in the tint helper).
      return { data: (data.holdings ?? []).map((holding) => ({ type: 'card', ...holding })) };
    }
    if (tables[0] === 'currency_rates') {
      return { data: data.rates ?? [] };
    }
    if (tables[0] === 'settings') {
      return { data: data.settings ?? [{ baseCurrency: 'UAH' }] };
    }
    return { data: accounts };
  });
};

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'a',
  name: 'Monobank',
  kind: 'bank',
  institution: null,
  ...overrides,
});

type AccountDetailProps = ComponentProps<typeof AccountDetailScreen>;

const route = asRouteProp<AccountDetailProps['route']>('AccountDetail', { accountId: 'a' });

// A UAH + USD holding pair with a USD->UAH rate: the overall converts to
// 1,000.00 ₴ + $50.00 * 40 = 3,000.00 ₴. Shared by the two balance tests.
const multiCurrencyData = {
  accounts: [account()],
  holdings: [
    { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 },
    { id: 'h2', name: 'Dollar jar', currency: 'USD', balanceMinorUnits: 5000 },
  ],
  rates: [{ base: 'USD', quote: 'UAH', rate: '40' }],
  settings: [{ baseCurrency: 'UAH' }],
};

/**
 * Render the screen with a fresh spy navigation, returned alongside the RNTL
 * queries so a test can assert on `navigation.navigate` without re-wiring the
 * boilerplate. Live data is seeded per-test (or by `beforeEach`) before this.
 */
const renderScreen = async () => {
  const navigation = navigationSpy();
  const view = await render(
    <AccountDetailScreen
      route={route}
      navigation={asNavigationProp<AccountDetailProps['navigation']>(navigation)}
    />,
    { wrapper: gestureRootWrapper },
  );
  return { ...view, navigation };
};

describe('AccountDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue(undefined);
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    mockReadToken.mockResolvedValue('token-abc');
    mockHasToken.mockResolvedValue(false);
    mockSaveToken.mockResolvedValue(undefined);
    mockFetchClientInfo.mockResolvedValue({ name: 'Jane Doe' });
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
  });

  it('spaces the connected Monobank last-sync line, Sync now and Disconnect evenly', async () => {
    // The three stacked connected-state elements — the "last synced" line, the
    // "Sync now" button, and the "Disconnect" button — must be evenly spaced. The
    // gap inside the status/actions group (last sync ↔ Sync now) must equal the
    // content container's gap (the actions group ↔ Disconnect).
    setLiveData({ accounts: [account({ institution: 'monobank' })] });

    const { getByTestId } = await renderScreen();

    const contentGap = StyleSheet.flatten(getByTestId('account-detail-content').props.style).gap;
    const groupGap = StyleSheet.flatten(
      getByTestId('monobank-sync-status-actions').props.style,
    ).gap;

    expect(groupGap).toBe(contentGap);
  });

  it('lists holdings for the account', async () => {
    const { getByText } = await renderScreen();
    expect(getByText('Black card')).toBeTruthy();
  });

  it('sets the header title to the account name', async () => {
    const { navigation } = await renderScreen();
    expect(navigation.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Monobank' }),
    );
  });

  it('shows the holding balance as money', async () => {
    const { getAllByText } = await renderScreen();
    // The amount now appears in the per-holding row, the overall balance, and
    // the single-currency breakdown line — at least one is enough here.
    expect(getAllByText(/1,000\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('shows the overall converted balance and a per-currency breakdown', async () => {
    setLiveData(multiCurrencyData);
    const { getByText } = await renderScreen();
    // Overall = 1,000.00 ₴ + $50.00 * 40 = 3,000.00 ₴ (unique to the headline).
    expect(getByText(/3,000\.00 ₴/)).toBeTruthy();
    // A breakdown line per held currency (labels appear only in the breakdown).
    expect(getByText('UAH')).toBeTruthy();
    expect(getByText('USD')).toBeTruthy();
  });

  it('renders a positive overall balance in the balance tone (white / textPrimary)', async () => {
    setLiveData(multiCurrencyData);
    const { getByText } = await renderScreen();
    // The converted overall amount is unique to the headline MoneyText.
    expect(getByText(/3,000\.00 ₴/).props.testID).toBe('text-tone-textPrimary');
  });

  it('navigates to HoldingDetail when a holding row is pressed', async () => {
    const { getByText, navigation } = await renderScreen();
    // The holding row is display-only now (rename/icon editing moved to
    // HoldingDetail), so pressing anywhere on it — the name included — opens the
    // detail page.
    await fireEvent.press(getByText('Black card'));
    // The holding's name rides along so the detail screen's large title (and any
    // back button pushed from it) reads immediately, before its own live query.
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingDetail', {
      holdingId: 'h1',
      name: 'Black card',
    });
  });

  it('lays the account holdings out as a drag-and-drop vertical list of wide row cards', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 },
        { id: 'h2', name: 'Dollar jar', currency: 'USD', balanceMinorUnits: 5000 },
      ],
    });
    const { getByTestId, getAllByTestId } = await renderScreen();

    // The holdings render inside the sortable grid, one wrapper item per holding,
    // each a full-width row card (icon + name left, value right) — mirroring the
    // accounts list. The grid is a single column, so the cards carry no square
    // aspectRatio; a dragged card is pinned to its vertical axis.
    const grid = getByTestId('sortable-grid');
    expect(grid.props.overDrag).toBe('vertical');
    const items = getAllByTestId('holding-grid-item');
    expect(items).toHaveLength(2);
    expect(
      StyleSheet.flatten(getAllByTestId('holding-card')[0].props.style).aspectRatio,
    ).toBeUndefined();
  });

  it('renders holdings in the query sort_order, with no zero-value auto-sink', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        // `listByAccountQuery` already returns rows ordered by sort_order, and
        // manual drag order is the sole ordering key: a zero-value holding the
        // user dragged to the front (sort_order 0) stays at the front rather
        // than sinking below a still-valuable holding.
        { id: 'z', name: 'Empty jar', currency: 'UAH', balanceMinorUnits: 0, sortOrder: 0 },
        { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000, sortOrder: 1 },
      ],
    });
    const { getAllByTestId } = await renderScreen();

    const cards = getAllByTestId('holding-card');
    expect(within(cards[0]).getByText('Empty jar')).toBeTruthy();
    expect(within(cards[1]).getByText('Black card')).toBeTruthy();
  });

  it('shows the holding icon as a display-only glyph, not an editable icon control', async () => {
    const { getByLabelText, queryByLabelText } = await renderScreen();
    // The holding row renders a plain, non-editable icon (icon editing moved to
    // HoldingDetail), so its glyph is present but no "Change … icon" affordance.
    expect(getByLabelText('Black card icon')).toBeTruthy();
    expect(queryByLabelText('Change Black card icon')).toBeNull();
  });

  it('tints the account identity icon beside the Balance amount with its stored color', async () => {
    setLiveData({
      accounts: [account({ color: darkTheme.colors.entityColors.violet })],
      holdings: [],
    });
    const { getByLabelText } = await renderScreen();

    // The account icon now sits beside the Balance amount (the nav title shows the
    // NAME only), tinted its stored violet — a bank shows the columns-fill glyph.
    expect(getByLabelText('Icon building.columns.fill').props.tintColor).toBe(
      darkTheme.colors.entityColors.violet,
    );
  });

  it('tints the account identity icon beside the Balance amount with the kind default color when none is stored', async () => {
    setLiveData({ accounts: [account()], holdings: [] });
    const { getByLabelText } = await renderScreen();

    // A `bank` account with no color reads the bank kind default (white).
    expect(getByLabelText('Icon building.columns.fill').props.tintColor).toBe(
      darkTheme.colors.entityColors.white,
    );
  });

  it('resolves the identity icon color the same way the card does — an empty-string stored color falls back to the kind default', async () => {
    // A stored color of '' (neither null nor undefined) slips past a bare
    // `color ?? default`, leaving the header tinted with an invalid empty color
    // while the card (via resolveEntityColor) shows the kind default. The header
    // must resolve through the same helper so the identity color never diverges.
    setLiveData({ accounts: [account({ color: '' })], holdings: [] });
    const { getByLabelText } = await renderScreen();

    expect(getByLabelText('Icon building.columns.fill').props.tintColor).toBe(
      darkTheme.colors.entityColors.white,
    );
  });

  it('excludes closed holdings from the list', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        {
          id: 'h1',
          name: 'Black card',
          currency: 'UAH',
          balanceMinorUnits: 100000,
          closedAt: null,
        },
        {
          id: 'h2',
          name: 'Closed jar',
          currency: 'UAH',
          balanceMinorUnits: 5000,
          closedAt: 1_700_000_000_000,
        },
      ],
    });
    const { getByText, queryByText } = await renderScreen();
    expect(getByText('Black card')).toBeTruthy();
    expect(queryByText('Closed jar')).toBeNull();
  });

  it('navigates to HoldingForm when Add holding is pressed', async () => {
    const { getByText, navigation } = await renderScreen();
    await fireEvent.press(getByText('Add holding'));
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', { accountId: 'a' });
  });

  it('pins the Add holding action to the screen footer', async () => {
    const { getByTestId } = await renderScreen();
    // The action lives in the Screen footer slot so it stays pinned to the
    // bottom on a short page rather than floating beneath the holdings list.
    const footer = getByTestId('screen-footer');
    expect(within(footer).getByText('Add holding')).toBeTruthy();
  });

  it("drives the nav title from the account's real name, with no custom header title component", async () => {
    setLiveData({
      accounts: [account({ name: 'Ukrsibbank Card' })],
      holdings: [],
    });
    const { navigation } = await renderScreen();
    // The name is the plain string `title` — the native large title — with NO
    // `headerTitle` render function and NO `headerLargeTitle` toggle (the icon
    // moved to the body), so the back button on any pushed screen reads it
    // immediately and the large title never flashes collapsing on load.
    expect(navigation.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ukrsibbank Card' }),
    );
    for (const [options] of (navigation.setOptions as jest.Mock).mock.calls) {
      expect(options.headerTitle).toBeUndefined();
      expect(options.headerLargeTitle).toBeUndefined();
    }
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    setLiveData({ accounts: [account()], holdings: [] });
    const { getByTestId } = await renderScreen();
    expect(getByTestId('screen-scroll-view')).toBeTruthy();
  });

  type MonobankGateCase = {
    description: string;
    account: Account | undefined;
    visible: string[];
    hidden: string[];
  };

  const monobankGateCases: MonobankGateCase[] = [
    {
      description: 'the account has not loaded yet',
      account: undefined,
      visible: [],
      hidden: ['Connect Monobank', 'Sync now'],
    },
    {
      description: 'a bank account not yet connected to Monobank',
      account: account({ kind: 'bank', institution: null }),
      visible: ['Connect Monobank'],
      hidden: ['Sync now'],
    },
    {
      description: 'a bank account connected to Monobank',
      account: account({ kind: 'bank', institution: 'monobank' }),
      visible: ['Sync now'],
      hidden: ['Connect Monobank'],
    },
    {
      description: 'a cash account',
      account: account({ kind: 'cash', institution: null }),
      visible: [],
      hidden: ['Connect Monobank', 'Sync now'],
    },
  ];

  it.each(monobankGateCases)(
    'gates the Monobank controls when $description',
    async ({ account: testAccount, visible, hidden }) => {
      setLiveData({ accounts: testAccount ? [testAccount] : [], holdings: [] });
      const { getByText, queryByText } = await renderScreen();
      for (const text of visible) {
        expect(getByText(text)).toBeTruthy();
      }
      for (const text of hidden) {
        expect(queryByText(text)).toBeNull();
      }
    },
  );

  it('hides Connect and shows a hint when another account is already connected', async () => {
    setLiveData({
      accounts: [account({ id: 'a', kind: 'bank', institution: null })],
      holdings: [],
      connected: [account({ id: 'other', kind: 'bank', institution: 'monobank' })],
    });
    const { getByText, queryByText } = await renderScreen();
    expect(queryByText('Connect Monobank')).toBeNull();
    expect(queryByText('Sync now')).toBeNull();
    expect(getByText('Monobank is connected to another account')).toBeTruthy();
  });

  it('syncs the account when a Monobank token exists (Connect action)', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Connect Monobank'));
    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('a'));
  });

  it('re-syncs a connected account when Sync now is pressed', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', institution: 'monobank' })], holdings: [] });
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Sync now'));
    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('a'));
  });

  it('points the user at the on-screen token input and does not sync when no token is stored', async () => {
    mockReadToken.mockResolvedValue(undefined);
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
    const { getByText, findByText, queryByText, navigation } = await renderScreen();
    await fireEvent.press(getByText('Connect Monobank'));
    expect(await findByText(/Add your Monobank token above/)).toBeTruthy();
    // The pointer no longer sends the user to global Settings.
    expect(queryByText(/in Settings/)).toBeNull();
    expect(mockSync).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('renders the Monobank token input and saves it via the token path for a bank account', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
    const { getByPlaceholderText, getByText } = await renderScreen();
    const input = getByPlaceholderText('Monobank token');
    expect(input).toBeTruthy();
    await fireEvent.changeText(input, 'entered-here');
    await act(async () => {
      await fireEvent.press(getByText('Save'));
    });
    expect(mockFetchClientInfo).toHaveBeenCalledWith('entered-here');
    expect(mockSaveToken).toHaveBeenCalledWith('entered-here');
  });

  it('shows the last sync time on a connected bank account, formatted as DD.MM.YYYY HH:mm', async () => {
    setLiveData({
      accounts: [account({ kind: 'bank', institution: 'monobank' })],
      holdings: [],
      settings: [{ baseCurrency: 'UAH', lastSyncAt: 1_700_000_000_000 }],
    });
    const { getByText } = await renderScreen();
    // The shared formatDateTime helper (European DD.MM.YYYY, 24h) replaces the
    // old locale-dependent toLocaleString rendering.
    const stamp = formatDateTime(1_700_000_000_000);
    expect(getByText(new RegExp(stamp.replace(/[.]/g, '\\.')))).toBeTruthy();
  });

  it('does not render the token input for a cash account', async () => {
    setLiveData({ accounts: [account({ kind: 'cash', institution: null })], holdings: [] });
    const { queryByPlaceholderText } = await renderScreen();
    expect(queryByPlaceholderText('Monobank token')).toBeNull();
  });

  it('renders the crypto sync section for a crypto account, with that account', async () => {
    setLiveData({ accounts: [account({ kind: 'crypto', name: 'Cold storage' })], holdings: [] });
    const { getByTestId, getByLabelText, queryByPlaceholderText } = await renderScreen();

    expect(getByTestId('crypto-sync-section')).toBeTruthy();
    expect(getByLabelText('crypto-sync a')).toBeTruthy();
    // no Monobank controls on a crypto account
    expect(queryByPlaceholderText('Monobank token')).toBeNull();
  });

  it.each([
    ['a bank account', account({ kind: 'bank' })],
    ['a cash account', account({ kind: 'cash' })],
  ])('does not render the crypto sync section for %s', async (_label, testAccount) => {
    setLiveData({ accounts: [testAccount], holdings: [] });
    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('crypto-sync-section')).toBeNull();
  });

  it('does not render the crypto sync section before the account has loaded', async () => {
    setLiveData({ accounts: [], holdings: [] });
    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('crypto-sync-section')).toBeNull();
  });

  it('surfaces the sync error from useSync', async () => {
    mockUseSync.mockReturnValue({ isSyncing: false, error: 'sync boom', sync: mockSync });
    setLiveData({ accounts: [account({ kind: 'bank', institution: 'monobank' })], holdings: [] });
    const { getByText } = await renderScreen();
    expect(getByText('sync boom')).toBeTruthy();
  });

  it('shows a syncing label while a connected account is syncing', async () => {
    mockUseSync.mockReturnValue({ isSyncing: true, error: undefined, sync: mockSync });
    setLiveData({ accounts: [account({ kind: 'bank', institution: 'monobank' })], holdings: [] });
    const { getByText } = await renderScreen();
    expect(getByText('Syncing…')).toBeTruthy();
  });

  it('deletes a manual holding via the deep-press delete menu confirm', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
    const sheetSpy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => callback(1));
    await renderScreen();
    // The manual holding card is wrapped in the deep-press long-press. A hold
    // that stays still opens the destructive delete sheet; confirming its
    // destructive index removes the holding.
    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });
    expect(sheetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ options: ['Cancel', 'Delete "Black card"'] }),
      expect.any(Function),
    );
    expect(mockRemove).toHaveBeenCalledWith('h1');
    sheetSpy.mockRestore();
  });

  it('wires an auto-scroll ref and an edge activation offset to the holdings grid (F9)', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 },
        { id: 'h2', name: 'Dollar jar', currency: 'USD', balanceMinorUnits: 5000 },
      ],
    });
    const { getByTestId } = await renderScreen();
    const grid = getByTestId('sortable-grid');
    // The grid receives the parent scroll view's animated ref plus a positive
    // edge offset, so a drag near the top/bottom edge auto-scrolls the list.
    expect(grid.props.scrollableRef).toBeDefined();
    expect(grid.props.autoScrollActivationOffset).toBeGreaterThan(0);
  });

  it('persists a reorder to holdingsRepo.reorder when a holding is dragged to a new slot', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 },
        { id: 'h2', name: 'Dollar jar', currency: 'USD', balanceMinorUnits: 5000 },
      ],
    });
    const { getByTestId } = await renderScreen();
    // A drag that moved (fromIndex !== toIndex) persists the new front-to-back
    // order (indexToKey) rather than opening the menu.
    await act(async () => {
      getByTestId('sortable-grid').props.onDragEnd({
        key: 'h2',
        fromIndex: 1,
        toIndex: 0,
        indexToKey: ['h2', 'h1'],
      });
    });
    expect(mockReorder).toHaveBeenCalledWith(['h2', 'h1']);
  });

  it('replaces the swipe-to-delete row with a plain card (no SwipeableRow in the grid)', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
    const { queryByTestId, queryByLabelText } = await renderScreen();
    // SwipeableRow renders a `*-actions` layer and an a11y "Delete" affordance;
    // neither should exist now that the grid uses a long-press menu instead.
    expect(queryByTestId('swipeable-row-actions')).toBeNull();
    expect(queryByLabelText('Delete', { includeHiddenElements: true })).toBeNull();
  });

  it('renders no context menu on a synced holding (monobankId)', async () => {
    setLiveData({
      accounts: [account({ institution: 'monobank' })],
      holdings: [
        {
          id: 'h1',
          name: 'Black card',
          currency: 'UAH',
          balanceMinorUnits: 100000,
          metadata: { monobankId: 'mono-1' },
        },
      ],
    });
    const { queryByTestId } = await renderScreen();
    // A synced holding is owned by the sync, so its card renders bare with no
    // native context menu to offer a delete.
    expect(queryByTestId('card-context-menu')).toBeNull();
  });

  it('renders the context menu on a holding whose account was disconnected', async () => {
    setLiveData({
      // A disconnect clears the institution but KEEPS the holding's monobankId,
      // so a later reconnect re-adopts the row. Nothing syncs the balance
      // anymore, so the card is deletable again and offers its menu.
      accounts: [account({ institution: null })],
      holdings: [
        {
          id: 'h1',
          name: 'Black card',
          currency: 'UAH',
          balanceMinorUnits: 100000,
          metadata: { monobankId: 'mono-1' },
        },
      ],
    });
    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('card-context-menu')).not.toBeNull();
  });

  it('renders a view-only header with no inline name, icon, or color editors', async () => {
    setLiveData({
      accounts: [account({ name: 'Ukrsibbank Card', icon: 'banknote' })],
      holdings: [],
    });
    const { queryByLabelText } = await renderScreen();
    // Identity editing moved to the dedicated edit form: the header no longer
    // offers the icon-picker toggle, the editable name field, or the color
    // swatch row it used to.
    expect(queryByLabelText('Change Icon')).toBeNull();
    expect(queryByLabelText('Ukrsibbank Card name')).toBeNull();
    expect(queryByLabelText('Color violet')).toBeNull();
  });

  it('offers an Edit action in the header that opens the account edit form', async () => {
    setLiveData({ accounts: [account()], holdings: [] });
    const { navigation } = await renderScreen();
    // The Edit affordance sits at the header top-right (via setOptions
    // headerRight). Render it and press it: it opens this account's edit form.
    const call = (navigation.setOptions as jest.Mock).mock.calls.find(
      ([options]) => options.headerRight,
    );
    expect(call).toBeDefined();
    const { getByText } = await render(call[0].headerRight());
    await fireEvent.press(getByText('Edit'));
    expect(navigation.navigate).toHaveBeenCalledWith('AccountForm', { accountId: 'a' });
  });

  it('offers a Disconnect Monobank action on a connected account and confirms before disconnecting', async () => {
    mockDisconnect.mockResolvedValue(undefined);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      (buttons ?? []).find((b) => b.style === 'destructive')?.onPress?.();
    });
    setLiveData({
      accounts: [account({ kind: 'bank', institution: 'monobank' })],
      holdings: [],
    });
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Disconnect Monobank'));
    // The action confirms (an Alert) before it clears the connection + token.
    expect(alertSpy).toHaveBeenCalled();
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalledWith('a'));
    alertSpy.mockRestore();
  });

  it('does not offer Disconnect Monobank on an account that is not connected', async () => {
    setLiveData({
      accounts: [account({ kind: 'bank', institution: null })],
      holdings: [],
    });
    const { queryByText } = await renderScreen();
    expect(queryByText('Disconnect Monobank')).toBeNull();
  });

  it('reflects term-deposit growth in net worth (now is passed)', async () => {
    // A recapitalizing 10%/yr deposit funded well in the past has matured: its
    // value grows to 1,100.00 ₴ gross, less 23% tax on 100.00 ₴ interest, for a
    // 1,077.00 ₴ net worth — distinct from the 1,000.00 ₴ cached balance. Without
    // the `now` argument the growth math yields NaN and this value never renders.
    const START = Date.UTC(2020, 0, 1);
    setLiveData({
      accounts: [account()],
      holdings: [
        {
          id: 'h1',
          name: 'Term deposit',
          currency: 'UAH',
          balanceMinorUnits: 100000,
          type: 'term_deposit',
          metadata: {
            contributions: [{ amountMinorUnits: 100000, date: START }],
            annualRatePct: 10,
            termMonths: 12,
            recapitalization: true,
            compounding: 'annually',
          },
        },
      ],
    });
    // The grown value now appears in both the headline and the (single UAH)
    // breakdown line, so more than one match is expected.
    const { getAllByText } = await renderScreen();
    expect(getAllByText(/1,077\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('reflects the grown deposit value in the per-currency breakdown (not the raw balance)', async () => {
    // Same matured recapitalizing deposit: gross 1,100.00 ₴, net-of-tax 1,077.00 ₴.
    // The breakdown values the holding via holdingValue, so the grown 1,077.00 ₴
    // appears both in the headline and in the single UAH breakdown line — while
    // the raw 1,000.00 ₴ cached balance shows only in the holding row. Passing
    // `now` to sumByCurrency is what makes the breakdown line agree.
    const START = Date.UTC(2020, 0, 1);
    setLiveData({
      accounts: [account()],
      holdings: [
        {
          id: 'h1',
          name: 'Term deposit',
          currency: 'UAH',
          balanceMinorUnits: 100000,
          type: 'term_deposit',
          metadata: {
            contributions: [{ amountMinorUnits: 100000, date: START }],
            annualRatePct: 10,
            termMonths: 12,
            recapitalization: true,
            compounding: 'annually',
          },
        },
      ],
    });
    const { getAllByText } = await renderScreen();
    // Two occurrences: the balance headline and the UAH breakdown line. Without
    // the grown valuation the breakdown would instead show 1,000.00 ₴, leaving
    // only the single headline match.
    expect(getAllByText(/1,077\.00 ₴/).length).toBeGreaterThanOrEqual(2);
  });
});

describe('AccountDetailScreen — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue(undefined);
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    mockReadToken.mockResolvedValue('token-abc');
    mockHasToken.mockResolvedValue(false);
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the footer action, the Holdings heading, and the Monobank controls from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Додати актив')).toBeTruthy();
    expect(getByText('Активи')).toBeTruthy();
    expect(getByText('Підключити Monobank')).toBeTruthy();
    expect(queryByText('Add holding')).toBeNull();
    expect(queryByText('Connect Monobank')).toBeNull();
  });
});
