import { Alert, StyleSheet } from 'react-native';
import { State } from 'react-native-gesture-handler';
import type { ComponentProps, ReactNode } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { formatDateTime } from '@kiko/dates';
import { darkTheme } from '@kiko/design-system/theme';
import {
  CLOSE_ACTION_TEST_ID,
  DELETE_ACTION_TEST_ID,
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import { dropCard, liftCard } from '@kiko/test-support/lift-grid-card';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import type { RemoveHoldingsPlan } from '@kiko/transactions/remove-notice';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import AccountDetailScreen from './account-detail.screen';

// The Text primitive's tone -> color mapping lives in a react-native-unistyles
// variant that the project's Jest mock strips before a test can inspect it.
// Mock Text here — following the money-text/home test precedent — so the
// resolved `tone` MoneyText emits is observable via a testID, while the amount
// still renders as plain text so every getByText assertion is unaffected.
jest.mock('@kiko/design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone, children }: { tone: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

// The Button variant maps to a themed fill inside a react-native-unistyles
// `variants` block that the project's Jest mock strips from the resolved style,
// and onAccent/textPrimary are both white so the label color cannot tell primary
// from secondaryTonal apart either. Mock Button to record the `variant` it
// receives — following the contribution-buttons precedent — while still
// rendering the label (and forwarding onPress/disabled) so every
// getByText/press assertion in this file is unaffected.
const mockButtonProps: {
  variant?: string;
  children: ReactNode;
  icon?: string;
  fullWidth?: boolean;
}[] = [];

jest.mock('@kiko/design-system/components/button', () => {
  const { Pressable, Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: (props: {
      variant?: string;
      children?: ReactNode;
      onPress: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      testID?: string;
      icon?: string;
      fullWidth?: boolean;
    }) => {
      mockButtonProps.push({
        variant: props.variant,
        children: props.children,
        icon: props.icon,
        fullWidth: props.fullWidth,
      });

      return (
        <Pressable
          accessibilityLabel={props.accessibilityLabel}
          testID={props.testID}
          onPress={props.onPress}
          disabled={props.disabled}
        >
          {props.children !== undefined && <RNText>{props.children}</RNText>}
        </Pressable>
      );
    },
  };
});

const mockUseLiveQuery = jest.fn();
const mockSync = jest.fn();
const mockUseSync = jest.fn();
const mockSaveToken = jest.fn();
const mockFetchClientInfo = jest.fn();
const mockPick = jest.fn();
const mockKeepLocalCopy = jest.fn();
const mockReadFile = jest.fn();
const mockRemove = jest.fn();
const mockRemoveHoldingsPlan = jest.fn(
  async (..._args: unknown[]): Promise<RemoveHoldingsPlan> => ({
    deletedRows: { count: 0, names: [] },
    reversedContributions: [],
    keptContributions: [],
    keptSynced: [],
    unlinked: [],
    unlinkedPlain: false,
  }),
);
const mockCloseMany = jest.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
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
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
// The offer's rules are proven on a real database in its own suite; here the
// screen's wiring of the card is under test. No offer unless a test sets one.
const mockUseReminderOffer = jest.fn();
jest.mock('@kiko/reminders/offer', () => ({
  useReminderOffer: (...args: unknown[]) => mockUseReminderOffer(...args),
}));
// `BankSyncSection` (real, unmocked here) calls `useSync` once per render for
// its sole shipped provider (Guideline 5.6 remediation: Monobank-only).
jest.mock('@kiko/sync/use-sync', () => ({
  useSync: () => mockUseSync(),
}));
jest.mock('@kiko/monobank/disconnect', () => ({
  disconnectMonobank: (...args: unknown[]) => mockDisconnect(...args),
}));
jest.mock('@kiko/monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));
jest.mock('@kiko/monobank/client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: (...args: unknown[]) => mockPick(...args),
  keepLocalCopy: (...args: unknown[]) => mockKeepLocalCopy(...args),
  types: { csv: 'text/csv', xlsx: 'application/xlsx', plainText: 'text/plain', allFiles: '*/*' },
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: (error: unknown): error is { code: string } =>
    typeof error === 'object' && error !== null && 'code' in error,
}));
jest.mock('react-native-fs', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: (accountId: string) => ({
      __kind: 'byId',
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    setIcon: (...args: unknown[]) => mockAccountSetIcon(...args),
    update: (...args: unknown[]) => mockAccountUpdate(...args),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    listByAccountQuery: (accountId: string) => ({
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    closeMany: (...args: unknown[]) => mockCloseMany(...args),
    reorder: (...args: unknown[]) => mockReorder(...args),
    balanceOf: (row: { currency: string; balanceMinorUnits: number }) => ({
      currency: row.currency,
      minorUnits: row.balanceMinorUnits,
    }),
  },
}));
jest.mock('@kiko/transactions/repo', () => {
  const actual = jest.requireActual('@kiko/transactions/repo');

  return {
    transactionsRepo: {
      ...actual.transactionsRepo,
      removeHolding: (...args: unknown[]) => mockRemove(...args),
      removeHoldingsPlan: (...args: unknown[]) => mockRemoveHoldingsPlan(...args),
    },
  };
});
jest.mock('@kiko/rates/repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: {
    getQuery: () => ({ __kind: 'sync_state', toSQL: () => ({ sql: '', params: [] }) }),
  },
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
  bankId?: string | null;
  archivedAt?: number | null;
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
type Settings = { baseCurrency: string };
type SyncState = { lastSyncAt?: number | null; lastSyncDisplayAt?: number | null };

// One mocked `useLiveQuery` result.
type LiveResult = { data: unknown[]; isLoading?: boolean; isFresh?: boolean };

/**
 * Drive the `useLiveQuery` calls, keying on the query's `__kind` (the
 * account-by-id query subscribes to `['accounts']`, so the table name alone
 * can't tell it apart from a future account query) and otherwise on the
 * subscribed table. `settings` defaults to a UAH base. The Monobank "last sync"
 * line reads the PER-CONNECTION `sync_state` cursor, seeded via `syncState`.
 */
const setLiveData = (data: {
  accounts?: Account[];
  holdings?: Holding[];
  rates?: Rate[];
  settings?: Settings[];
  syncState?: SyncState[];
  // Every flag below defaults to `false` (an already-resolved query), so
  // every existing call site keeps behaving exactly as before; a test that
  // cares about the loading gate passes one or more explicitly.
  accountsIsLoading?: boolean;
  holdingsIsLoading?: boolean;
  ratesIsLoading?: boolean;
  settingsIsLoading?: boolean;
  pricePointsIsLoading?: boolean;
  // `true` = the holdings are still the cached rows (`isFresh: false`), for
  // the reorder-gate test only.
  holdingsIsStale?: boolean;
}): void => {
  const accounts = data.accounts ?? [];
  // A per-table result map: a lookup instead of an if-chain keeps this well
  // under the cognitive-complexity budget (kiko-code-style).
  const resultByTable: Record<string, LiveResult> = {
    // A real holding row always carries a `type`; default it here so a
    // fixture that only cares about name/currency/balance still yields a
    // valid type for the card's color/icon derivation (an undefined type
    // has no default color and would throw in the tint helper).
    holdings: {
      data: (data.holdings ?? []).map((holding) => ({ type: 'card', ...holding })),
      isLoading: data.holdingsIsLoading ?? false,
      isFresh: !(data.holdingsIsStale ?? false),
    },
    currency_rates: { data: data.rates ?? [], isLoading: data.ratesIsLoading ?? false },
    settings: {
      data: data.settings ?? [{ baseCurrency: 'UAH' }],
      isLoading: data.settingsIsLoading ?? false,
    },
    sync_state: { data: data.syncState ?? [] },
    price_points: { data: [], isLoading: data.pricePointsIsLoading ?? false },
  };

  mockUseLiveQuery.mockImplementation((_query: { __kind?: string }, tables: string[]) => {
    return (
      resultByTable[tables[0]] ?? { data: accounts, isLoading: data.accountsIsLoading ?? false }
    );
  });
};

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'a',
  name: 'Monobank',
  kind: 'bank',
  institution: null,
  // `bankId` defaults to `null` here, matching the real `AccountRow`'s
  // Drizzle-inferred type (a nullable column is `string | null`, never
  // `undefined`) — `BankSyncSection`'s disconnected default reads this
  // field directly, so a fixture that left it `undefined`
  // crashed `isBankProviderId`'s `bankProviderIdOf` call on a real render.
  bankId: null,
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
const renderScreen = async (screenRoute: AccountDetailProps['route'] = route) => {
  const navigation = navigationSpy();
  const view = await render(
    <AccountDetailScreen
      route={screenRoute}
      navigation={asNavigationProp<AccountDetailProps['navigation']>(navigation)}
    />,
    { wrapper: GestureRootWrapper },
  );

  return { ...view, navigation };
};

/**
 * Drives the disconnected picker flow up to (not including) the Connect
 * press: opens `AddBankProviderSheet` via the "Add a bank" trigger, then
 * selects the Monobank row — the sheet reports the choice and closes itself,
 * leaving `MonobankConnectField` mounted for the caller to drive further.
 */
const openMonobankConnectField = async (
  view: Pick<Awaited<ReturnType<typeof render>>, 'getByText' | 'getByTestId'>,
): Promise<void> => {
  await fireEvent.press(view.getByText(i18n.t('accountDetail.addBankAction')));
  await fireEvent.press(view.getByTestId('add-bank-option-monobank'));
};

describe('AccountDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockButtonProps.length = 0;
    mockSync.mockResolvedValue(undefined);
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    mockSaveToken.mockResolvedValue(undefined);
    mockFetchClientInfo.mockResolvedValue({ name: 'Jane Doe' });
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
  });

  it('spaces the connected Monobank last-sync line above the actions row evenly', async () => {
    // The last-sync line sits above the single actions row (Sync + Disconnect
    // side by side). The gap inside the status/actions group (last sync ↔ actions
    // row) must equal the content container's gap for one even vertical rhythm.
    setLiveData({ accounts: [account({ institution: 'monobank' })] });

    const { getByTestId } = await renderScreen();

    const contentGap = StyleSheet.flatten(getByTestId('account-detail-content').props.style).gap;
    const groupGap = StyleSheet.flatten(getByTestId('bank-sync-status-actions').props.style).gap;

    expect(groupGap).toBe(contentGap);
  });

  it('puts Sync and Disconnect side by side in a single row when connected', async () => {
    setLiveData({ accounts: [account({ institution: 'monobank' })] });

    const { getByTestId } = await renderScreen();

    // The two buttons now share one horizontal row rather than stacking.
    const row = getByTestId('bank-sync-actions-row');
    expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row');
  });

  it('keeps the connected Sync button and Disconnect both neutral (secondaryTonal)', async () => {
    setLiveData({ accounts: [account({ institution: 'monobank' })] });

    mockButtonProps.length = 0;
    await renderScreen();

    // Sync is now the same lower-emphasis `secondaryTonal` tint as Disconnect
    // beside it — the pinned account-detail Sync button style.
    const syncEntry = mockButtonProps.find((entry) => entry.children === 'Sync');
    const disconnectEntry = mockButtonProps.find((entry) => entry.children === 'Disconnect');
    expect(syncEntry?.variant).toBe('secondaryTonal');
    expect(disconnectEntry?.variant).toBe('secondaryTonal');
  });

  it('uses the Kiko UI sync glyph for the connected Sync button and the open-lock glyph for Disconnect', async () => {
    setLiveData({ accounts: [account({ institution: 'monobank' })] });

    mockButtonProps.length = 0;
    await renderScreen();

    // Sync-now takes the iOS-18 rotate glyph; Disconnect takes the open-lock glyph.
    const syncEntry = mockButtonProps.find((entry) => entry.children === 'Sync');
    const disconnectEntry = mockButtonProps.find((entry) => entry.children === 'Disconnect');
    expect(syncEntry?.icon).toBe('arrow.trianglehead.2.clockwise.rotate.90');
    expect(disconnectEntry?.icon).toBe('lock.open');
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

  it('does not open the holding when a hold lifted its card and the finger ends in place', async () => {
    const { getByTestId, getByText, navigation } = await renderScreen();

    await liftCard(getByTestId('sortable-grid'), 'h1');
    await fireEvent.press(getByText('Black card'));

    expect(navigation.navigate).not.toHaveBeenCalledWith('HoldingDetail', expect.anything());
  });

  it('opens the holding on the next quick tap after a lifted release', async () => {
    const { getByTestId, getByText, navigation } = await renderScreen();

    await liftCard(getByTestId('sortable-grid'), 'h1');
    await fireEvent.press(getByText('Black card'));
    await fireEvent.press(getByText('Black card'));

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingDetail', {
      holdingId: 'h1',
      name: 'Black card',
    });
  });

  it('opens the holding on a quick tap once the lifted card was dropped with no press', async () => {
    const { getByTestId, getByText, navigation } = await renderScreen();

    await liftCard(getByTestId('sortable-grid'), 'h1');
    await dropCard(getByTestId('sortable-grid'), 'h1');
    await fireEvent.press(getByText('Black card'));

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

  it("shows each holding's type under its title in the grid", async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 },
        { id: 'h2', name: 'Savings', type: 'term_deposit', currency: 'UAH', balanceMinorUnits: 0 },
      ],
    });
    const { getAllByTestId } = await renderScreen();
    const [card, deposit] = getAllByTestId('holding-card-type');

    expect(card).toHaveTextContent('Card');
    expect(deposit).toHaveTextContent('Deposit');
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

    // The account icon sits beside the Balance amount (the nav title shows the
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

  it('shows the stored identity icon when the account has one', async () => {
    setLiveData({ accounts: [account({ icon: 'creditcard' })], holdings: [] });
    const { getByLabelText, queryByLabelText } = await renderScreen();

    expect(getByLabelText('Icon creditcard')).toBeTruthy();
    expect(queryByLabelText('Icon building.columns.fill')).toBeNull();
  });

  it('shows the kind glyph as the identity icon when the stored icon is null', async () => {
    setLiveData({ accounts: [account({ icon: null })], holdings: [] });
    const { getByLabelText } = await renderScreen();

    expect(getByLabelText('Icon building.columns.fill')).toBeTruthy();
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
      hidden: ['Connect Monobank', 'Sync'],
    },
    {
      description: 'a bank account not yet connected to Monobank',
      account: account({ kind: 'bank', institution: null }),
      // Disconnected shows the "Add a bank" picker trigger, not the
      // Monobank field directly — see the picker-flow tests below.
      visible: ['Add a bank'],
      hidden: ['Connect Monobank', 'Sync'],
    },
    {
      description: 'a bank account connected to Monobank',
      account: account({ kind: 'bank', institution: 'monobank' }),
      visible: ['Sync'],
      hidden: ['Connect Monobank'],
    },
    {
      // "Other bank" is manual import only: it shows no connect affordance at
      // all, not even the "Add a bank" trigger.
      description: 'a bank account stored as Other bank, not connected',
      account: account({ kind: 'bank', bankId: 'other', institution: null }),
      visible: [],
      hidden: ['Connect Monobank', 'Sync', 'Add a bank'],
    },
    {
      // A legacy Monobank connection made before the bank picker carries the
      // `other` id migration 0049 wrote; it must keep its Sync and Disconnect.
      description: 'a bank account stored as Other bank that is still connected to Monobank',
      account: account({ kind: 'bank', bankId: 'other', institution: 'monobank' }),
      visible: ['Sync', 'Disconnect'],
      hidden: ['Connect Monobank', 'Add a bank'],
    },
    {
      description: 'a bank account whose picked bank is import-only but is still connected',
      account: account({ kind: 'bank', bankId: 'privatbank', institution: 'monobank' }),
      visible: ['Sync', 'Disconnect'],
      hidden: ['Connect Monobank', 'Add a bank'],
    },
    {
      description: 'a cash account',
      account: account({ kind: 'cash', institution: null }),
      visible: [],
      hidden: ['Connect Monobank', 'Sync'],
    },
    {
      description: 'a broker account',
      account: account({ kind: 'broker', bankId: 'trading212', institution: null }),
      visible: [],
      hidden: ['Connect Monobank', 'Sync', 'Add a bank'],
    },
    {
      // An import-only bank (bankCatalog's
      // `connectable: false`) must show NO sync/connect affordance at all —
      // not even the disconnected "Add a bank" trigger.
      description: 'a bank account whose picked bank is import-only (e.g. PrivatBank)',
      account: account({ kind: 'bank', bankId: 'privatbank', institution: null }),
      visible: [],
      hidden: ['Connect Monobank', 'Sync', 'Add a bank'],
    },
    {
      // A bank account already identified as Monobank skips the
      // "Add a bank" picker entirely and goes straight to Connect — only an
      // UNIDENTIFIED bank account shows the "Add a bank" trigger, and a
      // KNOWN import-only bank hides the section altogether.
      description: 'a bank account whose picked bank is connectable (Monobank), not yet connected',
      account: account({ kind: 'bank', bankId: 'monobank', institution: null }),
      visible: ['Connect Monobank'],
      hidden: ['Add a bank', 'Sync'],
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

  it('hides the whole Synchronization section (heading included) for an import-only bank account', async () => {
    // A non-syncable (import-only) bank
    // account must show NO trace of the sync section — not merely the
    // buttons the table above checks, but the "Synchronization" heading
    // itself, which `BankSyncSection` renders at its own top.
    setLiveData({
      accounts: [account({ kind: 'bank', bankId: 'privatbank', institution: null })],
      holdings: [],
    });
    const { queryByText } = await renderScreen();

    expect(queryByText(i18n.t('accountDetail.synchronization'))).toBeNull();
  });

  it('lets a bank account connect independently, with no single-connection gate or hint', async () => {
    // A bank account shows Connect on its own — the screen does not query
    // whether another account already holds a Monobank connection — and no
    // "connected elsewhere" hint is ever rendered.
    setLiveData({
      accounts: [account({ id: 'a', kind: 'bank', institution: null })],
      holdings: [],
    });
    const view = await renderScreen();
    await openMonobankConnectField(view);
    expect(view.getByText('Connect Monobank')).toBeTruthy();
    expect(view.queryByText('Monobank is connected to another account')).toBeNull();
  });

  it('re-syncs a connected account when Sync is pressed', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', institution: 'monobank' })], holdings: [] });
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Sync'));
    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('a'));
  });

  it('connects a bank account by validating the token, saving it, then syncing it (Connect folds save into connect)', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
    const view = await renderScreen();
    await openMonobankConnectField(view);
    const input = view.getByPlaceholderText('Monobank token');
    await fireEvent.changeText(input, 'entered-here');
    await act(async () => {
      await fireEvent.press(view.getByText('Connect Monobank'));
    });

    // Validate BEFORE save: fetchClientInfo runs first, and only a successful
    // validation reaches saveToken — no orphaned Keychain item on an invalid
    // token (see the invalid-token test below).
    expect(mockFetchClientInfo).toHaveBeenCalledWith('entered-here');
    // The token binds to THIS account's id (per-account Keychain item), not a
    // shared global slot.
    expect(mockSaveToken).toHaveBeenCalledWith('a', 'entered-here');
    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('a'));
  });

  it('never saves an invalid token: validation failure keeps the field usable and skips saveToken/sync entirely', async () => {
    mockFetchClientInfo.mockRejectedValue(new Error('401'));
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
    const view = await renderScreen();
    await openMonobankConnectField(view);
    const input = view.getByPlaceholderText('Monobank token');
    await fireEvent.changeText(input, 'bad-token');
    await act(async () => {
      await fireEvent.press(view.getByText('Connect Monobank'));
    });

    expect(await view.findByText('Invalid token')).toBeTruthy();
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    // The entered text is kept so the user can retry immediately, without
    // re-entering the token.
    expect(view.getByPlaceholderText('Monobank token').props.value).toBe('bad-token');
  });

  it('keeps a valid-but-unsynced token retryable: a failed connect keeps the field usable for an immediate retry', async () => {
    mockSync.mockResolvedValueOnce(false);
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
    const view = await renderScreen();
    await openMonobankConnectField(view);
    const { getByPlaceholderText, getByText, findByText } = view;
    const input = getByPlaceholderText('Monobank token');
    await fireEvent.changeText(input, 'entered-here');
    await act(async () => {
      await fireEvent.press(getByText('Connect Monobank'));
    });

    expect(await findByText('Could not connect Monobank')).toBeTruthy();
    // The token is kept in the field (not cleared) so a retry does not require
    // re-entering it.
    expect(getByPlaceholderText('Monobank token').props.value).toBe('entered-here');

    // Retrying without re-entering the token succeeds: Connect stayed pressable
    // and re-runs the same validated token through save + sync.
    mockSync.mockResolvedValueOnce(true);
    await act(async () => {
      await fireEvent.press(getByText('Connect Monobank'));
    });
    expect(mockSaveToken).toHaveBeenCalledTimes(2);
    expect(mockSaveToken).toHaveBeenLastCalledWith('a', 'entered-here');
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(2));
  });

  it('shows the last sync time on a connected bank account, formatted as DD.MM.YYYY HH:mm', async () => {
    setLiveData({
      accounts: [account({ kind: 'bank', institution: 'monobank' })],
      holdings: [],
      syncState: [{ lastSyncAt: 1_700_000_000_000 }],
    });
    const { getByText } = await renderScreen();
    // The shared formatDateTime helper (European DD.MM.YYYY, 24h) replaces the
    // old locale-dependent toLocaleString rendering.
    const stamp = formatDateTime(1_700_000_000_000, { uses24Hour: true });
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

  // A still hold on a manual holding card opens the shared action list.
  const holdHoldingCard = async (): Promise<void> => {
    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });
  };

  it('deletes a manual holding via the action list and the themed delete confirm', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
    const { getByTestId, getByText } = await renderScreen();

    await holdHoldingCard();
    await act(async () => {
      await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
    });

    expect(getByText('Delete "Black card"')).toBeTruthy();

    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(mockRemove).toHaveBeenCalledWith('h1');
  });

  it('names what deleting a holding takes from other holdings under the confirm title', async () => {
    mockRemoveHoldingsPlan.mockResolvedValueOnce({
      deletedRows: { count: 1, names: ['Dollar card'] },
      reversedContributions: ['Deposit'],
      keptContributions: [],
      keptSynced: [],
      unlinked: [],
      unlinkedPlain: false,
    });
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
    const { getByTestId, getByText } = await renderScreen();

    await holdHoldingCard();
    await act(async () => {
      await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
    });

    expect(mockRemoveHoldingsPlan).toHaveBeenCalledWith(['h1']);
    expect(getByText('Delete "Black card"')).toBeTruthy();
    expect(
      getByText(
        'This also deletes 1 linked transaction in Dollar card. This also removes the contributions it made to Deposit.',
      ),
    ).toBeTruthy();
  });

  it('keeps the holding confirm bare when nothing else is linked, or the plan cannot be read', async () => {
    mockRemoveHoldingsPlan.mockRejectedValueOnce(new Error('read failed'));
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
    const { getByTestId, getByText, queryByText } = await renderScreen();

    await holdHoldingCard();
    await act(async () => {
      await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
    });

    expect(getByText('Delete "Black card"')).toBeTruthy();
    expect(queryByText(/This also/)).toBeNull();
    expect(getByTestId(DELETE_CONFIRM_TEST_ID)).toBeTruthy();
  });

  describe('closing a manual holding', () => {
    const seedShares = (): void =>
      setLiveData({
        accounts: [account()],
        holdings: [{ id: 'h1', name: 'Shares', currency: 'UAH', balanceMinorUnits: 0 }],
      });

    const openCloseConfirm = async (
      getByTestId: Awaited<ReturnType<typeof renderScreen>>['getByTestId'],
    ): Promise<void> => {
      await holdHoldingCard();
      await act(async () => {
        await fireEvent.press(getByTestId(CLOSE_ACTION_TEST_ID));
      });
    };

    it('closes it through its own confirm, keeping it from being deleted', async () => {
      seedShares();
      const { getByTestId, getByText } = await renderScreen();

      await openCloseConfirm(getByTestId);

      expect(getByText('Close "Shares"')).toBeTruthy();
      expect(mockCloseMany).not.toHaveBeenCalled();

      await act(async () => {
        await fireEvent.press(getByTestId('close-holding-confirm'));
      });

      expect(mockCloseMany).toHaveBeenCalledWith(['h1']);
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('closes nothing on Cancel', async () => {
      seedShares();
      const { getByTestId, getByText, queryByText } = await renderScreen();

      await openCloseConfirm(getByTestId);
      await act(async () => {
        await fireEvent.press(getByText('Cancel'));
      });

      expect(queryByText('Close "Shares"')).toBeNull();
      expect(mockCloseMany).not.toHaveBeenCalled();
    });

    it('alerts when the close fails', async () => {
      mockCloseMany.mockRejectedValueOnce(new Error('write failed'));
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      seedShares();
      const { getByTestId } = await renderScreen();

      await openCloseConfirm(getByTestId);
      await act(async () => {
        await fireEvent.press(getByTestId('close-holding-confirm'));
      });

      expect(alertSpy).toHaveBeenCalledWith('Could not close holding', 'Please try again.');
      alertSpy.mockRestore();
    });

    it('names the menu entry "Close holding" in a neutral button, and confirms in red', async () => {
      seedShares();
      mockButtonProps.length = 0;
      const { getByTestId } = await renderScreen();

      await openCloseConfirm(getByTestId);

      const menuEntry = mockButtonProps.find((entry) => entry.children === 'Close holding');
      const confirm = mockButtonProps.filter((entry) => entry.children === 'Close').at(-1);

      expect(menuEntry?.variant).toBeUndefined();
      expect(confirm?.variant).toBe('destructive');
    });

    describe('a loan', () => {
      const seedLoan = (): void =>
        setLiveData({
          accounts: [account({ kind: 'debt' })],
          holdings: [
            { id: 'h1', name: 'Car', type: 'loan', currency: 'UAH', balanceMinorUnits: 0 },
          ],
        });

      it('closes it under loan wording, never "holding"', async () => {
        seedLoan();
        const { getByTestId, getByText, queryByText } = await renderScreen();

        await holdHoldingCard();

        expect(getByTestId(CLOSE_ACTION_TEST_ID)).toHaveTextContent('Close loan');

        await act(async () => {
          await fireEvent.press(getByTestId(CLOSE_ACTION_TEST_ID));
        });

        expect(getByText('Close Loan "Car"')).toBeTruthy();
        expect(
          getByText(
            "It leaves your accounts and stops counting against your net worth. Its past values stay on the net worth chart. A closed loan can't be reopened.",
          ),
        ).toBeTruthy();
        expect(queryByText(/close holding/i)).toBeNull();
      });

      it('alerts under loan wording when the close fails', async () => {
        mockCloseMany.mockRejectedValueOnce(new Error('write failed'));
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        seedLoan();
        const { getByTestId } = await renderScreen();

        await openCloseConfirm(getByTestId);
        await act(async () => {
          await fireEvent.press(getByTestId('close-holding-confirm'));
        });

        expect(alertSpy).toHaveBeenCalledWith('Could not close loan', 'Please try again.');
        alertSpy.mockRestore();
      });
    });
  });

  it('wires an auto-scroll ref and an edge activation offset to the holdings grid', async () => {
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

  // kiko-architecture: a cached display mount shows rows that can be one read
  // old, and a drag persists the order of the holdings on screen — so it
  // never starts until the holdings query's own fresh read has applied.
  it.each([
    [true, false],
    [false, true],
  ])(
    'enables the holdings drag only once the holdings are fresh (stale: %s)',
    async (holdingsIsStale, sortEnabled) => {
      setLiveData({
        accounts: [account()],
        holdings: [
          { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 },
          { id: 'h2', name: 'Dollar jar', currency: 'USD', balanceMinorUnits: 5000 },
        ],
        holdingsIsStale,
      });
      const { getByTestId } = await renderScreen();

      expect(getByTestId('sortable-grid').props.sortEnabled).toBe(sortEnabled);
    },
  );

  // A hold lifts the card; with one holding there is nothing to reorder, it
  // lifts and drops back, so the lone card feels the same as one among many.
  it.each([
    [true, false],
    [false, true],
  ])(
    'lets a lone holding lift on a hold only once the holdings are fresh (stale: %s)',
    async (holdingsIsStale, sortEnabled) => {
      setLiveData({
        accounts: [account()],
        holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
        holdingsIsStale,
      });
      const { getByTestId } = await renderScreen();

      expect(getByTestId('sortable-grid').props.sortEnabled).toBe(sortEnabled);
    },
  );

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

  it('wires a manual holding card to the shared long-press menu, not a swipe-to-delete row', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
    const { queryByTestId } = await renderScreen();
    // The delete affordance is the shared CardContextMenu long-press — the card
    // is wrapped in its `card-context-menu` layer and registers the hold
    // gesture — rather than a swipe-to-delete row. `getByGestureTestId` throws
    // when the hold gesture is absent, so reaching it asserts the affordance.
    expect(queryByTestId('card-context-menu')).not.toBeNull();
    expect(getByGestureTestId(HOLD_GESTURE_TEST_ID)).toBeTruthy();
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
      // so a later reconnect re-adopts the row. Nothing syncs the balance, so
      // the card is deletable and offers its menu.
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
    // Identity editing lives in the dedicated edit form: the header offers no
    // icon-picker toggle, editable name field, or color swatch row.
    expect(queryByLabelText('Change Icon')).toBeNull();
    expect(queryByLabelText('Ukrsibbank Card name')).toBeNull();
    expect(queryByLabelText('Color violet')).toBeNull();
  });

  const headerRightItems = (navigation: ReturnType<typeof navigationSpy>) => {
    const call = (navigation.setOptions as jest.Mock).mock.calls.find(
      ([options]) => options.unstable_headerRightItems,
    );

    expect(call).toBeDefined();

    return call[0].unstable_headerRightItems({ canGoBack: true });
  };

  it('offers an Edit action in the header that opens the account edit form', async () => {
    setLiveData({ accounts: [account()], holdings: [] });
    const { navigation } = await renderScreen();
    const items = headerRightItems(navigation);
    const edit = items.find((item: { icon?: { name: string } }) => item.icon?.name === 'pencil');

    expect(items.some((item: { type: string }) => item.type === 'custom')).toBe(false);
    expect(edit).toMatchObject({
      type: 'button',
      label: 'Edit',
      accessibilityLabel: 'Edit',
      icon: { type: 'sfSymbol', name: 'pencil' },
      sharesBackground: false,
    });

    edit.onPress();

    expect(navigation.navigate).toHaveBeenCalledWith('AccountForm', { accountId: 'a' });
  });

  it('offers a Reminders bell as its own header item, left of Edit', async () => {
    setLiveData({ accounts: [account({ name: 'Cash box' })], holdings: [] });
    const { navigation } = await renderScreen();
    const items = headerRightItems(navigation);

    expect(items.map((item: { icon: { name: string } }) => item.icon.name)).toEqual([
      'bell',
      'pencil',
    ]);
    expect(items[0]).toMatchObject({
      icon: { type: 'sfSymbol', name: 'bell' },
      accessibilityLabel: 'Reminders',
      sharesBackground: false,
    });

    items[0].onPress();

    expect(navigation.navigate).toHaveBeenCalledWith('AccountReminders', { accountId: 'a' });
  });

  it('offers a Disconnect action on a connected account and confirms via the themed sheet before disconnecting', async () => {
    mockDisconnect.mockResolvedValue(undefined);
    setLiveData({
      accounts: [account({ kind: 'bank', institution: 'monobank' })],
      holdings: [],
    });
    const { getByText, getByTestId } = await renderScreen();
    await fireEvent.press(getByText('Disconnect'));
    // The themed ConfirmSheet (not a native Alert.alert) opens before the
    // connection + token are cleared.
    expect(getByText('Disconnect Monobank')).toBeTruthy();
    expect(mockDisconnect).not.toHaveBeenCalled();
    await fireEvent.press(getByTestId('bank-disconnect-confirm'));
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalledWith('a'));
  });

  it('disconnects nothing when the themed Disconnect confirm is dismissed via Cancel', async () => {
    setLiveData({
      accounts: [account({ kind: 'bank', institution: 'monobank' })],
      holdings: [],
    });
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Disconnect'));
    await fireEvent.press(getByText('Cancel'));
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it('does not offer Disconnect on an account that is not connected', async () => {
    setLiveData({
      accounts: [account({ kind: 'bank', institution: null })],
      holdings: [],
    });
    const { queryByText } = await renderScreen();
    expect(queryByText('Disconnect')).toBeNull();
  });

  // PrivatBank, bunq, and Starling have no bank-CONNECT (Guideline 5.6) —
  // Monobank is the sole shipped native provider, so the picker sheet lists
  // exactly one row and there is no cross-provider routing to exercise here
  // (see `bank-sync-section.component.test.tsx` and
  // `add-bank-sheet.component.test.tsx`).
  it('opens the add-a-bank picker sheet for a disconnected bank account, listing the shipped native provider', async () => {
    setLiveData({
      accounts: [account({ kind: 'bank', institution: null })],
      holdings: [],
    });
    const view = await renderScreen();

    // No provider's field is mounted before a choice is made.
    expect(view.queryByText('Connect Monobank')).toBeNull();

    await fireEvent.press(view.getByText('Add a bank'));

    expect(view.getByTestId('add-bank-sheet')).toBeTruthy();
    expect(view.getByText('Monobank')).toBeTruthy();
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

describe('AccountDetailScreen — reminder offer', () => {
  const mockDismiss = jest.fn();

  const offerOf = (kind: 'statement_import' | 'add_transactions'): void => {
    mockUseReminderOffer.mockReturnValue({ kind, dismiss: mockDismiss });
  };

  const triggers = (): string[] => [
    ...new Set(
      mockUseReminderOffer.mock.calls.map(([{ accountId, trigger }]) => `${accountId} ${trigger}`),
    ),
  ];

  const afterImportRoute = asRouteProp<AccountDetailProps['route']>('AccountDetail', {
    accountId: 'a',
    name: 'Cash',
    reminderOffer: 'afterImport',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseReminderOffer.mockReset();
    mockButtonProps.length = 0;
    mockDismiss.mockResolvedValue(undefined);
    setLiveData({ accounts: [account({ kind: 'cash' })], holdings: [] });
  });

  it('asks for the import offer when a finished import sent the page here', async () => {
    await renderScreen(afterImportRoute);

    expect(triggers()).toEqual(['a afterImport']);
  });

  it('asks for the manual-entry offer otherwise', async () => {
    await renderScreen();

    expect(triggers()).toEqual(['a manualActivity']);
  });

  it('hands the offer the account and settings rows the page already read', async () => {
    const cash = account({ kind: 'cash' });
    const settings = { baseCurrency: 'EUR' };
    setLiveData({ accounts: [cash], holdings: [], settings: [settings] });

    await renderScreen();

    expect(mockUseReminderOffer).toHaveBeenLastCalledWith(
      expect.objectContaining({ account: cash, settings }),
    );
  });

  it('shows no offer card while there is no offer', async () => {
    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('reminder-offer')).toBeNull();
  });

  it('shows the import offer first in the page content', async () => {
    offerOf('statement_import');
    const { getByTestId } = await renderScreen(afterImportRoute);
    const content = getByTestId('account-detail-content');

    expect(
      within(content).getByText('Want a reminder to import your next statement?'),
    ).toBeTruthy();
    expect(content.children[0]).toBe(getByTestId('reminder-offer'));
  });

  it('shows the add-transactions message for the manual-entry offer', async () => {
    offerOf('add_transactions');
    const { getByText } = await renderScreen();

    expect(getByText('Want a reminder to add transactions to this account?')).toBeTruthy();
  });

  describe('in Ukrainian', () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('shows the add-transactions message from the Ukrainian catalogue', async () => {
      offerOf('add_transactions');
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByText } = await renderScreen();

      expect(getByText('Нагадувати про додавання транзакцій до цього рахунку?')).toBeTruthy();
    });
  });

  it('Set up opens the reminder form for that kind and clears the import offer', async () => {
    offerOf('statement_import');
    const { getByText, navigation } = await renderScreen(afterImportRoute);

    await fireEvent.press(getByText('Set up reminder'));

    expect(navigation.navigate).toHaveBeenCalledWith('ReminderForm', {
      accountId: 'a',
      kind: 'statement_import',
    });
    expect(navigation.setParams).toHaveBeenCalledWith({ reminderOffer: undefined });
  });

  it('Set up records the decision, so the offer never returns, even with the form left unsaved', async () => {
    offerOf('add_transactions');
    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Set up reminder'));

    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it('a failed record on Set up still opens the form, with no alert over it, and logs', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockDismiss.mockRejectedValue(new Error('database is locked SECRET'));
    offerOf('add_transactions');
    const { getByText, navigation } = await renderScreen();

    await fireEvent.press(getByText('Set up reminder'));

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[reminders] offer decision not saved', {
        name: 'Error',
        code: undefined,
      }),
    );
    expect(navigation.navigate).toHaveBeenCalledWith('ReminderForm', {
      accountId: 'a',
      kind: 'add_transactions',
    });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');

    warn.mockRestore();
    alertSpy.mockRestore();
  });

  it('Not now dismisses the offer, then clears the import offer', async () => {
    offerOf('statement_import');
    const { getByText, navigation } = await renderScreen(afterImportRoute);

    await fireEvent.press(getByText('Not now'));

    await waitFor(() =>
      expect(navigation.setParams).toHaveBeenCalledWith({ reminderOffer: undefined }),
    );
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  describe('at most one offer per visit', () => {
    const offerByTrigger = new Map<string | undefined, { kind: string; dismiss: jest.Mock }>([
      ['afterImport', { kind: 'statement_import', dismiss: mockDismiss }],
      ['manualActivity', { kind: 'add_transactions', dismiss: mockDismiss }],
    ]);

    const renderVisit = async (params: object) => {
      const view = await renderScreen(asRouteProp('AccountDetail', params));
      // The router's own param update, which the spy navigation does not make.
      const setParams = async (next: object): Promise<void> => {
        await view.rerender(
          <AccountDetailScreen
            route={asRouteProp('AccountDetail', next)}
            navigation={asNavigationProp<AccountDetailProps['navigation']>(view.navigation)}
          />,
        );
      };

      return { ...view, setParams };
    };

    const lastTrigger = (): unknown => mockUseReminderOffer.mock.lastCall?.[0].trigger;

    beforeEach(() => {
      mockUseReminderOffer.mockImplementation(({ trigger }: { trigger?: string }) =>
        offerByTrigger.get(trigger),
      );
    });

    it.each(['Set up reminder', 'Not now'])(
      'shows no manual-entry offer once the import offer is decided with %s',
      async (label) => {
        const view = await renderVisit({
          accountId: 'a',
          name: 'Cash',
          reminderOffer: 'afterImport',
        });

        await fireEvent.press(view.getByText(label));
        await waitFor(() =>
          expect(view.navigation.setParams).toHaveBeenCalledWith({ reminderOffer: undefined }),
        );
        await view.setParams({ accountId: 'a', name: 'Cash' });

        expect(view.queryByTestId('reminder-offer')).toBeNull();
        expect(lastTrigger()).toBeUndefined();
      },
    );

    it('shows the manual-entry offer no more once a later import offer is decided', async () => {
      const view = await renderVisit({ accountId: 'a', name: 'Cash' });

      expect(view.getByText('Want a reminder to add transactions to this account?')).toBeTruthy();

      await view.setParams({ accountId: 'a', name: 'Cash', reminderOffer: 'afterImport' });
      await fireEvent.press(view.getByText('Not now'));
      await waitFor(() =>
        expect(view.navigation.setParams).toHaveBeenCalledWith({ reminderOffer: undefined }),
      );
      await view.setParams({ accountId: 'a', name: 'Cash' });

      expect(view.queryByTestId('reminder-offer')).toBeNull();
      expect(lastTrigger()).toBeUndefined();
    });
  });

  it('a failed Not now shows the save-error alert and keeps the offer', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockDismiss.mockRejectedValue(new Error('database is locked'));
    offerOf('statement_import');
    const { getByText, getByTestId, navigation } = await renderScreen(afterImportRoute);

    await fireEvent.press(getByText('Not now'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(navigation.setParams).not.toHaveBeenCalled();
    expect(getByTestId('reminder-offer')).toBeTruthy();

    alertSpy.mockRestore();
  });
});

describe('AccountDetailScreen — loading gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockButtonProps.length = 0;
    mockSync.mockResolvedValue(undefined);
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
  });

  it('shows a loading spinner, not the zero-balance content, while any of its own queries is on its first load', async () => {
    setLiveData({ accounts: [], holdings: [], holdingsIsLoading: true });

    const { getByTestId, queryByTestId, queryByText } = await renderScreen();

    expect(getByTestId('account-detail-loading')).toBeTruthy();
    expect(queryByTestId('account-detail-content')).toBeNull();
    // 0.00 ₴ is what an empty-while-loading render would show for the
    // not-yet-loaded balance — it must never appear during loading.
    expect(queryByText(/0\.00/)).toBeNull();
    // The SAME Screen mode as the ready branch (`scroll`) — the first scroll
    // view iOS walks to drive the native large-title collapse must exist
    // from the very first render, not only once data has loaded.
    expect(getByTestId('screen-scroll-view')).toBeTruthy();
  });

  it('renders the real content once every query has loaded', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });

    const { getByTestId, getByText, queryByTestId } = await renderScreen();

    expect(getByTestId('account-detail-content')).toBeTruthy();
    expect(getByText('Black card')).toBeTruthy();
    expect(queryByTestId('account-detail-loading')).toBeNull();
  });

  it('renders loading then loaded on ONE mounted instance — spinner first, then the real content, via rerender', async () => {
    setLiveData({ accounts: [], holdings: [], holdingsIsLoading: true });
    const view = await renderScreen();

    expect(view.getByTestId('account-detail-loading')).toBeTruthy();
    expect(view.queryByTestId('account-detail-content')).toBeNull();

    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
    await act(async () => {
      view.rerender(
        <AccountDetailScreen
          route={route}
          navigation={asNavigationProp<AccountDetailProps['navigation']>(view.navigation)}
        />,
      );
    });

    expect(view.queryByTestId('account-detail-loading')).toBeNull();
    expect(view.getByTestId('account-detail-content')).toBeTruthy();
    expect(view.getByText('Black card')).toBeTruthy();
  });
});

