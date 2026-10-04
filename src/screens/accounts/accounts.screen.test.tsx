import type { ComponentProps } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { StyleSheet as UnistylesStyleSheet } from 'react-native-unistyles';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import {
  CLOSE_ACTION_TEST_ID,
  DELETE_ACTION_TEST_ID,
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import { accountKindSymbol } from '@kiko/holdings/entity-symbols';
import { entityIconTileGradient } from '@kiko/design-system/entity-tint';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { glyphNamesWithin } from '@kiko/test-support/glyph-names-within';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';
import { dropCard, type LiftableGrid, liftCard } from '@kiko/test-support/lift-grid-card';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import AccountsScreen from './accounts.screen';

type AccountsProps = ComponentProps<typeof AccountsScreen>;

// 2024-01-01 (leap year) — anchor date for the recapitalizing-deposit case.
const START = Date.UTC(2024, 0, 1);

// The screen reads the floating tab-bar height from `react-native-bottom-tabs`
// to lift its footer clear of the bar. The real hook throws outside a native
// bottom-tab navigator scene (there is no `BottomTabBarHeightContext` here), so
// stub it with a deterministic height the clearance test can assert against.
const MOCK_TAB_BAR_HEIGHT = 80;
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => MOCK_TAB_BAR_HEIGHT,
}));

// The active-tab re-tap → scroll-to-top hook reads the navigation context, which
// a standalone screen render lacks; stand it in with a spy so this test can
// assert the screen hands it its scroll view's ref (the same animated ref the
// grid auto-scrolls off).
const mockUseScrollToTopOnTabPress = jest.fn();
jest.mock('@kiko/navigation/use-scroll-to-top-on-tab-press', () => ({
  useScrollToTopOnTabPress: (ref: unknown, scrollOffset: unknown) =>
    mockUseScrollToTopOnTabPress(ref, scrollOffset),
}));

// useFocusRefreshedNow also reads the navigation context (useFocusEffect) via
// the same real-context requirement as the hook above; stand it in the same
// way statistics.screen.test.tsx does — a `Date.now()` taken once at mount
// and held STABLE across re-renders (no focus event fires in a standalone
// screen render), so a re-render test can prove the screen no longer reads
// its own fresh `Date.now()` per render.
jest.mock('@kiko/design-system/use-focus-refreshed-now/use-focus-refreshed-now', () => {
  const { useState } = jest.requireActual('react');

  return { useFocusRefreshedNow: () => useState(() => Date.now())[0] };
});

const mockUseIsFocused = jest.fn(() => true);
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => mockUseIsFocused(),
}));

const mockUseLiveQuery = jest.fn();
const mockAccountRemove = jest.fn();
const mockAccountReorder = jest.fn();
const mockHoldingRemove = jest.fn();
const mockHoldingReorder = jest.fn();
const mockHoldingCloseMany = jest.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
const mockSyncReminders = jest.fn().mockResolvedValue(undefined);

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: (...args: unknown[]) => mockSyncReminders(...args),
  drainReminderResponses: async () => [],
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    remove: (...args: unknown[]) => mockAccountRemove(...args),
    reorder: (...args: unknown[]) => mockAccountReorder(...args),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    remove: (...args: unknown[]) => mockHoldingRemove(...args),
    reorder: (...args: unknown[]) => mockHoldingReorder(...args),
    closeMany: (...args: unknown[]) => mockHoldingCloseMany(...args),
    balanceOf: (row: { currency: string; balanceMinorUnits: number }) => ({
      currency: row.currency,
      minorUnits: row.balanceMinorUnits,
    }),
  },
}));
jest.mock('@kiko/rates/repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

type Account = {
  id: string;
  name: string;
  kind: string;
  institution?: string | null;
  archivedAt?: number | null;
  icon?: string | null;
  color?: string | null;
};
type Holding = {
  id?: string;
  name?: string;
  icon?: string | null;
  color?: string | null;
  accountId: string;
  currency: string;
  balanceMinorUnits: number;
  type?: string;
  metadata?: unknown;
  closedAt?: number | null;
};
type Rate = { base: string; quote: string; rate: string };
type Settings = { baseCurrency: string };

/**
 * Drive the four `useLiveQuery` calls by the table they subscribe to, so the
 * mock survives re-renders (a sequential once-chain returns undefined after the
 * first render and crashes on the next).
 */
const setLiveData = (data: {
  accounts?: Account[];
  holdings?: Holding[];
  rates?: Rate[];
  settings?: Settings[];
  // Per-table isLoading overrides, for the loading-gate tests only — every
  // key defaults to `false` (an already-resolved query), so every existing
  // call site above keeps behaving exactly as before.
  isLoading?: Partial<Record<string, boolean>>;
  // Per-table "still the cached rows" overrides (`isFresh: false`), for the
  // reorder-gate tests only — every key defaults to fresh.
  isStale?: Partial<Record<string, boolean>>;
}): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
    currency_rates: data.rates ?? [],
    settings: data.settings ?? [{ baseCurrency: 'UAH' }],
    price_points: [],
  };
  const isLoadingByTable = data.isLoading ?? {};
  const isStaleByTable = data.isStale ?? {};

  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
    isLoading: isLoadingByTable[tables[0]] ?? false,
    isFresh: !(isStaleByTable[tables[0]] ?? false),
  }));
};

// A loan freshly started "now" (this test's own `Date.now()`, captured just
// before render): no scheduled installment is due yet, so the outstanding
// balance is deterministically the FULL principal — the loan's own held value
// (`holding-value.ts`) is exactly `-principal`, never a computed partial payoff
// this test would have to reproduce. THE implicit debt account: its stored name
// is only the sentinel, and the section lists its loans one card each, never
// the account itself.
const debtAccount = (over: Partial<Account> = {}): Account => ({
  id: 'd',
  name: 'Loans',
  kind: 'debt',
  archivedAt: null,
  ...over,
});
const loanHolding = (over: Partial<Holding> = {}): Holding => ({
  id: 'l1',
  name: 'Mortgage',
  icon: null,
  color: null,
  accountId: 'd',
  currency: 'UAH',
  balanceMinorUnits: 0,
  type: 'loan',
  metadata: {
    kind: 'mortgage',
    principalMinorUnits: 500_000, // 5,000.00 UAH
    startDate: Date.now(),
    annualRatePct: 10,
    termMonths: 120,
    schedule: 'annuity',
  },
  ...over,
});

// No price point is mocked anywhere in this file (`price_points` always
// resolves empty — see `setLiveData`), so a `property_item`'s value falls back
// to its lot's own cost basis (`priced-parts.ts`'s `pricedValueOrNull` -> null
// -> `costBasisMinorAt`) rather than needing a real priced instrument —
// 500_000 minor UAH -> 5,000.00 ₴.
const propertyAccount = (over: Partial<Account> = {}): Account => ({
  id: 'p',
  name: 'Properties',
  kind: 'property',
  archivedAt: null,
  ...over,
});
const propertyHolding = (over: Partial<Holding> = {}): Holding => ({
  id: 'h1',
  name: 'Apartment',
  icon: null,
  color: null,
  accountId: 'p',
  currency: 'UAH',
  balanceMinorUnits: 0,
  type: 'property_item',
  metadata: {
    category: 'real_estate',
    lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 500_000 }],
  },
  ...over,
});

const navigation = navigationSpy();

