import { ActionSheetIOS, Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import '../../design-system/unistyles';
import { formatDateTime } from '../../dates/format';
import { darkTheme } from '../../design-system/theme';
import AccountDetailScreen from './account-detail.screen';

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
const mockSaveToken = jest.fn();
const mockFetchClientInfo = jest.fn();
const mockRemove = jest.fn();
const mockReorder = jest.fn();
const mockAccountSetIcon = jest.fn();
const mockAccountUpdate = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../use-sync', () => ({
  useSync: () => mockUseSync(),
}));
jest.mock('../../monobank/disconnect', () => ({
  disconnectMonobank: (...args: unknown[]) => mockDisconnect(...args),
}));
jest.mock('../../monobank/token', () => ({
  readToken: () => mockReadToken(),
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));
jest.mock('../../monobank/monobank.client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));
jest.mock('../../repositories/accounts.repo', () => ({
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
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    listByAccountQuery: (accountId: string) => ({
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    remove: (...args: unknown[]) => mockRemove(...args),
    reorder: (...args: unknown[]) => mockReorder(...args),
  },
}));
jest.mock('../../repositories/rates.repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

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
      return { data: data.holdings ?? [] };
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

const route = { params: { accountId: 'a' } } as never;

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
  const navigation = { navigate: jest.fn(), setOptions: jest.fn() } as never;
  const view = await render(<AccountDetailScreen route={route} navigation={navigation} />);
  return { ...view, navigation };
};

describe('AccountDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue(undefined);
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    mockReadToken.mockResolvedValue('token-abc');
    mockSaveToken.mockResolvedValue(undefined);
    mockFetchClientInfo.mockResolvedValue({ name: 'Jane Doe' });
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
  });

  it('lists holdings for the account', async () => {
    const { getByText } = await renderScreen();
    expect(getByText('Black card')).toBeTruthy();
  });

  it('sets the header title to the account name', async () => {
    const { navigation } = await renderScreen();
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Monobank' });
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
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingDetail', { holdingId: 'h1' });
  });

  it('lays the account holdings out as a drag-and-drop grid of square cards', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 },
        { id: 'h2', name: 'Dollar jar', currency: 'USD', balanceMinorUnits: 5000 },
      ],
    });
    const { getByTestId, getAllByTestId } = await renderScreen();

    // The holdings render inside the sortable grid, one wrapper item per
    // holding, each holding a square (aspectRatio 1) card. Column layout is now
    // owned by Sortable.Grid (columns=2), so the item widths are no longer set
    // by this screen's own styles.
    expect(getByTestId('sortable-grid')).toBeTruthy();
    const items = getAllByTestId('holding-grid-item');
    expect(items).toHaveLength(2);
    expect(StyleSheet.flatten(getAllByTestId('holding-card')[0].props.style).aspectRatio).toBe(1);
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

  it('tints the header account icon with its stored color', async () => {
    setLiveData({
      accounts: [account({ color: darkTheme.colors.entityColors.violet })],
      holdings: [],
    });
    const { getByLabelText } = await renderScreen();

    // A bank account shows the building.columns glyph, tinted its stored violet.
    expect(getByLabelText('Icon building.columns').props.tintColor).toBe(
      darkTheme.colors.entityColors.violet,
    );
  });

  it('tints the header account icon with the kind default color when none is stored', async () => {
    setLiveData({ accounts: [account()], holdings: [] });
    const { getByLabelText } = await renderScreen();

    // A `bank` account with no color reads the bank kind default (white).
    expect(getByLabelText('Icon building.columns').props.tintColor).toBe(
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

  it("drives the header title from the account's real name, with no in-body duplicate", async () => {
    setLiveData({
      accounts: [account({ name: 'Ukrsibbank Card' })],
      holdings: [],
    });
    const { queryByText, navigation } = await renderScreen();
    // The name is the single (header) title, set via setOptions; it no longer
    // also renders as an in-body <Text variant="title"> duplicate.
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Ukrsibbank Card' });
    expect(queryByText('Ukrsibbank Card')).toBeNull();
    expect(queryByText('Account')).toBeNull();
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

  it('deletes a manual holding via the long-press-in-place menu (drag ended where it started)', async () => {
    // Auto-confirm: pick the destructive Delete option (index 0) as soon as the
    // native action sheet opens.
    const actionSheetSpy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => {
        callback(0);
      });
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
    const { getByTestId } = await renderScreen();
    // A long-press that lifts the card and releases it in place (fromIndex ===
    // toIndex) stands in for the context menu: the grid's onDragEnd opens the
    // delete action sheet for that holding.
    await act(async () => {
      getByTestId('sortable-grid').props.onDragEnd({
        key: 'h1',
        fromIndex: 0,
        toIndex: 0,
        indexToKey: ['h1'],
      });
    });
    expect(actionSheetSpy).toHaveBeenCalledWith(
      {
        options: ['Delete "Black card"', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      expect.any(Function),
    );
    expect(mockRemove).toHaveBeenCalledWith('h1');
    actionSheetSpy.mockRestore();
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

  it('does not offer the delete menu on a synced holding (monobankId)', async () => {
    const actionSheetSpy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => undefined);
    setLiveData({
      accounts: [account()],
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
    const { getByTestId } = await renderScreen();
    // A synced holding is owned by the sync: a long-press-in-place resolves to a
    // synced row, so the grid opens no delete menu.
    await act(async () => {
      getByTestId('sortable-grid').props.onDragEnd({
        key: 'h1',
        fromIndex: 0,
        toIndex: 0,
        indexToKey: ['h1'],
      });
    });
    expect(actionSheetSpy).not.toHaveBeenCalled();
    actionSheetSpy.mockRestore();
  });

  it("changes the account's own icon through the header icon editor, via accountsRepo.setIcon", async () => {
    setLiveData({ accounts: [account({ name: 'Cash', kind: 'cash' })], holdings: [] });
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon basket'));
    expect(mockAccountSetIcon).toHaveBeenCalledWith('a', 'basket');
  });

  it("clears the account's own icon through the header icon editor Remove control", async () => {
    setLiveData({
      accounts: [account({ name: 'Cash', kind: 'cash', icon: 'banknote' })],
      holdings: [],
    });
    const { getByLabelText, getByText } = await renderScreen();
    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByText('Remove'));
    expect(mockAccountSetIcon).toHaveBeenCalledWith('a', null);
  });

  it('hydrates the color picker with the account stored color as the selected swatch', async () => {
    setLiveData({
      accounts: [account({ color: darkTheme.colors.entityColors.violet })],
      holdings: [],
    });
    const { getByLabelText } = await renderScreen();
    expect(getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);
  });

  it('hydrates the color picker with the kind default when no color is stored', async () => {
    setLiveData({ accounts: [account()], holdings: [] });
    const { getByLabelText } = await renderScreen();
    // A `bank` account with no color highlights the bank kind default (white).
    expect(getByLabelText('Color white').props.accessibilityState.selected).toBe(true);
  });

  it("changes the account's own color through the header color picker, via accountsRepo.update", async () => {
    setLiveData({ accounts: [account()], holdings: [] });
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText('Color violet'));
    expect(mockAccountUpdate).toHaveBeenCalledWith('a', {
      color: darkTheme.colors.entityColors.violet,
    });
  });

  it("edits the account's own name in a header field and renames via accountsRepo.update on end-of-editing", async () => {
    setLiveData({ accounts: [account({ name: 'Ukrsibbank Card' })], holdings: [] });
    const { getByLabelText, getByDisplayValue } = await renderScreen();
    // The name renders as a labelled, editable field pre-filled with the account
    // name; the rename commits once on end-of-editing through the generic update.
    const field = getByDisplayValue('Ukrsibbank Card');
    expect(field.props.editable).not.toBe(false);
    const input = getByLabelText('Ukrsibbank Card name');
    await fireEvent.changeText(input, 'Renamed account');
    await fireEvent(input, 'endEditing');
    expect(mockAccountUpdate).toHaveBeenCalledWith('a', { name: 'Renamed account' });
  });

  it('does not save an empty account name', async () => {
    setLiveData({ accounts: [account({ name: 'Ukrsibbank Card' })], holdings: [] });
    const { getByLabelText } = await renderScreen();
    const input = getByLabelText('Ukrsibbank Card name');
    await fireEvent.changeText(input, '   ');
    await fireEvent(input, 'endEditing');
    expect(mockAccountUpdate).not.toHaveBeenCalled();
  });

  it('does not save an unchanged account name', async () => {
    setLiveData({ accounts: [account({ name: 'Ukrsibbank Card' })], holdings: [] });
    const { getByLabelText } = await renderScreen();
    const input = getByLabelText('Ukrsibbank Card name');
    await fireEvent(input, 'endEditing');
    expect(mockAccountUpdate).not.toHaveBeenCalled();
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