describe('AccountDetailScreen — statement import (footer button + pickAndOpenStatement)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockButtonProps.length = 0;
    mockSync.mockResolvedValue(undefined);
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    setLiveData({ accounts: [account({ bankId: 'monobank' })], holdings: [] });
    mockKeepLocalCopy.mockResolvedValue([
      { status: 'success', localUri: 'file:///cache/statement.csv' },
    ]);
  });

  it('renders an Import statement action beside Add holding in the footer', async () => {
    const { getByTestId } = await renderScreen();

    const footer = getByTestId('screen-footer');
    expect(within(footer).getByText('Import statement')).toBeTruthy();
    expect(within(footer).getByText('Add holding')).toBeTruthy();
  });

  // The bank sync already writes every row of the account; a statement of the
  // same rows would land a second time under the import source.
  it('offers no Import statement on an account a bank sync owns', async () => {
    setLiveData({
      accounts: [account({ bankId: 'monobank', institution: 'monobank' })],
      holdings: [],
    });
    const { getByTestId } = await renderScreen();

    const footer = getByTestId('screen-footer');
    expect(within(footer).queryByText('Import statement')).toBeNull();
    expect(within(footer).getByText('Add holding')).toBeTruthy();
  });

  it('renders Import statement with the secondaryTonal variant and its doc icon (Add holding stays primary)', async () => {
    await renderScreen();

    const importButton = mockButtonProps.find((props) => props.children === 'Import statement');
    const addHoldingButton = mockButtonProps.find((props) => props.children === 'Add holding');

    expect(importButton?.variant).toBe('secondaryTonal');
    expect(importButton?.icon).toBe('doc.badge.plus');
    expect(addHoldingButton?.variant).toBe('primary');
  });

  it('leads Add holding with the generic holding glyph', async () => {
    await renderScreen();

    const addHoldingButton = mockButtonProps.find((props) => props.children === 'Add holding');

    expect(addHoldingButton?.icon).toBe('list.bullet.rectangle');
  });

  it('renders Import statement full-width, stacked above Add holding (not sharing a row)', async () => {
    await renderScreen();

    const importButton = mockButtonProps.find((props) => props.children === 'Import statement');

    // Button defaults fullWidth to true, so full width means it never opts out.
    expect(importButton).toBeDefined();
    expect(importButton?.fullWidth).not.toBe(false);
  });

  it('opens the document picker with csv/xlsx/plainText/allFiles accepted types when Import statement is pressed', async () => {
    mockPick.mockRejectedValue({ code: 'OPERATION_CANCELED' });
    const { getByText } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByText('Import statement'));
    });

    expect(mockPick).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ['text/csv', 'application/xlsx', 'text/plain', '*/*'],
      }),
    );
  });

  it('handles a cancelled picker gracefully: no file read, no navigation, no thrown error', async () => {
    mockPick.mockRejectedValue({ code: 'OPERATION_CANCELED' });
    const { getByText, navigation } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByText('Import statement'));
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('StatementImport', expect.anything());
  });

  // A raw picked URI can be a transient/security-scoped
  // external one (iCloud/Files/AirDrop) that tolerates one or two reads but
  // not the THIRD `RNFS.readFile` the preview + two Map-Columns visits each
  // make — `keepLocalCopy` (the same pattern `import-data.screen.tsx`
  // already uses) copies it into the app's own cache ONCE at pick time, so
  // every later read is of a file Kiko itself owns.
  it('copies the picked file locally (keepLocalCopy) and navigates to StatementImport with the LOCAL copy path, without reading the file itself', async () => {
    mockPick.mockResolvedValue([
      { uri: 'file:///mock/statement.csv', name: 'statement.csv', type: 'text/csv' },
    ]);
    mockKeepLocalCopy.mockResolvedValue([
      { status: 'success', localUri: 'file:///cache/statement.csv' },
    ]);
    const { getByText, navigation } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByText('Import statement'));
    });

    expect(mockKeepLocalCopy).toHaveBeenCalledWith({
      files: [{ uri: 'file:///mock/statement.csv', fileName: 'statement.csv' }],
      destination: 'cachesDirectory',
    });
    // `pickAndOpenStatement` hands the LOCAL copy's uri to
    // `StatementImportScreen`, which owns the ONE read of this file — a
    // pre-read here would pay for the read twice and leave its own failure
    // mode unhandled at this call site (see the handler's own doc comment).
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('StatementImport', {
      filePath: 'file:///cache/statement.csv',
      accountId: 'a',
      expectedFormatId: 'monobank-csv',
    });
  });

  it('falls back to the raw picked uri when keepLocalCopy fails', async () => {
    mockPick.mockResolvedValue([
      { uri: 'file:///mock/statement.csv', name: 'statement.csv', type: 'text/csv' },
    ]);
    mockKeepLocalCopy.mockResolvedValue([{ status: 'error', copyError: 'boom' }]);
    const { getByText, navigation } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByText('Import statement'));
    });

    expect(navigation.navigate).toHaveBeenCalledWith('StatementImport', {
      filePath: 'file:///mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'monobank-csv',
    });
  });

  it('passes expectedFormatId resolved from the account bankId when navigating to StatementImport', async () => {
    setLiveData({ accounts: [account({ bankId: 'privatbank' })], holdings: [] });
    mockPick.mockResolvedValue([
      { uri: 'file:///mock/statement.xlsx', name: 'statement.xlsx', type: 'application/xlsx' },
    ]);
    mockKeepLocalCopy.mockResolvedValue([
      { status: 'success', localUri: 'file:///cache/statement.xlsx' },
    ]);
    const { getByText, navigation } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByText('Import statement'));
    });

    expect(navigation.navigate).toHaveBeenCalledWith('StatementImport', {
      filePath: 'file:///cache/statement.xlsx',
      accountId: 'a',
      expectedFormatId: 'privatbank-xlsx',
    });
  });

  // Oschadbank has no dedicated `statement-import` parser — its import
  // routes through the generic column-mapping screen, which
  // `StatementImportScreen` reaches whenever `expectedFormatId` is undefined
  // and nothing auto-detects. `pickAndOpenStatement` must not invent a format
  // id for a bank the catalog has none for.
  it('passes no expectedFormatId for Oschadbank (no dedicated format, falls through to column mapping)', async () => {
    setLiveData({ accounts: [account({ bankId: 'oschadbank' })], holdings: [] });
    mockPick.mockResolvedValue([
      { uri: 'file:///mock/statement.csv', name: 'statement.csv', type: 'text/csv' },
    ]);
    const { getByText, navigation } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByText('Import statement'));
    });

    expect(navigation.navigate).toHaveBeenCalledWith('StatementImport', {
      filePath: 'file:///cache/statement.csv',
      accountId: 'a',
      expectedFormatId: undefined,
    });
  });

  it('passes no expectedFormatId for a bank account stored as Other bank (multi-format auto-detect, as with no bank)', async () => {
    setLiveData({ accounts: [account({ bankId: 'other' })], holdings: [] });
    mockPick.mockResolvedValue([
      { uri: 'file:///mock/statement.csv', name: 'statement.csv', type: 'text/csv' },
    ]);
    const { getByText, navigation } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByText('Import statement'));
    });

    expect(navigation.navigate).toHaveBeenCalledWith('StatementImport', {
      filePath: 'file:///cache/statement.csv',
      accountId: 'a',
      expectedFormatId: undefined,
    });
  });

  it('hides Import statement for a cash account', async () => {
    setLiveData({ accounts: [account({ kind: 'cash', bankId: null })], holdings: [] });
    const { queryByText } = await renderScreen();

    expect(queryByText('Import statement')).toBeNull();
  });

  it('hides Import statement for a crypto account', async () => {
    setLiveData({ accounts: [account({ kind: 'crypto', bankId: null })], holdings: [] });
    const { queryByText } = await renderScreen();

    expect(queryByText('Import statement')).toBeNull();
  });

  it('hides Import statement and the Synchronization section for a broker account', async () => {
    setLiveData({ accounts: [account({ kind: 'broker', bankId: 'trading212' })], holdings: [] });
    const { getByText, queryByText } = await renderScreen();

    expect(queryByText('Import statement')).toBeNull();
    expect(queryByText(i18n.t('accountDetail.synchronization'))).toBeNull();
    expect(getByText('Add holding')).toBeTruthy();
  });

  // `isBankAccount` gates the entry point — EVERY bank account
  // offers it, with or without a known statement format,
  // since an unrecognized/mismatched file still routes through the generic
  // column-mapping screen (`statement-import.screen.tsx`'s own "Map columns
  // manually" button) rather than dead-ending.
  it('shows Import statement for a bank account with no bank picked (no known statement format, still a bank account)', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', bankId: null })], holdings: [] });
    const { getByText } = await renderScreen();

    expect(getByText('Import statement')).toBeTruthy();
  });

  it('shows Import statement for a bank account whose picked bank resolves to a statement format', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', bankId: 'privatbank' })], holdings: [] });
    const { getByText } = await renderScreen();

    expect(getByText('Import statement')).toBeTruthy();
  });
});

