import { StyleSheet } from 'react-native';
import type { ComponentProps } from 'react';
import { State } from 'react-native-gesture-handler';
import { StyleSheet as UnistylesStyleSheet } from 'react-native-unistyles';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '../../design-system/unistyles';
import { i18n } from '@kiko/i18n/init';

import { darkTheme } from '../../design-system/theme';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '../../design-system/components/card-context-menu';
import { entityIconTileGradient } from '../../design-system/entity-tint';
import GestureRootWrapper from '../../test-support/gesture-root-wrapper';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

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
jest.mock('../../design-system/use-focus-refreshed-now/use-focus-refreshed-now', () => {
  const { useState } = jest.requireActual('react');

  return { useFocusRefreshedNow: () => useState(() => Date.now())[0] };
});

const mockUseLiveQuery = jest.fn();
const mockAccountRemove = jest.fn();
const mockAccountReorder = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    remove: (...args: unknown[]) => mockAccountRemove(...args),
    reorder: (...args: unknown[]) => mockAccountReorder(...args),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
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
  color?: string | null;
};
type Holding = {
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
    // A loan freshly started "now" (this test's own `Date.now()`, captured
    // just before render): no scheduled installment is due yet, so the
    // outstanding balance is deterministically the FULL principal — the
    // loan's own held value (`holding-value.ts`) is exactly `-principal`,
    // never a computed partial payoff this test would have to reproduce.
    const debtAccount = (over: Partial<Account> = {}): Account => ({
      id: 'd',
      name: 'Mortgage',
      kind: 'debt',
      ...over,
    });
    const loanHolding = (over: Partial<Holding> = {}): Holding => ({
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

    it('renders no Debts section when there is no debt account', async () => {
      const { queryByText } = await renderAccounts();
      expect(queryByText('Debts')).toBeNull();
    });

    it('renders a Debts section with the debt account, its total negative', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }, debtAccount()],
        holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 }, loanHolding()],
      });

      const { getByText, getAllByText } = await renderAccounts();

      expect(getByText('Debts')).toBeTruthy();
      expect(getByText('Mortgage')).toBeTruthy();
      // The card's own negative balance AND the section total (one debt
      // account -> the same figure) both read -5,000.00 ₴.
      expect(getAllByText(/-5,000\.00 ₴/).length).toBe(2);
    });

    // The Debts section shows a SECTION total
    // (negative), not only each card's own negative balance.
    it('shows a Debts section total next to the heading, summing every debt account', async () => {
      setLiveData({
        accounts: [debtAccount(), debtAccount({ id: 'e', name: 'Car loan' })],
        holdings: [loanHolding(), loanHolding({ accountId: 'e' })],
      });

      const { getByTestId } = await renderAccounts();

      // Two loans, each -5,000.00 UAH (full principal, no installment due
      // yet) -> section total -10,000.00 UAH.
      expect(within(getByTestId('accounts-debts-total')).getByText(/-10,000\.00 ₴/)).toBeTruthy();
    });

    it('keeps the debt account out of the main grid, in its own section grid', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }, debtAccount()],
        holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 }, loanHolding()],
      });

      const { getByTestId, getAllByTestId } = await renderAccounts();

      expect(getAllByTestId('account-card')).toHaveLength(2);
      // Both grids default to the mocked `sortable-grid` testID (there is no
      // typed way to override it — `Sortable.Grid`'s props carry no `testID`),
      // so each grid is scoped by its own wrapping Box instead.
      const mainGrid = within(getByTestId('accounts-grid')).getByTestId('sortable-grid');
      expect(within(mainGrid).queryByText('Mortgage')).toBeNull();
      const debtsGrid = within(getByTestId('accounts-debts-grid')).getByTestId('sortable-grid');
      expect(within(debtsGrid).getByText('Mortgage')).toBeTruthy();
    });

    // A Debts-section drag must persist the FULL account
    // order (main accounts first, then the debts section), never just its
    // own section's ids starting back at 0 — otherwise every OTHER screen
    // that lists all accounts (Statistics' account filter, the
    // transaction-form account rank, Home, statement import) interleaves the
    // two sections instead of keeping assets first, then debts.
    it('persists the FULL account order (main accounts first, then debts) when the Debts grid is reordered', async () => {
      setLiveData({
        accounts: [
          { id: 'a', name: 'Monobank', kind: 'bank' },
          debtAccount(),
          debtAccount({ id: 'e', name: 'Car loan' }),
        ],
        holdings: [loanHolding(), loanHolding({ accountId: 'e' })],
      });

      const { getByTestId } = await renderAccounts();
      const debtsGrid = within(getByTestId('accounts-debts-grid')).getByTestId('sortable-grid');

      await act(async () => {
        debtsGrid.props.onDragEnd({
          key: 'e',
          fromIndex: 1,
          toIndex: 0,
          indexToKey: ['e', 'd'],
        });
      });

      expect(mockAccountReorder).toHaveBeenCalledWith(['a', 'e', 'd']);
    });

    it('persists the FULL account order (main accounts, then debts unchanged) when the main grid is reordered', async () => {
      setLiveData({
        accounts: [
          { id: 'a', name: 'Monobank', kind: 'bank' },
          { id: 'c', name: 'Privat', kind: 'bank' },
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

      expect(mockAccountReorder).toHaveBeenCalledWith(['c', 'a', 'd']);
    });

    // `debtsTotal` used to depend on a bare `Date.now()` read fresh on every
    // function-component render, not the mounted screen's own stable `now`
    // — so it recomputed (and could drift) on every re-render, not just on
    // focus. A re-render with the real clock jumped forward (past another
    // installment boundary, so the loan's outstanding balance WOULD differ
    // if `now` had advanced) must still show the SAME total.
    it('keeps the Debts total stable across a re-render that is not a focus event', async () => {
      const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
      let clock = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => clock);

      setLiveData({
        accounts: [debtAccount()],
        holdings: [
          loanHolding({
            metadata: {
              kind: 'mortgage',
              principalMinorUnits: 500_000,
              startDate: clock - THIRTY_ONE_DAYS_MS * 3,
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

      clock += THIRTY_ONE_DAYS_MS * 2;
      await act(async () => rerender(buildElement()));

      const secondTotal = within(getByTestId('accounts-debts-total')).getByText(/₴/).props.children;
      expect(secondTotal).toEqual(firstTotal);
    });
  });

  describe('Property section', () => {
    // No price point is mocked anywhere in this file (`price_points` always
    // resolves empty — see `setLiveData`), so a `property_item`'s value falls
    // back to its lot's own cost basis (`priced-parts.ts`'s
    // `pricedValueOrNull` -> null -> `costBasisMinorAt`) rather than needing a
    // real priced instrument — 500_000 minor UAH -> 5,000.00 ₴.
    const propertyAccount = (over: Partial<Account> = {}): Account => ({
      id: 'p',
      name: 'Apartment',
      kind: 'property',
      ...over,
    });
    const propertyHolding = (over: Partial<Holding> = {}): Holding => ({
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

    it('renders no Property section when there is no property account', async () => {
      const { queryByText } = await renderAccounts();
      expect(queryByText('Property')).toBeNull();
    });

    it('renders a Property section with the property account and its own section total', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }, propertyAccount()],
        holdings: [
          { accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 },
          propertyHolding(),
        ],
      });

      const { getByText, getAllByText } = await renderAccounts();

      // "Property" reads twice on purpose — the section heading AND the
      // card's own kind caption (`forms.account.property`) share the exact
      // same word, unlike "Debts"/"Debt".
      expect(getAllByText('Property').length).toBe(2);
      expect(getByText('Apartment')).toBeTruthy();
      // The card's own value AND the section total (one property account ->
      // the same figure) both read 5,000.00 ₴.
      expect(getAllByText(/5,000\.00 ₴/).length).toBe(2);
    });

    it('shows a Property section total next to the heading, summing every property account', async () => {
      setLiveData({
        accounts: [propertyAccount(), propertyAccount({ id: 'q', name: 'Car' })],
        holdings: [propertyHolding(), propertyHolding({ accountId: 'q' })],
      });

      const { getByTestId } = await renderAccounts();

      expect(within(getByTestId('accounts-property-total')).getByText(/10,000\.00 ₴/)).toBeTruthy();
    });

    it('keeps the property account out of the main and Debts grids, in its own section grid', async () => {
      setLiveData({
        accounts: [
          { id: 'a', name: 'Monobank', kind: 'bank' },
          propertyAccount(),
          { id: 'd', name: 'Mortgage', kind: 'debt' },
        ],
        holdings: [
          { accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 },
          propertyHolding(),
        ],
      });

      const { getByTestId } = await renderAccounts();

      const mainGrid = within(getByTestId('accounts-grid')).getByTestId('sortable-grid');
      expect(within(mainGrid).queryByText('Apartment')).toBeNull();
      const propertyGrid = within(getByTestId('accounts-property-grid')).getByTestId(
        'sortable-grid',
      );
      expect(within(propertyGrid).getByText('Apartment')).toBeTruthy();
    });

    it('persists the FULL account order (main, then property, then debts) when the Property grid is reordered', async () => {
      setLiveData({
        accounts: [
          { id: 'a', name: 'Monobank', kind: 'bank' },
          propertyAccount(),
          propertyAccount({ id: 'q', name: 'Car' }),
          { id: 'd', name: 'Mortgage', kind: 'debt' },
        ],
        holdings: [propertyHolding(), propertyHolding({ accountId: 'q' })],
      });

      const { getByTestId } = await renderAccounts();
      const propertyGrid = within(getByTestId('accounts-property-grid')).getByTestId(
        'sortable-grid',
      );

      await act(async () => {
        propertyGrid.props.onDragEnd({
          key: 'q',
          fromIndex: 1,
          toIndex: 0,
          indexToKey: ['q', 'p'],
        });
      });

      expect(mockAccountReorder).toHaveBeenCalledWith(['a', 'q', 'p', 'd']);
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