const renderAccounts = (): ReturnType<typeof render> =>
  render(
    <AccountsScreen
      navigation={asNavigationProp<AccountsProps['navigation']>(navigation)}
      route={asRouteProp<AccountsProps['route']>('Accounts')}
    />,
    { wrapper: GestureRootWrapper },
  );

describe('AccountsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({
      accounts: [
        { id: 'a', name: 'Monobank', kind: 'bank' },
        { id: 'b', name: 'Old Cash', kind: 'cash', archivedAt: 123 },
      ],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100000 }],
      rates: [],
      settings: [{ baseCurrency: 'UAH' }],
    });
  });

  it('wires its scroll view to scroll to top on an active-tab re-tap', async () => {
    // Spy on the animated-ref factory so we can prove the ref handed to the
    // scroll-to-top hook is one the screen actually created — i.e. the shared
    // ScrollView ref, the same one the sortable grid auto-scrolls off — rather
    // than any stray object.
    const reanimated = require('react-native-reanimated') as {
      useAnimatedRef: () => unknown;
    };
    const animatedRefSpy = jest.spyOn(reanimated, 'useAnimatedRef');

    await renderAccounts();

    expect(mockUseScrollToTopOnTabPress).toHaveBeenCalled();
    const createdRefs = animatedRefSpy.mock.results.map((result) => result.value);
    const hookRef = mockUseScrollToTopOnTabPress.mock.calls.at(-1)?.[0];
    expect(createdRefs).toContain(hookRef);

    animatedRefSpy.mockRestore();
  });

  it('hands the hook the live scroll offset of that same scroll view', async () => {
    // The hook skips its scroll when the content is already at the top, which it
    // can only decide from the live `contentOffset.y` of the scroll view it
    // would scroll — so the offset must be derived from the SAME ref the hook
    // receives, not from some other scrollable.
    const reanimated = require('react-native-reanimated') as {
      useScrollOffset: (ref: unknown) => unknown;
    };
    const offsetSpy = jest.spyOn(reanimated, 'useScrollOffset');

    await renderAccounts();

    const lastCall = mockUseScrollToTopOnTabPress.mock.calls.at(-1);
    expect(offsetSpy).toHaveBeenCalledWith(lastCall?.[0]);
    expect(lastCall?.[1]).toBe(offsetSpy.mock.results.at(-1)?.value);

    offsetSpy.mockRestore();
  });

  it('renders an active account with its name and balance', async () => {
    const { getByText } = await renderAccounts();
    expect(getByText('Monobank')).toBeTruthy();
    expect(getByText(/1,000\.00 ₴/)).toBeTruthy();
  });

  // A long name must wrap, not run past the card edge and push the balance out
  // of view. Jest cannot lay out pixels, so this pins the style contract the
  // transaction card wraps with.
  it('wraps a long account name beside the icon while the balance keeps its own width', async () => {
    const longName = 'Спільний рахунок для сімейних заощаджень та поточних витрат';
    setLiveData({
      accounts: [{ id: 'a', name: longName, kind: 'bank' }],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
    const { getByText } = await renderAccounts();
    const title = getByText(longName);
    const titleBox = StyleSheet.flatten(ancestorWithStyle(title, 'flex').props.style);

    expect(title.props.numberOfLines).toBeUndefined();
    expect(titleBox.flex).toBe(1);
    expect(titleBox.flexDirection).toBeUndefined();
    expect(
      StyleSheet.flatten(ancestorWithStyle(getByText(/1,000\.00 ₴/), 'flexShrink').props.style)
        .flexShrink,
    ).toBe(0);
    const leadBox = StyleSheet.flatten(ancestorWithStyle(title, 'alignItems').props.style);
    expect(leadBox.flex).toBe(1);
    // A short name still centers beside the icon tile, as before.
    expect(leadBox.alignItems).toBe('center');
  });

  it('does not render an archived account', async () => {
    const { queryByText } = await renderAccounts();
    expect(queryByText('Old Cash')).toBeNull();
  });

  it('navigates to AccountDetail when a row is pressed', async () => {
    const { getByText } = await renderAccounts();
    await fireEvent.press(getByText('Monobank'));
    // The account's name rides along so the detail screen's large title (and any
    // back button pushed from it) reads immediately, before its own live query.
    expect(navigation.navigate).toHaveBeenCalledWith('AccountDetail', {
      accountId: 'a',
      name: 'Monobank',
    });
  });

  it('navigates to AccountForm when "Add account" is pressed', async () => {
    const { getByText } = await renderAccounts();
    await fireEvent.press(getByText('Add account'));
    expect(navigation.navigate).toHaveBeenCalledWith('AccountForm', {});
  });

  it('renders "Add account" in the pinned footer, not inside the scrolled list', async () => {
    const { getByTestId } = await renderAccounts();
    const scrollView = getByTestId('screen-scroll-view');
    const footer = getByTestId('screen-footer');

    expect(within(scrollView).queryByText('Add account')).toBeNull();
    expect(within(footer).queryByText('Add account')).toBeTruthy();
  });

  it('leads "Add account" with the generic account glyph', async () => {
    const { getByTestId } = await renderAccounts();

    const glyphs = getByTestId('add-account-footer').queryAll((node) => node.props.name === 'tray');

    expect(glyphs.length).toBeGreaterThan(0);
  });

  it('clears the floating tab bar through the shared Screen footer, not a per-button margin', async () => {
    const { getByTestId } = await renderAccounts();
    const footerStyle = StyleSheet.flatten(getByTestId('screen-footer').props.style);
    const buttonBoxStyle = StyleSheet.flatten(getByTestId('add-account-footer').props.style);

    // Clearance now lives on the Screen footer: its breathing-room gap now
    // MATCHES the footer button's own top margin (spacing(4) = 16) so the button
    // sits symmetrically, plus the mocked tab-bar height (the safe-area mock
    // reports a 0 bottom inset).
    expect(footerStyle.paddingBottom).toBe(16 + MOCK_TAB_BAR_HEIGHT);
    // The button box must not re-add its own clearance, or the footer would be
    // double-padded.
    expect(buttonBoxStyle.marginBottom).toBeUndefined();
  });

  it('renders each account in its own card, not one shared surface', async () => {
    setLiveData({
      accounts: [
        { id: 'a', name: 'Monobank', kind: 'bank' },
        { id: 'c', name: 'Privat', kind: 'bank' },
      ],
      holdings: [],
      rates: [],
      settings: [{ baseCurrency: 'UAH' }],
    });
    const { getAllByTestId } = await renderAccounts();

    // Each account maps to its own Card (testID `account-card`),
    // so two active accounts yield two distinct cards rather than one group.
    expect(getAllByTestId('account-card')).toHaveLength(2);
  });

  it('renders an empty state when there are no active accounts', async () => {
    setLiveData({
      accounts: [{ id: 'b', name: 'Old Cash', kind: 'cash', archivedAt: 123 }],
      holdings: [],
      rates: [],
      settings: [{ baseCurrency: 'UAH' }],
    });
    const { getByText } = await renderAccounts();
    expect(getByText('No accounts yet')).toBeTruthy();
  });

  it('deletes a manual account via the themed deep-press delete confirm', async () => {
    setLiveData({ accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }], holdings: [] });
    const { getByTestId, getByText } = await renderAccounts();
    // The manual card is wrapped in the deep-press long-press. A hold that stays
    // still opens the themed ConfirmSheet (not a native ActionSheetIOS); pressing
    // its destructive confirm removes the account.
    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });
    expect(getByText('Delete "Cash"')).toBeTruthy();
    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));
    expect(mockAccountRemove).toHaveBeenCalledWith('a');
  });

  describe('deleting an account with reminders', () => {
    const deleteCash = async (): Promise<void> => {
      setLiveData({ accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }], holdings: [] });
      const { getByTestId } = await renderAccounts();

      await act(async () => {
        fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
          { state: State.BEGAN },
          { state: State.ACTIVE },
          { state: State.END },
        ]);
      });
      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));
    };

    it('re-plans after the delete, so the account’s pending reminders are removed', async () => {
      mockAccountRemove.mockResolvedValueOnce(undefined);

      await deleteCash();

      await waitFor(() => expect(mockSyncReminders).toHaveBeenCalledTimes(1));
      expect(mockAccountRemove.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncReminders.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('shows the save-error alert and re-plans nothing when the delete fails', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      mockAccountRemove.mockRejectedValueOnce(new Error('database is locked'));

      await deleteCash();

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
      );
      expect(mockSyncReminders).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });
  });

  it('opens the account (does not delete) on a plain tap of the card', async () => {
    setLiveData({ accounts: [{ id: 'a', name: 'Wallet', kind: 'cash' }], holdings: [] });
    const { getByText } = await renderAccounts();
    // A tap reaches the card's own Pressable and navigates, without touching the
    // context menu — the menu only opens on touch-and-hold.
    await fireEvent.press(getByText('Wallet'));
    expect(navigation.navigate).toHaveBeenCalledWith('AccountDetail', {
      accountId: 'a',
      name: 'Wallet',
    });
    expect(mockAccountRemove).not.toHaveBeenCalled();
  });

  it('wires an auto-scroll ref and an edge activation offset to the grid', async () => {
    setLiveData({
      accounts: [
        { id: 'a', name: 'Monobank', kind: 'bank' },
        { id: 'c', name: 'Privat', kind: 'bank' },
      ],
      holdings: [],
    });
    const { getByTestId } = await renderAccounts();
    const grid = getByTestId('sortable-grid');
    // The grid receives the parent scroll view's animated ref plus a positive
    // edge offset, so a drag near the top/bottom edge auto-scrolls the list.
    expect(grid.props.scrollableRef).toBeDefined();
    expect(grid.props.autoScrollActivationOffset).toBeGreaterThan(0);
  });

  // kiko-architecture: a cached display mount shows rows that can be one read
  // old. A drag persists the WHOLE account order from the rows on screen, so
  // it must never start from the cached order — an account added or removed
  // elsewhere while this screen was closed would be dropped from (or
  // resurrected into) the persisted order.
  it('never lets a drag reorder start while the accounts are still the cached order', async () => {
    setLiveData({
      accounts: [
        { id: 'a', name: 'Monobank', kind: 'bank' },
        { id: 'c', name: 'Privat', kind: 'bank' },
      ],
      isStale: { accounts: true },
    });
    const { getByTestId } = await renderAccounts();

    expect(getByTestId('sortable-grid').props.sortEnabled).toBe(false);
  });

  it('lets a drag reorder start once the accounts have their own fresh read', async () => {
    setLiveData({
      accounts: [
        { id: 'a', name: 'Monobank', kind: 'bank' },
        { id: 'c', name: 'Privat', kind: 'bank' },
      ],
    });
    const { getByTestId } = await renderAccounts();

    expect(getByTestId('sortable-grid').props.sortEnabled).toBe(true);
  });

  // A hold lifts the card; with one card there is nothing to reorder, it lifts
  // and drops back, so the lone card feels the same as one among many.
  it('lets a lone account card lift on a hold once the accounts have their own fresh read', async () => {
    setLiveData({ accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }] });
    const { getByTestId } = await renderAccounts();

    expect(getByTestId('sortable-grid').props.sortEnabled).toBe(true);
  });

  it('keeps a lone account card from lifting while the accounts are still the cached order', async () => {
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      isStale: { accounts: true },
    });
    const { getByTestId } = await renderAccounts();

    expect(getByTestId('sortable-grid').props.sortEnabled).toBe(false);
  });

  it('does not open the account when a hold lifted its card and the finger ends in place', async () => {
    const { getByTestId, getByText } = await renderAccounts();

    await liftCard(getByTestId('sortable-grid'), 'a');
    await fireEvent.press(getByText('Monobank'));

    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('opens the account on the next quick tap after a lifted release', async () => {
    const { getByTestId, getByText } = await renderAccounts();

    await liftCard(getByTestId('sortable-grid'), 'a');
    await fireEvent.press(getByText('Monobank'));
    await fireEvent.press(getByText('Monobank'));

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith('AccountDetail', {
      accountId: 'a',
      name: 'Monobank',
    });
  });

  it('opens the account on a quick tap after the lifted card was dropped with no press', async () => {
    const { getByTestId, getByText } = await renderAccounts();

    await liftCard(getByTestId('sortable-grid'), 'a');
    await dropCard(getByTestId('sortable-grid'), 'a');
    await fireEvent.press(getByText('Monobank'));

    expect(navigation.navigate).toHaveBeenCalledWith('AccountDetail', {
      accountId: 'a',
      name: 'Monobank',
    });
  });

  it('persists a reorder to accountsRepo.reorder when a card is dragged to a new slot', async () => {
    setLiveData({
      accounts: [
        { id: 'a', name: 'Monobank', kind: 'bank' },
        { id: 'c', name: 'Privat', kind: 'bank' },
      ],
      holdings: [],
    });
    const { getByTestId } = await renderAccounts();
    // A drag that moved (fromIndex !== toIndex) persists the new front-to-back
    // order (indexToKey) rather than opening the menu.
    await act(async () => {
      getByTestId('sortable-grid').props.onDragEnd({
        key: 'c',
        fromIndex: 1,
        toIndex: 0,
        indexToKey: ['c', 'a'],
      });
    });
    expect(mockAccountReorder).toHaveBeenCalledWith(['c', 'a']);
  });

  it('renders no context menu on a still-connected (monobank) account', async () => {
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank', institution: 'monobank' }],
      holdings: [],
    });
    const { queryByTestId } = await renderAccounts();
    // A connected account must be disconnected (from account-detail) before it
    // can be deleted, so its card renders bare with no native context menu.
    expect(queryByTestId('card-context-menu')).toBeNull();
  });

  it('shows the account icon as a display-only glyph, not an editable icon control', async () => {
    setLiveData({ accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }], holdings: [] });
    const { getByLabelText, queryByLabelText } = await renderAccounts();
    // The row renders a plain, non-editable icon (icon editing moved to
    // AccountDetail), so its glyph is present but the "Change … icon" picker
    // affordance is gone.
    expect(getByLabelText('Cash icon')).toBeTruthy();
    expect(queryByLabelText('Change Cash icon')).toBeNull();
  });

  // The squircle-gradient icon tile is the permanent treatment (see
  // `EntityIconTile`): the account's color drives the icon TILE's gradient
  // fill (never the raw glyph tint, which is the fixed legible `onAccent`
  // white), and the card itself is a plain neutral surface instead of an
  // entity-colored wash. See holding-card.component.test.tsx for the
  // identical pair of tests on the holding card.
  it('tints the account icon glyph with the legible onAccent token, not the raw entity color', async () => {
    setLiveData({
      accounts: [
        { id: 'a', name: 'Cash', kind: 'cash', color: darkTheme.colors.entityColors.blue },
      ],
      holdings: [],
    });
    const { getByLabelText } = await renderAccounts();

    expect(getByLabelText('Cash icon').props.tintColor).toBe(darkTheme.colors.onAccent);
  });

  it("derives the icon tile's gradient from the account's stored color", async () => {
    setLiveData({
      accounts: [
        { id: 'a', name: 'Cash', kind: 'cash', color: darkTheme.colors.entityColors.blue },
      ],
      holdings: [],
    });
    const { getByTestId } = await renderAccounts();

    const [top, bottom] = entityIconTileGradient(darkTheme.colors.entityColors.blue);
    expect(getByTestId('entity-icon-tile-gradient-stop-top').props.stopColor).toBe(top);
    expect(getByTestId('entity-icon-tile-gradient-stop-bottom').props.stopColor).toBe(bottom);
  });

  it("derives the icon tile's gradient from the kind default when the account has no stored color", async () => {
    setLiveData({ accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }], holdings: [] });
    const { getByTestId } = await renderAccounts();

    // A `cash` account with no color reads the cash kind default (khaki).
    const [top, bottom] = entityIconTileGradient(darkTheme.colors.entityColors.khaki);
    expect(getByTestId('entity-icon-tile-gradient-stop-top').props.stopColor).toBe(top);
    expect(getByTestId('entity-icon-tile-gradient-stop-bottom').props.stopColor).toBe(bottom);
  });

  it("derives the icon tile's gradient from the kind default when the stored color is an empty string", async () => {
    setLiveData({ accounts: [{ id: 'a', name: 'Cash', kind: 'cash', color: '' }], holdings: [] });
    const { getByTestId } = await renderAccounts();

    const [top, bottom] = entityIconTileGradient(darkTheme.colors.entityColors.khaki);
    expect(getByTestId('entity-icon-tile-gradient-stop-top').props.stopColor).toBe(top);
    expect(getByTestId('entity-icon-tile-gradient-stop-bottom').props.stopColor).toBe(bottom);
  });

  it('shows the stored account icon, and the kind glyph when the stored icon is null', async () => {
    setLiveData({
      accounts: [
        { id: 'a', name: 'Cash', kind: 'cash', icon: null },
        { id: 'b', name: 'Card', kind: 'bank', icon: 'creditcard' },
      ],
      holdings: [],
    });
    const { getByLabelText } = await renderAccounts();

    expect(getByLabelText('Cash icon').props.name).toBe(accountKindSymbol.cash);
    expect(getByLabelText('Card icon').props.name).toBe('creditcard');
  });

  it('leaves the account card itself the shared solid surface, not an entity-color wash', async () => {
    setLiveData({
      accounts: [
        { id: 'a', name: 'Cash', kind: 'cash', color: darkTheme.colors.entityColors.blue },
      ],
      holdings: [],
    });
    const { getByTestId } = await renderAccounts();

    // The color lives on the icon tile only (see the tests above) — the card
    // itself is the shared solid content-layer `Card`: a flat `surface` fill
    // applied directly to its own node (no separate base/wash sub-layer the
    // way `GlassSurface` used to render, and no colored wash at all).
    const flat = StyleSheet.flatten(getByTestId('account-card').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surface);
  });

  it('draws the shared hairline card border on first render', async () => {
    setLiveData({ accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }], holdings: [] });
    const { getByTestId } = await renderAccounts();

    const cardStyle = StyleSheet.flatten(getByTestId('account-card').props.style);
    expect(cardStyle.borderWidth).toBe(UnistylesStyleSheet.hairlineWidth);
    expect(cardStyle.borderColor).toBe(darkTheme.colors.border);
  });

  it('reflects term-deposit growth in total net worth (now is passed)', async () => {
    setLiveData({
      accounts: [{ id: 'a', name: 'Deposit', kind: 'bank' }],
      holdings: [
        {
          accountId: 'a',
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
    const { getByText, queryByText } = await renderAccounts();
    // Recapitalized to maturity: 100000 * 1.10 = 110000 gross, less 23% tax on
    // the 10000 interest (2300) = 107700 net -> 1,077.00 ₴. Without `now` the
    // deposit value would be NaN and never render the grown figure.
    expect(getByText(/1,077\.00 ₴/)).toBeTruthy();
    expect(queryByText(/1,000\.00 ₴/)).toBeNull();
  });

  describe('Debts section', () => {
    it('renders no Debts section when there is no debt account', async () => {
      const { queryByTestId } = await renderAccounts();
      expect(queryByTestId('accounts-debts-heading')).toBeNull();
    });

    it('renders a Debts section with one holding card per open loan, its total negative', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }, debtAccount()],
        holdings: [
          { accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 },
          loanHolding(),
          loanHolding({ id: 'l2', name: 'Car loan' }),
          loanHolding({ id: 'l3', name: 'Paid off', closedAt: 1_700_000_000_000 }),
        ],
      });

      const { getByText, queryByText, getAllByTestId, getByTestId } = await renderAccounts();

      expect(within(getByTestId('accounts-debts-heading')).getByText('Loans')).toBeTruthy();
      expect(getByText('Mortgage')).toBeTruthy();
      expect(getByText('Car loan')).toBeTruthy();
      // The closed loan is excluded, and the implicit account itself never
      // renders as a card: one account card (Monobank), two loan cards.
      expect(queryByText('Paid off')).toBeNull();
      expect(getAllByTestId('holding-card')).toHaveLength(2);
      expect(getAllByTestId('account-card')).toHaveLength(1);
    });

    // The Debts section shows a SECTION total
    // (negative), not only each card's own negative balance.
    it('shows a Debts section total next to the heading, summing every open loan', async () => {
      setLiveData({
        accounts: [debtAccount()],
        holdings: [loanHolding(), loanHolding({ id: 'l2', name: 'Car loan' })],
      });

      const { getByTestId } = await renderAccounts();

      // Two loans, each -5,000.00 UAH (full principal, no installment due
      // yet) -> section total -10,000.00 UAH.
      expect(within(getByTestId('accounts-debts-total')).getByText(/-10,000\.00 ₴/)).toBeTruthy();
    });

    it('keeps the loans out of the main grid, in their own section grid', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }, debtAccount()],
        holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 }, loanHolding()],
      });

      const { getByTestId } = await renderAccounts();

      // Both grids default to the mocked `sortable-grid` testID (there is no
      // typed way to override it — `Sortable.Grid`'s props carry no `testID`),
      // so each grid is scoped by its own wrapping Box instead.
      const mainGrid = within(getByTestId('accounts-grid')).getByTestId('sortable-grid');
      expect(within(mainGrid).queryByText('Mortgage')).toBeNull();
      const debtsGrid = within(getByTestId('accounts-debts-grid')).getByTestId('sortable-grid');
      expect(within(debtsGrid).getByText('Mortgage')).toBeTruthy();
    });

    it('opens the holding detail, never an account detail, when a loan card is tapped', async () => {
      setLiveData({ accounts: [debtAccount()], holdings: [loanHolding()] });

      const { getByText } = await renderAccounts();
      await fireEvent.press(getByText('Mortgage'));

      expect(navigation.navigate).toHaveBeenCalledWith('HoldingDetail', {
        holdingId: 'l1',
        name: 'Mortgage',
      });
      expect(navigation.navigate).not.toHaveBeenCalledWith('AccountDetail', expect.anything());
    });

    // A Debts-grid drag persists the implicit debt account's open loans only,
    // the same contract the account-detail grid has.
    it("persists the section's own holding order when the Debts grid is reordered", async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }, debtAccount()],
        holdings: [loanHolding(), loanHolding({ id: 'l2', name: 'Car loan' })],
      });

      const { getByTestId } = await renderAccounts();
      const debtsGrid = within(getByTestId('accounts-debts-grid')).getByTestId('sortable-grid');

      await act(async () => {
        debtsGrid.props.onDragEnd({
          key: 'l2',
          fromIndex: 1,
          toIndex: 0,
          indexToKey: ['l2', 'l1'],
        });
      });

      expect(mockHoldingReorder).toHaveBeenCalledWith(['l2', 'l1']);
      expect(mockAccountReorder).not.toHaveBeenCalled();
    });

    it('persists nothing when a loan card is held in place', async () => {
      setLiveData({
        accounts: [debtAccount()],
        holdings: [loanHolding(), loanHolding({ id: 'l2', name: 'Car loan' })],
      });

      const { getByTestId } = await renderAccounts();
      const debtsGrid = within(getByTestId('accounts-debts-grid')).getByTestId('sortable-grid');

      await act(async () => {
        debtsGrid.props.onDragEnd({
          key: 'l1',
          fromIndex: 0,
          toIndex: 0,
          indexToKey: ['l1', 'l2'],
        });
      });

      expect(mockHoldingReorder).not.toHaveBeenCalled();
    });

    it('keeps the grid tuning of the main grid on the Debts grid', async () => {
      setLiveData({
        accounts: [debtAccount()],
        holdings: [loanHolding(), loanHolding({ id: 'l2', name: 'Car loan' })],
      });

      const { getByTestId } = await renderAccounts();
      const { props } = within(getByTestId('accounts-debts-grid')).getByTestId('sortable-grid');

      expect(props.activeItemScale).toBe(1.03);
      expect(props.autoScrollActivationOffset).toBe(75);
      expect(props.overDrag).toBe('vertical');
      expect(props.columns).toBe(1);
      expect(props.scrollableRef).toBeDefined();
    });

    const debtsGridSortEnabled = async (): Promise<unknown> => {
      const { getByTestId } = await renderAccounts();

      return within(getByTestId('accounts-debts-grid')).getByTestId('sortable-grid').props
        .sortEnabled;
    };

    it('enables the sort with one loan once the holdings have their own fresh read, so the lone card lifts on a hold', async () => {
      setLiveData({ accounts: [debtAccount()], holdings: [loanHolding()] });

      expect(await debtsGridSortEnabled()).toBe(true);
    });

    it('keeps a lone loan from lifting while the holdings are still the cached read', async () => {
      setLiveData({
        accounts: [debtAccount()],
        holdings: [loanHolding()],
        isStale: { holdings: true },
      });

      expect(await debtsGridSortEnabled()).toBe(false);
    });

    it('disables the sort while the holdings are still the cached read', async () => {
      setLiveData({
        accounts: [debtAccount()],
        holdings: [loanHolding(), loanHolding({ id: 'l2', name: 'Car loan' })],
        isStale: { holdings: true },
      });

      expect(await debtsGridSortEnabled()).toBe(false);
    });

    it('enables the sort with two loans once the holdings have their own fresh read', async () => {
      setLiveData({
        accounts: [debtAccount()],
        holdings: [loanHolding(), loanHolding({ id: 'l2', name: 'Car loan' })],
      });

      expect(await debtsGridSortEnabled()).toBe(true);
    });

    // A hold on a loan card opens the shared action list: Close loan and Delete.
    describe('the long-press menu of a loan', () => {
      const holdCard = async (): Promise<void> => {
        await act(async () => {
          fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
            { state: State.BEGAN },
            { state: State.ACTIVE },
            { state: State.END },
          ]);
        });
      };

      it('offers Close loan and Delete, and Delete removes that holding', async () => {
        setLiveData({ accounts: [debtAccount()], holdings: [loanHolding()] });
        const { getByTestId, getByText } = await renderAccounts();

        await holdCard();

        expect(getByTestId(CLOSE_ACTION_TEST_ID)).toHaveTextContent('Close loan');
        await act(async () => {
          await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
        });
        expect(getByText('Delete "Mortgage"')).toBeTruthy();
        await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

        expect(mockHoldingRemove).toHaveBeenCalledWith('l1');
        expect(mockAccountRemove).not.toHaveBeenCalled();
      });

      // The Debts section owns its own close sheet: Close loan opens it, and
      // its confirm closes that holding (not a property one).
      it('closes the loan through the Debts close sheet', async () => {
        setLiveData({ accounts: [debtAccount()], holdings: [loanHolding()] });
        const { getByTestId, getByText } = await renderAccounts();

        await holdCard();
        await act(async () => {
          await fireEvent.press(getByTestId(CLOSE_ACTION_TEST_ID));
        });
        expect(getByText('Close Loan "Mortgage"')).toBeTruthy();
        await act(async () => {
          await fireEvent.press(getByTestId('close-holding-confirm'));
        });

        expect(mockHoldingCloseMany).toHaveBeenCalledWith(['l1']);
      });
    });

    // A closed loan is out of the section, so a debt account whose loans are
    // all closed leaves nothing to list.
    it('renders no Debts section when every loan is closed', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }, debtAccount()],
        holdings: [loanHolding({ closedAt: 1_700_000_000_000 })],
      });

      const { queryByTestId } = await renderAccounts();

      expect(queryByTestId('accounts-debts-heading')).toBeNull();
      expect(queryByTestId('accounts-debts-grid')).toBeNull();
    });

    it('renders no Debts section for an archived debt account', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }, debtAccount({ archivedAt: 123 })],
        holdings: [loanHolding()],
      });

      const { queryByText, queryByTestId } = await renderAccounts();

      expect(queryByTestId('accounts-debts-heading')).toBeNull();
      expect(queryByText('Mortgage')).toBeNull();
      expect(queryByTestId('holding-card')).toBeNull();
    });

    it('persists the FULL account order (main accounts, then property, then debt) when the main grid is reordered', async () => {
      setLiveData({
        accounts: [
          { id: 'a', name: 'Monobank', kind: 'bank' },
          { id: 'c', name: 'Privat', kind: 'bank' },
          { id: 'p', name: 'Properties', kind: 'property', archivedAt: null },
          debtAccount(),
        ],
        holdings: [loanHolding()],
      });

      const { getByTestId } = await renderAccounts();
      const mainGrid = within(getByTestId('accounts-grid')).getByTestId('sortable-grid');

      await act(async () => {
        mainGrid.props.onDragEnd({
          key: 'c',
          fromIndex: 1,
          toIndex: 0,
          indexToKey: ['c', 'a'],
        });
      });

      expect(mockAccountReorder).toHaveBeenCalledWith(['c', 'a', 'p', 'd']);
    });

    // `debtsTotal` used to depend on a bare `Date.now()` read fresh on every
    // function-component render, not the mounted screen's own stable `now`
    // — so it recomputed (and could drift) on every re-render, not just on
    // focus. A re-render with the real clock jumped forward (past another
    // installment boundary, so the loan's outstanding balance WOULD differ
    // if `now` had advanced) must still show the SAME total.
    it('keeps the Debts total stable across a re-render that is not a focus event', async () => {
      // Calendar months from the local date fields, not a fixed-millisecond
      // span, so the loan start and the jump land on the intended local days
      // whatever the wall-clock time and any DST change in between.
      const mountedAt = new Date();
      const localMonthsFromMount = (months: number): number =>
        new Date(
          mountedAt.getFullYear(),
          mountedAt.getMonth() + months,
          mountedAt.getDate(),
          mountedAt.getHours(),
          mountedAt.getMinutes(),
        ).getTime();
      let clock = mountedAt.getTime();
      jest.spyOn(Date, 'now').mockImplementation(() => clock);

      setLiveData({
        accounts: [debtAccount()],
        holdings: [
          loanHolding({
            metadata: {
              kind: 'mortgage',
              principalMinorUnits: 500_000,
              startDate: localMonthsFromMount(-3),
              annualRatePct: 10,
              termMonths: 120,
              schedule: 'annuity',
            },
          }),
        ],
      });

      // A fresh element each render, exactly like a real re-render (a parent
      // re-render, a sibling state update): reusing the SAME element
      // instance across `render`/`rerender` lets React bail out of calling
      // the component body a second time at all, which would make this
      // assertion pass for the wrong reason.
      const buildElement = () => (
        <AccountsScreen
          navigation={asNavigationProp<AccountsProps['navigation']>(navigation)}
          route={asRouteProp<AccountsProps['route']>('Accounts')}
        />
      );
      const { getByTestId, rerender } = await render(buildElement(), {
        wrapper: GestureRootWrapper,
      });
      const firstTotal = within(getByTestId('accounts-debts-total')).getByText(/₴/).props.children;

      clock = localMonthsFromMount(2);
      await act(async () => rerender(buildElement()));

      const secondTotal = within(getByTestId('accounts-debts-total')).getByText(/₴/).props.children;
      expect(secondTotal).toEqual(firstTotal);
    });
  });

  describe('Property section', () => {
    it('renders no Property section when there is no property account', async () => {
      const { queryByTestId } = await renderAccounts();
      expect(queryByTestId('accounts-property-heading')).toBeNull();
    });

    it('renders a Property section with one holding card per open property, and its own section total', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }, propertyAccount()],
        holdings: [
          { accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 },
          propertyHolding(),
          propertyHolding({ id: 'h2', name: 'Garage' }),
          propertyHolding({ id: 'h3', name: 'Sold flat', closedAt: 1_700_000_000_000 }),
        ],
      });

      const { getByText, queryByText, getAllByTestId, getByTestId } = await renderAccounts();

      expect(within(getByTestId('accounts-property-heading')).getByText('Properties')).toBeTruthy();
      expect(getByText('Apartment')).toBeTruthy();
      expect(getByText('Garage')).toBeTruthy();
      expect(queryByText('Sold flat')).toBeNull();
      expect(getAllByTestId('holding-card')).toHaveLength(2);
      expect(getAllByTestId('account-card')).toHaveLength(1);
      // Two open holdings at 5,000.00 each; the closed one does not count.
      expect(within(getByTestId('accounts-property-total')).getByText(/10,000\.00 ₴/)).toBeTruthy();
    });

    it('keeps the property holdings out of the main and Debts grids, in their own section grid', async () => {
      setLiveData({
        accounts: [
          { id: 'a', name: 'Monobank', kind: 'bank' },
          propertyAccount(),
          { id: 'd', name: 'Loans', kind: 'debt', archivedAt: null },
        ],
        holdings: [
          { accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 },
          propertyHolding(),
        ],
      });

      const { getByTestId, queryByTestId } = await renderAccounts();

      const mainGrid = within(getByTestId('accounts-grid')).getByTestId('sortable-grid');
      expect(within(mainGrid).queryByText('Apartment')).toBeNull();
      const propertyGrid = within(getByTestId('accounts-property-grid')).getByTestId(
        'sortable-grid',
      );
      expect(within(propertyGrid).getByText('Apartment')).toBeTruthy();
      // The debt account has no holding, so it has no section.
      expect(queryByTestId('accounts-debts-grid')).toBeNull();
    });

    it('opens the holding detail, never an account detail, when a property card is tapped', async () => {
      setLiveData({ accounts: [propertyAccount()], holdings: [propertyHolding()] });

      const { getByText } = await renderAccounts();
      await fireEvent.press(getByText('Apartment'));

      expect(navigation.navigate).toHaveBeenCalledWith('HoldingDetail', {
        holdingId: 'h1',
        name: 'Apartment',
      });
      expect(navigation.navigate).not.toHaveBeenCalledWith('AccountDetail', expect.anything());
    });

    // A Property-grid drag persists the implicit property account's open
    // holdings only; the accounts' own order is untouched.
    it("persists the section's own holding order when the Property grid is reordered", async () => {
      setLiveData({
        accounts: [
          { id: 'a', name: 'Monobank', kind: 'bank' },
          propertyAccount(),
          { id: 'd', name: 'Loans', kind: 'debt', archivedAt: null },
        ],
        holdings: [propertyHolding(), propertyHolding({ id: 'h2', name: 'Garage' })],
      });

      const { getByTestId } = await renderAccounts();
      const propertyGrid = within(getByTestId('accounts-property-grid')).getByTestId(
        'sortable-grid',
      );

      await act(async () => {
        propertyGrid.props.onDragEnd({
          key: 'h2',
          fromIndex: 1,
          toIndex: 0,
          indexToKey: ['h2', 'h1'],
        });
      });

      expect(mockHoldingReorder).toHaveBeenCalledWith(['h2', 'h1']);
      expect(mockAccountReorder).not.toHaveBeenCalled();
    });

    it('enables the sort with one property holding once the holdings have their own fresh read, so the lone card lifts on a hold', async () => {
      setLiveData({ accounts: [propertyAccount()], holdings: [propertyHolding()] });

      const { getByTestId } = await renderAccounts();

      expect(
        within(getByTestId('accounts-property-grid')).getByTestId('sortable-grid').props
          .sortEnabled,
      ).toBe(true);
    });

    it('keeps a lone property holding from lifting while the holdings are still the cached read', async () => {
      setLiveData({
        accounts: [propertyAccount()],
        holdings: [propertyHolding()],
        isStale: { holdings: true },
      });

      const { getByTestId } = await renderAccounts();

      expect(
        within(getByTestId('accounts-property-grid')).getByTestId('sortable-grid').props
          .sortEnabled,
      ).toBe(false);
    });

    // The Property section owns its own close sheet, separate from the Debts
    // one: each hook instance's sheet has to render, or Close opens nothing.
    it('closes a property holding through the Property close sheet', async () => {
      setLiveData({ accounts: [propertyAccount()], holdings: [propertyHolding()] });
      const { getByTestId, getByText } = await renderAccounts();

      await act(async () => {
        fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
          { state: State.BEGAN },
          { state: State.ACTIVE },
          { state: State.END },
        ]);
      });
      expect(getByTestId(CLOSE_ACTION_TEST_ID)).toHaveTextContent('Close holding');
      await act(async () => {
        await fireEvent.press(getByTestId(CLOSE_ACTION_TEST_ID));
      });
      expect(getByText('Close "Apartment"')).toBeTruthy();
      await act(async () => {
        await fireEvent.press(getByTestId('close-holding-confirm'));
      });

      expect(mockHoldingCloseMany).toHaveBeenCalledWith(['h1']);
    });

    // An implicit account whose last holding was deleted stays, so it must
    // read as "nothing here", with no empty section heading.
    it('shows the empty state, with no section heading, for an empty implicit account alone', async () => {
      setLiveData({
        accounts: [propertyAccount(), { id: 'd', name: 'Loans', kind: 'debt', archivedAt: null }],
        holdings: [],
      });

      const { getByText, queryByTestId } = await renderAccounts();

      expect(getByText('No accounts yet')).toBeTruthy();
      expect(queryByTestId('accounts-property-heading')).toBeNull();
      expect(queryByTestId('accounts-debts-heading')).toBeNull();
      expect(queryByTestId('accounts-property-grid')).toBeNull();
    });

    it('does not show the empty state once a property holding exists', async () => {
      setLiveData({ accounts: [propertyAccount()], holdings: [propertyHolding()] });

      const { queryByText } = await renderAccounts();

      expect(queryByText('No accounts yet')).toBeNull();
    });

    // An archived property account's holdings show nowhere, and the empty
    // state reads as if it were not there.
    it('shows an archived property account’s holdings nowhere', async () => {
      setLiveData({
        accounts: [propertyAccount({ archivedAt: 123 })],
        holdings: [propertyHolding()],
      });

      const { getByText, queryByText, queryByTestId } = await renderAccounts();

      expect(queryByText('Apartment')).toBeNull();
      expect(queryByTestId('accounts-property-heading')).toBeNull();
      expect(queryByTestId('holding-card')).toBeNull();
      expect(getByText('No accounts yet')).toBeTruthy();
    });
  });

  // The Debts and Property holding grids share one lift guard, so one table
  // drives both.
  describe.each([
    {
      kind: 'loan',
      gridTestId: 'accounts-debts-grid',
      holdingId: 'l1',
      holdingName: 'Mortgage',
      seed: () => setLiveData({ accounts: [debtAccount()], holdings: [loanHolding()] }),
    },
    {
      kind: 'property',
      gridTestId: 'accounts-property-grid',
      holdingId: 'h1',
      holdingName: 'Apartment',
      seed: () => setLiveData({ accounts: [propertyAccount()], holdings: [propertyHolding()] }),
    },
  ])('a hold that lifted a $kind card', ({ gridTestId, holdingId, holdingName, seed }) => {
    const renderGrid = async (): Promise<{
      grid: LiftableGrid;
      getByText: Awaited<ReturnType<typeof render>>['getByText'];
    }> => {
      seed();
      const { getByTestId, getByText } = await renderAccounts();

      return {
        grid: within(getByTestId(gridTestId)).getByTestId('sortable-grid'),
        getByText,
      };
    };

    it('does not open the holding when the finger ends in place', async () => {
      const { grid, getByText } = await renderGrid();

      await liftCard(grid, holdingId);
      await fireEvent.press(getByText(holdingName));

      expect(navigation.navigate).not.toHaveBeenCalled();
    });

    it('opens the holding on the next quick tap', async () => {
      const { grid, getByText } = await renderGrid();

      await liftCard(grid, holdingId);
      await fireEvent.press(getByText(holdingName));
      await fireEvent.press(getByText(holdingName));

      expect(navigation.navigate).toHaveBeenCalledTimes(1);
      expect(navigation.navigate).toHaveBeenCalledWith('HoldingDetail', {
        holdingId,
        name: holdingName,
      });
    });

    it('opens the holding on a quick tap once the card was dropped with no press', async () => {
      const { grid, getByText } = await renderGrid();

      await liftCard(grid, holdingId);
      await dropCard(grid, holdingId);
      await fireEvent.press(getByText(holdingName));

      expect(navigation.navigate).toHaveBeenCalledWith('HoldingDetail', {
        holdingId,
        name: holdingName,
      });
    });
  });

  // The Property and Debts sections are headed by the implicit account's own
  // display name and squircle tile, keyed by kind in the test ids.
  describe('implicit account section headings', () => {
    const bothSections = (over: { property?: Partial<Account>; debt?: Partial<Account> } = {}) =>
      setLiveData({
        accounts: [propertyAccount(over.property), debtAccount(over.debt)],
        holdings: [propertyHolding(), loanHolding()],
      });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it.each([
      ['en', 'Properties', 'Loans'],
      ['uk', 'Майно', 'Кредити'],
    ])(
      'heads the sections with the localized default names in %s',
      async (language, property, debt) => {
        await act(async () => {
          await i18n.changeLanguage(language);
        });
        bothSections();

        const { getByTestId } = await renderAccounts();

        expect(within(getByTestId('accounts-property-heading')).getByText(property)).toBeTruthy();
        expect(within(getByTestId('accounts-debts-heading')).getByText(debt)).toBeTruthy();
      },
    );

    it('never shows the old fixed Property or Debts text', async () => {
      bothSections();

      const { queryByText } = await renderAccounts();

      expect(queryByText('Property')).toBeNull();
      expect(queryByText('Debts')).toBeNull();
    });

    it('shows the typed name once an account is renamed, and follows the rename live', async () => {
      bothSections();
      const buildElement = () => (
        <AccountsScreen
          navigation={asNavigationProp<AccountsProps['navigation']>(navigation)}
          route={asRouteProp<AccountsProps['route']>('Accounts')}
        />
      );
      const { getByTestId, rerender } = await render(buildElement(), {
        wrapper: GestureRootWrapper,
      });

      bothSections({ property: { name: 'Real estate' }, debt: { name: 'Mortgages' } });
      await act(async () => rerender(buildElement()));

      expect(
        within(getByTestId('accounts-property-heading')).getByText('Real estate'),
      ).toBeTruthy();
      expect(within(getByTestId('accounts-debts-heading')).getByText('Mortgages')).toBeTruthy();
    });

    // A long name wraps beside the tile while the section total keeps its own
    // width; Jest cannot lay out pixels, so this pins the style contract.
    it('wraps a long name in the heading while the section total keeps its own width', async () => {
      const longName = 'Спільне майно для сімейних заощаджень та довгострокових вкладень';
      bothSections({ property: { name: longName } });

      const { getByTestId, getByText } = await renderAccounts();
      const heading = StyleSheet.flatten(getByTestId('accounts-property-heading').props.style);

      expect(getByText(longName).props.numberOfLines).toBeUndefined();
      expect(heading.flex).toBe(1);
      expect(
        StyleSheet.flatten(
          ancestorWithStyle(getByTestId('accounts-property-total'), 'flexShrink').props.style,
        ).flexShrink,
      ).toBe(0);
    });

    it("shows each account's squircle tile in its heading, in the account's own color", async () => {
      bothSections({ property: { color: darkTheme.colors.entityColors.blue } });

      const { getByTestId } = await renderAccounts();

      const property = within(getByTestId('accounts-property-heading'));
      expect(property.getByTestId('entity-icon-tile')).toBeTruthy();
      const [top, bottom] = entityIconTileGradient(darkTheme.colors.entityColors.blue);
      expect(property.getByTestId('entity-icon-tile-gradient-stop-top').props.stopColor).toBe(top);
      expect(property.getByTestId('entity-icon-tile-gradient-stop-bottom').props.stopColor).toBe(
        bottom,
      );
      expect(
        within(getByTestId('accounts-debts-heading')).getByTestId('entity-icon-tile'),
      ).toBeTruthy();
    });

    it("draws the account's stored icon in its heading tile, the kind glyph otherwise", async () => {
      bothSections({ property: { icon: 'building.2' } });

      const { getByTestId } = await renderAccounts();

      expect(
        glyphNamesWithin(
          within(getByTestId('accounts-property-heading')).getByTestId('entity-icon-tile'),
        ),
      ).toEqual(['building.2']);
      expect(
        glyphNamesWithin(
          within(getByTestId('accounts-debts-heading')).getByTestId('entity-icon-tile'),
        ),
      ).toEqual([accountKindSymbol.debt]);
    });
  });

  describe('localization', () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('renders its Ukrainian catalog strings when the locale is uk', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
      setLiveData({
        accounts: [{ id: 'a', name: 'Wallet', kind: 'cash' }],
        holdings: [],
        rates: [],
        settings: [{ baseCurrency: 'UAH' }],
      });

      const { getByText, getByLabelText, queryByText } = await renderAccounts();

      // The account-kind caption ("Cash" -> forms.account.cash) and the icon's
      // accessibility label prefix both read through the catalog, not a
      // hardcoded English literal.
      expect(getByText('Готівка')).toBeTruthy();
      expect(getByLabelText('Іконка Wallet')).toBeTruthy();
      expect(getByText('Додати рахунок')).toBeTruthy();
      expect(queryByText('Add account')).toBeNull();
    });

    it('renders the Ukrainian empty state when there are no active accounts', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
      setLiveData({
        accounts: [{ id: 'b', name: 'Old Cash', kind: 'cash', archivedAt: 123 }],
        holdings: [],
        rates: [],
        settings: [{ baseCurrency: 'UAH' }],
      });

      const { getByText } = await renderAccounts();
      expect(getByText('Ще немає рахунків')).toBeTruthy();
    });
  });
});