describe('AccountDetailScreen — a tap on an import reminder', () => {
  const importTapParams = { accountId: 'a', name: 'Monobank', intent: 'importStatement' };

  const renderTap = async (params: object = importTapParams) => {
    const view = await renderScreen(asRouteProp('AccountDetail', params));
    // The router's own param update, which the spy navigation does not make.
    const rerenderWith = async (next: object): Promise<void> => {
      await view.rerender(
        <AccountDetailScreen
          route={asRouteProp('AccountDetail', next)}
          navigation={asNavigationProp<AccountDetailProps['navigation']>(view.navigation)}
        />,
      );
    };

    return { ...view, rerenderWith };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockButtonProps.length = 0;
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    mockPick.mockRejectedValue({ code: 'OPERATION_CANCELED' });
    setLiveData({ accounts: [account({ bankId: 'monobank' })], holdings: [] });
  });

  it('opens the file picker once and clears the intent', async () => {
    const view = await renderTap();

    await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(1));
    expect(view.navigation.setParams).toHaveBeenCalledWith({ intent: undefined });

    await view.rerenderWith({ accountId: 'a', name: 'Monobank' });
    await view.rerenderWith({ accountId: 'a', name: 'Monobank' });

    expect(mockPick).toHaveBeenCalledTimes(1);
  });

  it('hands the picked file to the statement import, as the footer button does', async () => {
    mockPick.mockResolvedValue([
      { uri: 'file:///mock/statement.csv', name: 'statement.csv', type: 'text/csv' },
    ]);
    mockKeepLocalCopy.mockResolvedValue([
      { status: 'success', localUri: 'file:///cache/statement.csv' },
    ]);
    const view = await renderTap();

    await waitFor(() =>
      expect(view.navigation.navigate).toHaveBeenCalledWith('StatementImport', {
        filePath: 'file:///cache/statement.csv',
        accountId: 'a',
        expectedFormatId: 'monobank-csv',
      }),
    );
  });

  it('waits for the page to load before it opens the picker', async () => {
    setLiveData({ accounts: [], holdings: [], accountsIsLoading: true });
    const view = await renderTap();

    expect(mockPick).not.toHaveBeenCalled();
    expect(view.navigation.setParams).not.toHaveBeenCalled();

    setLiveData({ accounts: [account({ bankId: 'monobank' })], holdings: [] });
    await view.rerenderWith(importTapParams);

    await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(1));
  });

  it('opens no picker on an account that cannot import, and still clears the intent', async () => {
    setLiveData({ accounts: [account({ kind: 'cash', bankId: null })], holdings: [] });
    const view = await renderTap();

    expect(view.navigation.setParams).toHaveBeenCalledWith({ intent: undefined });
    expect(mockPick).not.toHaveBeenCalled();
  });

  it('opens no picker on an account a bank sync owns, and still clears the intent', async () => {
    setLiveData({
      accounts: [account({ bankId: 'monobank', institution: 'monobank' })],
      holdings: [],
    });
    const view = await renderTap();

    expect(view.navigation.setParams).toHaveBeenCalledWith({ intent: undefined });
    expect(mockPick).not.toHaveBeenCalled();
  });

  it('opens no picker on an ordinary visit', async () => {
    const view = await renderTap({ accountId: 'a', name: 'Monobank' });

    expect(mockPick).not.toHaveBeenCalled();
    expect(view.navigation.setParams).not.toHaveBeenCalled();
  });
});

describe('AccountDetailScreen — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockButtonProps.length = 0;
    mockSync.mockResolvedValue(undefined);
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
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

    const view = await renderScreen();

    expect(view.getByText('Додати актив')).toBeTruthy();
    expect(view.getByText('Активи')).toBeTruthy();
    expect(view.getByText('Додати банк')).toBeTruthy();
    expect(view.queryByText('Add holding')).toBeNull();

    // Opening the picker and choosing Monobank renders its connect field
    // from the same Ukrainian catalog.
    await fireEvent.press(view.getByText('Додати банк'));
    await fireEvent.press(view.getByTestId('add-bank-option-monobank'));

    expect(view.getByText('Підключити Monobank')).toBeTruthy();
    expect(view.queryByText('Connect Monobank')).toBeNull();
  });
});

// kiko-architecture: no request or query for data the user does not have —
// usePriceBook's price_points read is disabled while nothing on this screen
// is a priced type (property_item/metal) or a loan.
describe('AccountDetailScreen — the price_points gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables the price_points read when no holding needs it', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 0 }],
    });
    await renderScreen();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(false);
  });

  it('enables the price_points read once a priced holding is present', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        { id: 'h1', name: 'Gold bar', currency: 'UAH', balanceMinorUnits: 0, type: 'metal' },
      ],
    });
    await renderScreen();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });

  it('reads price_points in parallel while holdings are still on their first load', async () => {
    setLiveData({ accounts: [account()], holdingsIsLoading: true });
    await renderScreen();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });

  // Only a loan reads its linked payments, so a priced-only screen never
  // runs the linked-payments read.
  it('reads the linked loan payments only once a loan is present', async () => {
    const loanPaymentsCall = () =>
      mockUseLiveQuery.mock.calls.find((call) => call[1].join(',') === 'transactions,holdings');
    const holdingOfType = (type: string) => ({
      id: 'h1',
      name: 'Holding',
      currency: 'UAH',
      balanceMinorUnits: 0,
      type,
    });

    setLiveData({ accounts: [account()], holdings: [holdingOfType('metal')] });
    await renderScreen();
    expect(loanPaymentsCall()?.[2]).toBe(false);

    mockUseLiveQuery.mockClear();
    setLiveData({ accounts: [account()], holdings: [holdingOfType('loan')] });
    await renderScreen();
    expect(loanPaymentsCall()?.[2]).toBe(true);
  });
});