describe('AccountsScreen — loading gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading spinner, not the empty-accounts text, while any of its own queries is on its first load', async () => {
    setLiveData({ accounts: [], holdings: [], isLoading: { accounts: true } });

    const { getByTestId, queryByTestId, queryByText } = await renderAccounts();

    expect(getByTestId('accounts-loading')).toBeTruthy();
    expect(queryByText(i18n.t('accounts.emptyState'))).toBeNull();
    expect(queryByTestId('accounts-grid')).toBeNull();
  });

  it('renders the real content once every query has loaded', async () => {
    setLiveData({ accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }], holdings: [] });

    const { getByText, queryByTestId } = await renderAccounts();

    expect(getByText('Monobank')).toBeTruthy();
    expect(queryByTestId('accounts-loading')).toBeNull();
  });
});

// kiko-architecture: no request or query for data the user does not have —
// usePriceBook's price_points read is disabled while nothing on this screen
// is a priced type (property_item/metal) or a loan.
describe('AccountsScreen — the price_points gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables the price_points read when no holding needs it', async () => {
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 0, type: 'card' }],
    });
    await renderAccounts();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(false);
  });

  it('enables the price_points read once a priced holding is present', async () => {
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 0, type: 'metal' }],
    });
    await renderAccounts();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });

  it('reads price_points in parallel while holdings are still on their first load', async () => {
    setLiveData({ isLoading: { holdings: true } });
    await renderAccounts();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });

  // Only a loan reads its linked payments, so a priced-only screen never
  // runs the linked-payments read.
  it('reads the linked loan payments only once a loan is present', async () => {
    const loanPaymentsCall = () =>
      mockUseLiveQuery.mock.calls.find((call) => call[1].join(',') === 'transactions,holdings');
    const holdingOfType = (type: string) => ({
      accountId: 'a',
      currency: 'UAH',
      balanceMinorUnits: 0,
      type,
    });

    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      holdings: [holdingOfType('metal')],
    });
    await renderAccounts();
    expect(loanPaymentsCall()?.[2]).toBe(false);

    mockUseLiveQuery.mockClear();
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      holdings: [holdingOfType('loan')],
    });
    await renderAccounts();
    expect(loanPaymentsCall()?.[2]).toBe(true);
  });
});

// Accounts stays mounted under the native tab bar (and under an account's own
// detail screens), so while it is hidden it keeps its subscriptions but defers
// every read: a write elsewhere marks each query dirty and costs no read and no
// re-render here — `paused`, not `enabled`, which would unsubscribe and drop
// to `[]` (see kiko-architecture's `paused` vs `enabled`).
describe('AccountsScreen — paused while hidden', () => {
  const BANK = { id: 'a', name: 'Monobank', kind: 'bank' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseIsFocused.mockReturnValue(true);
  });

  afterEach(() => {
    mockUseIsFocused.mockReturnValue(true);
  });

  it('pauses every live query while unfocused, keeping the cache option and the enabled argument', async () => {
    mockUseIsFocused.mockReturnValue(false);
    setLiveData({
      accounts: [BANK],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 0, type: 'metal' }],
    });

    await renderAccounts();

    expect(mockUseLiveQuery.mock.calls.length).toBeGreaterThan(0);

    for (const call of mockUseLiveQuery.mock.calls) {
      expect(call[3]).toEqual({ cached: true, paused: true });
    }

    expect(mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points')?.[2]).toBe(
      true,
    );
  });

  it('leaves every live query unpaused while focused', async () => {
    setLiveData({ accounts: [BANK] });

    await renderAccounts();

    for (const call of mockUseLiveQuery.mock.calls) {
      expect(call[3]).toEqual({ cached: true, paused: false });
    }
  });

  // Mirrors use-live-query.ts's own paused/dirty contract: a call made with
  // `paused: true` never applies a pending write; the first call made with
  // `paused: false` applies it, so a screen sees new data exactly when the
  // real hook would have read it.
  it('shows an account added while hidden once the tab regains focus, and not before', async () => {
    const rowsOf = (accounts: { id: string; name: string; kind: string }[]) => ({
      accounts,
      holdings: [],
      rates: [],
      settings: [{ baseCurrency: 'UAH' }],
    });
    let committed = rowsOf([BANK]);
    let pending: ReturnType<typeof rowsOf> | undefined;
    const answer = (table: string): unknown[] =>
      ({
        accounts: committed.accounts,
        holdings: committed.holdings,
        currency_rates: committed.rates,
        settings: committed.settings,
      })[table as 'accounts'] ?? [];

    mockUseLiveQuery.mockImplementation(
      (_query: unknown, tables: string[], _enabled: boolean, options?: { paused?: boolean }) => {
        if (!(options?.paused ?? false) && pending !== undefined) {
          committed = pending;
          pending = undefined;
        }

        return { data: answer(tables[0]), isLoading: false, isFresh: true };
      },
    );
    const element = () => (
      <AccountsScreen
        navigation={asNavigationProp<AccountsProps['navigation']>(navigation)}
        route={asRouteProp<AccountsProps['route']>('Accounts')}
      />
    );

    const { getByText, queryByText, rerender } = await render(element(), {
      wrapper: GestureRootWrapper,
    });
    expect(getByText('Monobank')).toBeTruthy();

    mockUseIsFocused.mockReturnValue(false);
    await act(async () => {
      await rerender(element());
    });

    pending = rowsOf([BANK, { id: 'b', name: 'Savings', kind: 'bank' }]);
    await act(async () => {
      await rerender(element());
    });
    expect(queryByText('Savings')).toBeNull();

    mockUseIsFocused.mockReturnValue(true);
    await act(async () => {
      await rerender(element());
    });
    expect(getByText('Savings')).toBeTruthy();
    expect(getByText('Monobank')).toBeTruthy();
  });
});