// The implicit property and debt accounts have no card in the Accounts list:
// their section heading opens this screen instead, so it must read as the
// account's own page (localized name, holdings, Add holding, Edit) without
// the controls that make no sense for an account that holds ledgerless
// holdings (reminders, statement import, bank or crypto sync).
describe('AccountDetailScreen — an implicit account', () => {
  const kinds = [
    ['property', 'Properties', 'Майно'],
    ['debt', 'Loans', 'Кредити'],
  ] as const;

  const mockDismiss = jest.fn();

  const implicitAccount = (kind: 'property' | 'debt', overrides: Partial<Account> = {}) =>
    account({
      kind,
      name: kind === 'property' ? 'Properties' : 'Loans',
      bankId: null,
      archivedAt: null,
      ...overrides,
    });

  const headerItems = (navigation: ReturnType<typeof navigationSpy>) => {
    const call = (navigation.setOptions as jest.Mock).mock.calls.find(
      ([options]) => options.unstable_headerRightItems,
    );

    return call[0].unstable_headerRightItems({ canGoBack: true });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockButtonProps.length = 0;
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    // An offer for any trigger it is given: no card then proves the screen
    // asked for none.
    mockUseReminderOffer.mockReset();
    mockUseReminderOffer.mockImplementation(({ trigger }: { trigger?: string }) =>
      trigger === undefined ? undefined : { kind: 'add_transactions', dismiss: mockDismiss },
    );
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it.each(kinds)('titles a %s account with its localized default name', async (kind, english) => {
    setLiveData({ accounts: [implicitAccount(kind)], holdings: [] });

    const { navigation } = await renderScreen();

    expect(navigation.setOptions).toHaveBeenCalledWith(expect.objectContaining({ title: english }));
  });

  it.each(kinds)(
    'titles a %s account in Ukrainian, though the stored name is the English sentinel',
    async (kind, _english, ukrainian) => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
      setLiveData({ accounts: [implicitAccount(kind)], holdings: [] });

      const { navigation } = await renderScreen(
        asRouteProp<AccountDetailProps['route']>('AccountDetail', {
          accountId: 'a',
          name: ukrainian,
        }),
      );
      const titles = (navigation.setOptions as jest.Mock).mock.calls.map(
        ([options]) => options.title,
      );

      expect(titles).toContain(ukrainian);
      expect(titles).not.toContain('Properties');
      expect(titles).not.toContain('Loans');
    },
  );

  it('titles a renamed implicit account with the name the user typed', async () => {
    setLiveData({ accounts: [implicitAccount('property', { name: 'Real estate' })], holdings: [] });

    const { navigation } = await renderScreen();

    expect(navigation.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Real estate' }),
    );
  });

  it('shows the route name as the title until the account has loaded', async () => {
    setLiveData({ accounts: [], accountsIsLoading: true, holdings: [] });

    const { navigation } = await renderScreen(
      asRouteProp<AccountDetailProps['route']>('AccountDetail', { accountId: 'a', name: 'Майно' }),
    );

    expect(navigation.setOptions).toHaveBeenCalledWith(expect.objectContaining({ title: 'Майно' }));
  });

  it.each(kinds)('has no Reminders bell on a %s account, only the Edit pencil', async (kind) => {
    setLiveData({ accounts: [implicitAccount(kind)], holdings: [] });

    const { navigation } = await renderScreen();
    const items = headerItems(navigation);

    expect(items.map((item: { icon: { name: string } }) => item.icon.name)).toEqual(['pencil']);
    expect(items.some((item: { label: string }) => item.label === 'Reminders')).toBe(false);

    items[0].onPress();

    expect(navigation.navigate).toHaveBeenCalledWith('AccountForm', { accountId: 'a' });
    expect(navigation.navigate).not.toHaveBeenCalledWith('AccountReminders', expect.anything());
  });

  // Before the account row loads, the route's kind hint is all the screen
  // knows: the bell must never show for a hinted implicit kind, even on the
  // first render, or it would flash and a tap in that window would open the
  // reminders of an account that takes none.
  describe('before the account row has loaded', () => {
    const hinted = (kind?: Account['kind']) =>
      asRouteProp<AccountDetailProps['route']>('AccountDetail', {
        accountId: 'a',
        name: 'Hinted',
        kind,
      });

    const everyHeaderItemSet = (navigation: ReturnType<typeof navigationSpy>) =>
      (navigation.setOptions as jest.Mock).mock.calls
        .filter(([options]) => options.unstable_headerRightItems)
        .map(([options]) =>
          options
            .unstable_headerRightItems({ canGoBack: true })
            .map((item: { icon: { name: string } }) => item.icon.name),
        );

    it.each(kinds)('never builds the bell when the hint says %s', async (kind) => {
      setLiveData({ accounts: [], accountsIsLoading: true, holdings: [] });

      const { navigation } = await renderScreen(hinted(kind));
      const itemSets = everyHeaderItemSet(navigation);

      expect(itemSets.length).toBeGreaterThan(0);
      expect(itemSets).toEqual(itemSets.map(() => ['pencil']));
    });

    it('builds the bell when the hint says bank', async () => {
      setLiveData({ accounts: [], accountsIsLoading: true, holdings: [] });

      const { navigation } = await renderScreen(hinted('bank'));

      expect(everyHeaderItemSet(navigation).at(0)).toEqual(['bell', 'pencil']);
    });

    it('builds no bell when there is no hint either, and adds it once the account loads', async () => {
      setLiveData({ accounts: [], accountsIsLoading: true, holdings: [] });

      const { navigation, rerender } = await renderScreen(hinted());
      const before = everyHeaderItemSet(navigation);

      expect(before.length).toBeGreaterThan(0);
      expect(before).toEqual(before.map(() => ['pencil']));

      setLiveData({ accounts: [account({ kind: 'cash' })], holdings: [] });
      await rerender(
        <AccountDetailScreen
          route={hinted()}
          navigation={asNavigationProp<AccountDetailProps['navigation']>(navigation)}
        />,
      );

      expect(everyHeaderItemSet(navigation).at(-1)).toEqual(['bell', 'pencil']);
    });

    it('lets the loaded account override the hint, both ways', async () => {
      setLiveData({ accounts: [implicitAccount('property')], holdings: [] });
      const implicitUnderBankHint = await renderScreen(hinted('bank'));

      expect(everyHeaderItemSet(implicitUnderBankHint.navigation).at(-1)).toEqual(['pencil']);

      setLiveData({ accounts: [account({ kind: 'cash' })], holdings: [] });
      const bankUnderImplicitHint = await renderScreen(hinted('property'));

      expect(everyHeaderItemSet(bankUnderImplicitHint.navigation).at(-1)).toEqual([
        'bell',
        'pencil',
      ]);
    });

    it('keeps the bell on an ARCHIVED implicit account whatever the hint says', async () => {
      setLiveData({ accounts: [implicitAccount('debt', { archivedAt: 5 })], holdings: [] });

      const { navigation } = await renderScreen(hinted('debt'));

      expect(everyHeaderItemSet(navigation).at(-1)).toEqual(['bell', 'pencil']);
    });
  });

  it('keeps the Reminders bell on an ARCHIVED property account, a plain account', async () => {
    setLiveData({
      accounts: [implicitAccount('property', { archivedAt: 5 })],
      holdings: [],
    });

    const { navigation } = await renderScreen();

    expect(
      headerItems(navigation).map((item: { icon: { name: string } }) => item.icon.name),
    ).toEqual(['bell', 'pencil']);
  });

  it.each(kinds)(
    'offers no reminder on a %s account, whatever the visit asks for',
    async (kind) => {
      setLiveData({ accounts: [implicitAccount(kind)], holdings: [] });

      const manual = await renderScreen();

      expect(manual.queryByTestId('reminder-offer')).toBeNull();
      expect(mockUseReminderOffer).toHaveBeenLastCalledWith(
        expect.objectContaining({ trigger: undefined }),
      );

      mockUseReminderOffer.mockClear();
      const afterImport = await renderScreen(
        asRouteProp<AccountDetailProps['route']>('AccountDetail', {
          accountId: 'a',
          name: 'Cash',
          reminderOffer: 'afterImport',
        }),
      );

      expect(afterImport.queryByTestId('reminder-offer')).toBeNull();
      expect(mockUseReminderOffer).toHaveBeenLastCalledWith(
        expect.objectContaining({ trigger: undefined }),
      );
    },
  );

  it('still asks for the offer on a non-implicit account (the gate is the implicit kind only)', async () => {
    setLiveData({ accounts: [account({ kind: 'cash' })], holdings: [] });

    const { getByTestId } = await renderScreen();

    expect(getByTestId('reminder-offer')).toBeTruthy();
    expect(mockUseReminderOffer).toHaveBeenLastCalledWith(
      expect.objectContaining({ trigger: 'manualActivity' }),
    );
  });

  it.each(kinds)(
    'opens the holding form for the account from Add holding on a %s account',
    async (kind) => {
      setLiveData({ accounts: [implicitAccount(kind)], holdings: [] });

      const { getByText, navigation } = await renderScreen();
      await fireEvent.press(getByText('Add holding'));

      expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', { accountId: 'a' });
    },
  );

  it.each(kinds)(
    'shows no statement import, sync, or crypto section on a %s account',
    async (kind) => {
      setLiveData({ accounts: [implicitAccount(kind)], holdings: [] });

      const { queryByText, queryByTestId } = await renderScreen();

      expect(queryByText('Import statement')).toBeNull();
      expect(queryByText(i18n.t('accountDetail.synchronization'))).toBeNull();
      expect(queryByTestId('crypto-sync-section')).toBeNull();
    },
  );

  it.each(kinds)(
    'lists the open holdings of a %s account and offers no account delete or archive',
    async (kind) => {
      setLiveData({
        accounts: [implicitAccount(kind)],
        holdings: [{ id: 'h1', name: 'Apartment', currency: 'UAH', balanceMinorUnits: 100 }],
      });

      const { getByText, queryByText, queryByLabelText } = await renderScreen();

      expect(getByText('Apartment')).toBeTruthy();
      expect(queryByText(/archive/i)).toBeNull();
      expect(queryByText(/delete account/i)).toBeNull();
      expect(queryByLabelText(/delete account|archive/i)).toBeNull();
    },
  );
});
