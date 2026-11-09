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
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';
import type { RemoveHoldingsPlan } from '@kiko/transactions/remove-notice';
import { PaneContext, paneContextOf } from '@kiko/design-system/pane-context';
import { implicitParityFixture } from '@kiko/test-support/implicit-total-parity';
import { dropCard, type LiftableGrid, liftCard } from '@kiko/test-support/lift-grid-card';
import { accountSectionOrder, type ImplicitAccountKind } from '@kiko/holdings/implicit-account';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import AccountsScreen from './accounts.screen';

type AccountsProps = ComponentProps<typeof AccountsScreen>;

// 2024-01-01 (leap year) — anchor date for the recapitalizing-deposit case.
const START = Date.UTC(2024, 0, 1);

// A delete that no movement links to: the confirm stays bare.
const NOTHING_LINKED: RemoveHoldingsPlan = {
  deletedRows: { count: 0, names: [] },
  reversedContributions: [],
  keptContributions: [],
  keptSynced: [],
  unlinked: [],
  unlinkedPlain: false,
  templatesChanged: 0,
};

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

// useVisibleRefreshedNow is stood in the same way statistics.screen.test.tsx
// does — a `Date.now()` taken once at mount and held STABLE across re-renders
// (no visibility change fires in a standalone screen render), so a re-render
// test can prove the screen does not read its own fresh `Date.now()` per render.
jest.mock('@kiko/design-system/use-visible-refreshed-now/use-visible-refreshed-now', () => {
  const { useState } = jest.requireActual('react');

  return { useVisibleRefreshedNow: () => useState(() => Date.now())[0] };
});

// Whether the list is on screen. While a runtime default shows, the stack's focused route is that
// default, so `useIsFocused` is mocked false for the whole file: only visibility may decide.
const mockUseIsScreenVisible = jest.fn(() => true);
// A detail opens in the detail pane; outside a pane navigator the real helper falls back to
// `navigate` (its own test pins that). `mockUseDetailPaneRoute` is what the detail pane opened
// with, `mockShowPaneDefault` what the list fills it with, and `mockClosePaneRoute`
// how it closes the page of an entity that is gone.
const mockOpenInPane = jest.fn();
const mockShowPaneDefault = jest.fn();
const mockClosePaneRoute = jest.fn();
const mockUseDetailPaneRoute = jest.fn(
  (): { key?: string; name: string; params?: object; isDefault: boolean } | null => null,
);
jest.mock('@kiko/navigation/pane-stack', () => ({
  detailParamOf: jest.requireActual('@kiko/navigation/pane-stack/pane-visibility').detailParamOf,
  useIsScreenVisible: () => mockUseIsScreenVisible(),
  useOpenInPane: () => mockOpenInPane,
  useShowPaneDefault: () => mockShowPaneDefault,
  useClosePaneRoute: () => mockClosePaneRoute,
  useDetailPaneRoute: () => mockUseDetailPaneRoute(),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => false,
}));

const mockUseLiveQuery = jest.fn();
const mockAccountRemove = jest.fn();
const mockAccountReorder = jest.fn();
const mockHoldingRemove = jest.fn();
const mockRemoveHoldingsPlan = jest.fn(
  async (..._args: unknown[]): Promise<RemoveHoldingsPlan> => NOTHING_LINKED,
);
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
    reorder: (...args: unknown[]) => mockHoldingReorder(...args),
    closeMany: (...args: unknown[]) => mockHoldingCloseMany(...args),
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
      removeHolding: (...args: unknown[]) => mockHoldingRemove(...args),
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

type Account = {
  id: string;
  name: string;
  kind: string;
  currency?: string;
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
  // key defaults to `false` (an already-resolved query), so a call site that
  // omits it sees resolved queries.
  isLoading?: Partial<Record<string, boolean>>;
  // Per-table "still the cached rows" overrides (`isFresh: false`), for the
  // reorder-gate tests only — every key defaults to fresh.
  isStale?: Partial<Record<string, boolean>>;
}): void => {
  const byTable: Record<string, unknown[]> = {
    // The base currency of every fixture, so an account that names none keeps the base totals.
    accounts: (data.accounts ?? []).map((account) => ({ currency: 'UAH', ...account })),
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
    // Not 'mortgage': a card shows its kind label under the title, so that
    // label would equal the name 'Mortgage' this file looks cards up by.
    kind: 'personal',
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
    // A short name still centers beside the icon tile.
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
    // The kind rides along too, so the page knows its header items (no
    // Reminders bell for an implicit account) from its first render.
    expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
      accountId: 'a',
      name: 'Monobank',
      kind: 'bank',
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

    // Clearance lives on the Screen footer: its breathing-room gap
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

  describe('the account currency', () => {
    const usdRate = [{ base: 'USD', quote: 'UAH', rate: '40' }];

    it('totals a USD account in dollars with the base figure beneath', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Wise', kind: 'bank', currency: 'USD' }],
        holdings: [{ accountId: 'a', currency: 'USD', balanceMinorUnits: 10_000 }],
        rates: usdRate,
      });
      const { getByText, getByTestId } = await renderAccounts();

      expect(getByText('$100.00')).toBeTruthy();
      expect(within(getByTestId('account-card-converted')).getByText(/4,000\.00 ₴/)).toBeTruthy();
    });

    it('shows no caption for an account in the base currency', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
        holdings: [{ accountId: 'a', currency: 'USD', balanceMinorUnits: 10_000 }],
        rates: usdRate,
      });
      const { getByText, queryByTestId } = await renderAccounts();

      expect(getByText(/4,000\.00 ₴/)).toBeTruthy();
      expect(queryByTestId('account-card-converted')).toBeNull();
    });

    it('shows an empty USD account as zero dollars with a zero caption in the base', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Wise', kind: 'bank', currency: 'USD' }],
        holdings: [],
        rates: usdRate,
      });
      const { getByText, getByTestId } = await renderAccounts();

      expect(getByText('$0.00')).toBeTruthy();
      expect(within(getByTestId('account-card-converted')).getByText('0.00 ₴')).toBeTruthy();
    });

    it('shows a crypto account its own sum, with no caption and no zero in the base', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Cold wallet', kind: 'crypto', currency: 'BTC' }],
        holdings: [{ accountId: 'a', currency: 'BTC', balanceMinorUnits: 50_000_000 }],
        rates: [],
      });
      const { getByText, queryByText, queryByTestId } = await renderAccounts();

      expect(getByText(/0\.5/)).toBeTruthy();
      expect(queryByText(/0\.00 ₴/)).toBeNull();
      expect(queryByTestId('account-card-converted')).toBeNull();
    });
  });

  // The Property and Debts headings act as their implicit account's card: the total follows the
  // account currency, with the base caption beside it.
  describe.each([
    ['property', 'accounts-property-total', 'property-total-converted'],
    ['debt', 'accounts-debts-total', 'debts-total-converted'],
  ] as const)('the %s section total', (kind, totalTestID, captionTestID) => {
    it('totals in the account currency with the base figure beneath', async () => {
      const { account, holdings, rates, total, caption } = implicitParityFixture(kind, 'x');
      // An open holding on another account is no part of this section. The detail page cannot
      // pin that: its mocked holdings query ignores the account id.
      const otherAccount = { id: 'other', name: 'Other', kind: 'bank', currency: 'UAH' };
      const otherHolding = { accountId: 'other', currency: 'UAH', balanceMinorUnits: 700_000 };
      setLiveData({
        accounts: [account, otherAccount],
        holdings: [...holdings, otherHolding],
        rates,
      });
      const { getByTestId } = await renderAccounts();

      expect(within(getByTestId(totalTestID)).getByText(total)).toBeTruthy();
      expect(within(getByTestId(totalTestID)).getByTestId(captionTestID)).toHaveTextContent(
        caption,
      );
    });

    it('shows no caption for an account in the base currency', async () => {
      const { account, holdings, rates, caption } = implicitParityFixture(kind, 'x');
      setLiveData({ accounts: [{ ...account, currency: 'UAH' }], holdings, rates });
      const { getByTestId, queryByTestId } = await renderAccounts();

      expect(
        within(getByTestId(totalTestID)).getByText(new RegExp(caption.replace('.', '\\.'))),
      ).toBeTruthy();
      expect(queryByTestId(captionTestID)).toBeNull();
    });
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

  describe('the empty state', () => {
    const noLiveAccounts = () =>
      setLiveData({
        accounts: [{ id: 'b', name: 'Old Cash', kind: 'cash', archivedAt: 123 }],
        holdings: [],
        rates: [],
        settings: [{ baseCurrency: 'UAH' }],
      });

    it('renders the shared EmptyState with its title and message', async () => {
      noLiveAccounts();

      const { getByTestId, getByText } = await renderAccounts();

      expect(getByTestId('accounts-empty')).toBeTruthy();
      expect(getByText('No accounts yet')).toBeTruthy();
      expect(
        getByText(
          'An account can be a bank card, cash, crypto, or property. Monobank, Binance, and Bitcoin accounts can sync.',
        ),
      ).toBeTruthy();
    });

    it('opens the account form from its Add account action', async () => {
      noLiveAccounts();
      const { getByTestId } = await renderAccounts();

      expect(within(getByTestId('accounts-empty')).getByText('Add account')).toBeTruthy();

      await fireEvent.press(getByTestId('accounts-empty-action'));

      expect(navigation.navigate).toHaveBeenCalledWith('AccountForm', {});
    });

    it('drops the pinned footer, so Add account shows once', async () => {
      noLiveAccounts();

      const { queryByTestId, queryAllByText } = await renderAccounts();

      expect(queryByTestId('add-account-footer')).toBeNull();
      expect(queryAllByText('Add account')).toHaveLength(1);
    });

    it('shows the footer and no empty state once an account exists', async () => {
      setLiveData({ accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }], holdings: [] });

      const { getByTestId, queryByTestId } = await renderAccounts();

      expect(getByTestId('add-account-footer')).toBeTruthy();
      expect(queryByTestId('accounts-empty')).toBeNull();
    });

    it('is not rendered while a query is on its first load', async () => {
      setLiveData({ accounts: [], holdings: [], isLoading: { accounts: true } });

      const { queryByTestId } = await renderAccounts();

      expect(queryByTestId('accounts-empty')).toBeNull();
    });
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

  describe('the delete confirm names what else the account delete takes', () => {
    const LINKED_NOTICE = 'This also deletes 2 linked transactions in Dollar card.';
    const holdAccountCard = async (): Promise<void> => {
      await act(async () => {
        fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
          { state: State.BEGAN },
          { state: State.ACTIVE },
          { state: State.END },
        ]);
      });
    };

    it('reads the plan of every holding of the account, closed ones included, and shows its text', async () => {
      mockRemoveHoldingsPlan.mockResolvedValueOnce({
        ...NOTHING_LINKED,
        deletedRows: { count: 2, names: ['Dollar card'] },
      });
      setLiveData({
        accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }],
        holdings: [
          { id: 'h1', accountId: 'a', currency: 'UAH', balanceMinorUnits: 100 },
          { id: 'h2', accountId: 'a', currency: 'USD', balanceMinorUnits: 0, closedAt: 5 },
          { id: 'h3', accountId: 'b', currency: 'UAH', balanceMinorUnits: 0 },
        ],
      });
      const { getByTestId, getByText } = await renderAccounts();

      await holdAccountCard();

      expect(mockRemoveHoldingsPlan).toHaveBeenCalledWith(['h1', 'h2']);
      expect(getByText('Delete "Cash"')).toBeTruthy();
      expect(getByText(LINKED_NOTICE)).toBeTruthy();

      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

      expect(mockAccountRemove).toHaveBeenCalledWith('a');
    });

    it('keeps the confirm bare for an account nothing is linked to', async () => {
      setLiveData({
        accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }],
        holdings: [{ id: 'h1', accountId: 'a', currency: 'UAH', balanceMinorUnits: 100 }],
      });
      const { getByText, queryByText } = await renderAccounts();

      await holdAccountCard();

      expect(getByText('Delete "Cash"')).toBeTruthy();
      expect(queryByText(/This also/)).toBeNull();
    });

    it('opens a bare confirm when the plan cannot be read', async () => {
      mockRemoveHoldingsPlan.mockRejectedValueOnce(new Error('read failed'));
      setLiveData({ accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }], holdings: [] });
      const { getByTestId, getByText } = await renderAccounts();

      await holdAccountCard();

      expect(getByText('Delete "Cash"')).toBeTruthy();
      expect(getByTestId(DELETE_CONFIRM_TEST_ID)).toBeTruthy();
    });
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
    expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
      accountId: 'a',
      name: 'Wallet',
      kind: 'cash',
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

    expect(mockOpenInPane).not.toHaveBeenCalled();
  });

  it('opens the account on the next quick tap after a lifted release', async () => {
    const { getByTestId, getByText } = await renderAccounts();

    await liftCard(getByTestId('sortable-grid'), 'a');
    await fireEvent.press(getByText('Monobank'));
    await fireEvent.press(getByText('Monobank'));

    expect(mockOpenInPane).toHaveBeenCalledTimes(1);
    expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
      accountId: 'a',
      name: 'Monobank',
      kind: 'bank',
    });
  });

  it('opens the account on a quick tap after the lifted card was dropped with no press', async () => {
    const { getByTestId, getByText } = await renderAccounts();

    await liftCard(getByTestId('sortable-grid'), 'a');
    await dropCard(getByTestId('sortable-grid'), 'a');
    await fireEvent.press(getByText('Monobank'));

    expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
      accountId: 'a',
      name: 'Monobank',
      kind: 'bank',
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
    // way `GlassSurface` renders, and no colored wash at all).
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

    it("shows each loan card's kind under its title", async () => {
      setLiveData({
        accounts: [debtAccount()],
        holdings: [
          loanHolding(),
          loanHolding({
            id: 'l2',
            name: 'Flat loan',
            metadata: { kind: 'mortgage' },
          }),
        ],
      });

      const { getAllByTestId } = await renderAccounts();
      const [personal, mortgage] = getAllByTestId('holding-card-type');

      expect(personal).toHaveTextContent('From a person');
      expect(mortgage).toHaveTextContent('Mortgage');
    });

    // The Debts section shows a SECTION total
    // (negative), not only each card's own negative balance.
    it('shows a Debts section total next to the heading, summing every open loan', async () => {
      setLiveData({
        accounts: [debtAccount()],
        holdings: [loanHolding(), loanHolding({ id: 'l2', name: 'Car loan' })],
      });

      const { getByTestId } = await renderAccounts();

      // Two loans, each -4,975.59 UAH (the principal less payment 1, due on
      // the start day) -> section total -9,951.18 UAH.
      expect(within(getByTestId('accounts-debts-total')).getByText(/-9,951\.18 ₴/)).toBeTruthy();
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

      expect(mockOpenInPane).toHaveBeenCalledWith('HoldingDetail', {
        holdingId: 'l1',
        name: 'Mortgage',
      });
      expect(mockOpenInPane).not.toHaveBeenCalledWith('AccountDetail', expect.anything());
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

      it('shows what else deleting that holding takes under the confirm title', async () => {
        mockRemoveHoldingsPlan.mockResolvedValueOnce({
          ...NOTHING_LINKED,
          keptSynced: ['Monobank card'],
        });
        setLiveData({ accounts: [debtAccount()], holdings: [loanHolding()] });
        const { getByTestId, getByText } = await renderAccounts();

        await holdCard();
        await act(async () => {
          await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
        });

        expect(mockRemoveHoldingsPlan).toHaveBeenCalledWith(['l1']);
        expect(getByText('Linked transactions from your bank stay in Monobank card.')).toBeTruthy();
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

    // `debtsTotal` must depend on the mounted screen's own stable `now`, not a
    // bare `Date.now()` read fresh on every function-component render —
    // otherwise it would recompute (and could drift) on every re-render, not
    // just on focus. A re-render with the real clock jumped forward (past another
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

    it("shows each property card's category under its title", async () => {
      setLiveData({
        accounts: [propertyAccount()],
        holdings: [
          propertyHolding(),
          propertyHolding({
            id: 'h2',
            name: 'Sedan',
            metadata: { category: 'vehicle', lots: [] },
          }),
        ],
      });

      const { getAllByTestId } = await renderAccounts();
      const [flat, sedan] = getAllByTestId('holding-card-type');

      expect(flat).toHaveTextContent('Real estate');
      expect(sedan).toHaveTextContent('Vehicle');
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

      expect(mockOpenInPane).toHaveBeenCalledWith('HoldingDetail', {
        holdingId: 'h1',
        name: 'Apartment',
      });
      expect(mockOpenInPane).not.toHaveBeenCalledWith('AccountDetail', expect.anything());
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

      expect(mockOpenInPane).not.toHaveBeenCalled();
    });

    it('opens the holding on the next quick tap', async () => {
      const { grid, getByText } = await renderGrid();

      await liftCard(grid, holdingId);
      await fireEvent.press(getByText(holdingName));
      await fireEvent.press(getByText(holdingName));

      expect(mockOpenInPane).toHaveBeenCalledTimes(1);
      expect(mockOpenInPane).toHaveBeenCalledWith('HoldingDetail', {
        holdingId,
        name: holdingName,
      });
    });

    it('opens the holding on a quick tap once the card was dropped with no press', async () => {
      const { grid, getByText } = await renderGrid();

      await liftCard(grid, holdingId);
      await dropCard(grid, holdingId);
      await fireEvent.press(getByText(holdingName));

      expect(mockOpenInPane).toHaveBeenCalledWith('HoldingDetail', {
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

    it('lists the sections in the order accountSectionOrder names', async () => {
      const sectionTestIds: Record<ImplicitAccountKind | 'main', string> = {
        main: 'accounts-grid',
        property: 'accounts-property-heading',
        debt: 'accounts-debts-heading',
      };
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }, propertyAccount(), debtAccount()],
        holdings: [
          { accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 },
          propertyHolding(),
          loanHolding(),
        ],
      });

      const { getAllByTestId } = await renderAccounts();

      expect(
        getAllByTestId(/^(accounts-grid|accounts-(property|debts)-heading)$/).map(
          (section) => section.props.testID,
        ),
      ).toEqual(accountSectionOrder.map((section) => sectionTestIds[section]));
    });

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

    // The tile's icon and color are pinned by the heading component's own test.
    it("shows each account's squircle tile in its heading", async () => {
      bothSections();

      const { getByTestId } = await renderAccounts();

      expect(
        within(getByTestId('accounts-property-heading')).getByTestId('entity-icon-tile'),
      ).toBeTruthy();
      expect(
        within(getByTestId('accounts-debts-heading')).getByTestId('entity-icon-tile'),
      ).toBeTruthy();
    });
  });

  // The whole section heading row (tile, name, total, chevron) is one button
  // that opens the shared implicit account's own AccountDetail screen, the
  // page that replaces the account's card in the list.
  describe('implicit account heading row', () => {
    const bothSections = () =>
      setLiveData({
        accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }, propertyAccount(), debtAccount()],
        holdings: [
          { accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 },
          propertyHolding(),
          loanHolding(),
        ],
      });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    // The kind is the hint that keeps the Reminders bell off the pushed page
    // from its first render, before its own read of the account lands.
    it.each([
      ['accounts-property-open', 'p', 'Properties', 'property'],
      ['accounts-debts-open', 'd', 'Loans', 'debt'],
    ])(
      'opens the AccountDetail of the section’s own account from %s',
      async (testID, accountId, name, kind) => {
        bothSections();

        const { getByTestId } = await renderAccounts();
        await fireEvent.press(getByTestId(testID));

        expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
          accountId,
          name,
          kind,
        });
      },
    );

    // The route name is what the pushed screen titles itself with before its
    // own read lands, so it is the localized name, never the stored sentinel.
    it.each([
      ['accounts-property-open', 'p', 'Майно', 'property'],
      ['accounts-debts-open', 'd', 'Кредити', 'debt'],
    ])(
      'passes the Ukrainian default name to AccountDetail from %s',
      async (testID, accountId, name, kind) => {
        await act(async () => {
          await i18n.changeLanguage('uk');
        });
        bothSections();

        const { getByTestId } = await renderAccounts();
        await fireEvent.press(getByTestId(testID));

        expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
          accountId,
          name,
          kind,
        });
      },
    );

    it('passes the typed name of a renamed account to AccountDetail', async () => {
      setLiveData({
        accounts: [propertyAccount({ name: 'Real estate' })],
        holdings: [propertyHolding()],
      });

      const { getByTestId } = await renderAccounts();
      await fireEvent.press(getByTestId('accounts-property-open'));

      expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
        accountId: 'p',
        name: 'Real estate',
        kind: 'property',
      });
    });

    it('opens AccountDetail from a tap on the heading text or the total, not only the chevron', async () => {
      bothSections();

      const { getByText, getByTestId } = await renderAccounts();
      await fireEvent.press(getByText('Properties'));
      await fireEvent.press(getByTestId('accounts-debts-total'));

      expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
        accountId: 'p',
        name: 'Properties',
        kind: 'property',
      });
      expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
        accountId: 'd',
        name: 'Loans',
        kind: 'debt',
      });
    });

    it('is one button, reading out its name and its total', async () => {
      bothSections();

      const { getByTestId } = await renderAccounts();
      const row = getByTestId('accounts-property-open');

      expect(row.props.accessibilityRole).toBe('button');
      expect(within(row).getByText('Properties')).toBeTruthy();
      expect(within(row).getByTestId('accounts-property-total')).toBeTruthy();
    });

    it('shows a disclosure chevron at the end of each heading row, hidden from the accessibility tree', async () => {
      bothSections();

      const { getByTestId } = await renderAccounts();

      for (const kind of ['property', 'debts']) {
        const chevron = getByTestId(`accounts-${kind}-chevron`, { includeHiddenElements: true });

        expect(
          within(getByTestId(`accounts-${kind}-open`)).getByTestId(`accounts-${kind}-chevron`, {
            includeHiddenElements: true,
          }),
        ).toBe(chevron);
        expect(chevron.props.accessibilityElementsHidden).toBe(true);
        expect(chevron.props.importantForAccessibility).toBe('no-hide-descendants');
      }
    });

    // The disclosure glyph is the small caption-size secondary-tone chevron,
    // one per section row (the SF Symbol mock renders a View carrying the
    // glyph's own props; a rgba tone reaches it as its #RRGGBBAA hex).
    it('draws the chevron.right glyph at the caption icon size in the secondary tone', async () => {
      bothSections();

      const { getByTestId } = await renderAccounts();

      for (const kind of ['property', 'debts']) {
        const chevron = getByTestId(`accounts-${kind}-chevron`, { includeHiddenElements: true });
        const glyphs = chevron.children.filter((child) => typeof child !== 'string');

        expect(glyphs).toHaveLength(1);
        expect(glyphs[0].props.name).toBe('chevron.right');
        expect(glyphs[0].props.size).toBe(darkTheme.iconSizes.caption);
        expect(glyphs[0].props.tintColor).toMatch(/^#ebebf599$/i);
        expect(StyleSheet.flatten(chevron.props.style).marginLeft).toBe(darkTheme.spacing(2));
        expect(StyleSheet.flatten(chevron.props.style).flexShrink).toBe(0);
      }
    });

    // Jest cannot lay out pixels: the row holds a 44pt minimum height inside
    // its own bounds, so the whole row is the touch target.
    it('is at least 44pt tall, with its content centred', async () => {
      bothSections();

      const { getByTestId } = await renderAccounts();
      const row = StyleSheet.flatten(getByTestId('accounts-property-open').props.style);

      expect(row.minHeight).toBe(44);
      expect(row.flexDirection).toBe('row');
      expect(row.alignItems).toBe('center');
    });

    it('lays the heading, the total and the chevron out in one row, in that order', async () => {
      bothSections();

      const { getByTestId } = await renderAccounts();
      const order = getByTestId('accounts-property-open').children.map((child) =>
        typeof child === 'string' ? child : child.props.testID,
      );

      expect(order).toEqual([
        'accounts-property-heading',
        'accounts-property-total',
        'accounts-property-chevron',
      ]);
    });

    it('has no edit pencil any more, on a section or on a main-grid account card', async () => {
      bothSections();

      const { getByTestId, queryAllByLabelText, queryByTestId } = await renderAccounts();

      expect(getByTestId('accounts-property-open')).toBeTruthy();
      expect(getByTestId('accounts-debts-open')).toBeTruthy();
      expect(queryAllByLabelText('Edit')).toHaveLength(0);
      expect(queryAllByLabelText('Редагувати')).toHaveLength(0);
      expect(queryByTestId('accounts-property-edit')).toBeNull();
      expect(queryByTestId('accounts-debts-edit')).toBeNull();
      expect(queryByTestId('accounts-property-edit-region')).toBeNull();
    });

    it('opens no AccountForm from the heading row', async () => {
      bothSections();

      const { getByTestId } = await renderAccounts();
      await fireEvent.press(getByTestId('accounts-property-open'));

      expect(navigation.navigate).not.toHaveBeenCalledWith('AccountForm', expect.anything());
    });

    // No live implicit account (or none with an open holding) means no section
    // at all, so no heading row and no chevron.
    it.each([
      ['no property account', [{ id: 'a', name: 'Monobank', kind: 'bank' }], []],
      ['an archived property account', [propertyAccount({ archivedAt: 123 })], [propertyHolding()]],
      ['a property account with nothing open', [propertyAccount()], []],
    ])('shows no property heading row for %s', async (_label, accounts, holdings) => {
      setLiveData({ accounts, holdings });

      const { queryByTestId } = await renderAccounts();

      expect(queryByTestId('accounts-property-open')).toBeNull();
      expect(
        queryByTestId('accounts-property-chevron', { includeHiddenElements: true }),
      ).toBeNull();
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
    expect(queryByText(i18n.t('accounts.empty.title'))).toBeNull();
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
    mockUseIsScreenVisible.mockReturnValue(true);
  });

  afterEach(() => {
    mockUseIsScreenVisible.mockReturnValue(true);
  });

  it('pauses every live query while not on screen, keeping the cache option and the enabled argument', async () => {
    mockUseIsScreenVisible.mockReturnValue(false);
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

  it('leaves every live query unpaused while on screen, focused or not', async () => {
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

    mockUseIsScreenVisible.mockReturnValue(false);
    await act(async () => {
      await rerender(element());
    });

    pending = rowsOf([BANK, { id: 'b', name: 'Savings', kind: 'bank' }]);
    await act(async () => {
      await rerender(element());
    });
    expect(queryByText('Savings')).toBeNull();

    mockUseIsScreenVisible.mockReturnValue(true);
    await act(async () => {
      await rerender(element());
    });
    expect(getByText('Savings')).toBeTruthy();
    expect(getByText('Monobank')).toBeTruthy();
  });
});

// On a wide window the list is one pane and an account page the other: the list fills the empty
// primary pane with its first account (or the empty pane), marks the row that pane shows, and
// opens a tapped row there. On one pane none of it applies.
describe('AccountsScreen — in one of two panes', () => {
  const MONOBANK = { id: 'a', name: 'Monobank', kind: 'bank' };
  const SAVINGS = { id: 'c', name: 'Savings', kind: 'cash' };
  const MONOBANK_PARAMS = { accountId: 'a', name: 'Monobank', kind: 'bank' };

  const renderInPane = () =>
    render(
      <PaneContext.Provider value={paneContextOf('columns', 'companion')}>
        <AccountsScreen
          navigation={asNavigationProp<AccountsProps['navigation']>(navigation)}
          route={asRouteProp<AccountsProps['route']>('Accounts')}
        />
      </PaneContext.Provider>,
      { wrapper: GestureRootWrapper },
    );

  const selectedCards = (view: Awaited<ReturnType<typeof renderAccounts>>) =>
    view
      .getAllByTestId('account-card')
      .filter(
        (card) => StyleSheet.flatten(card.props.style).backgroundColor === darkTheme.colors.accent,
      );

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseIsScreenVisible.mockReturnValue(true);
    mockUseDetailPaneRoute.mockReturnValue(null);
    setLiveData({
      accounts: [MONOBANK, SAVINGS],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
  });

  describe('the default of the primary pane', () => {
    it('is the first account while the pane shows nothing', async () => {
      await renderInPane();

      expect(mockShowPaneDefault).toHaveBeenCalledTimes(1);
      expect(mockShowPaneDefault).toHaveBeenCalledWith('AccountDetail', MONOBANK_PARAMS, false);
    });

    it('is the empty pane while there is no account', async () => {
      setLiveData({ accounts: [], holdings: [] });

      await renderInPane();

      expect(mockShowPaneDefault).toHaveBeenCalledTimes(1);
      expect(mockShowPaneDefault).toHaveBeenCalledWith('AccountsEmptyPane', undefined, true);
    });

    it('is replaced when the first account is no longer the one shown', async () => {
      mockUseDetailPaneRoute.mockReturnValue({
        name: 'AccountDetail',
        params: { accountId: 'c', name: 'Savings', kind: 'cash' },
        isDefault: true,
      });

      await renderInPane();

      expect(mockShowPaneDefault).toHaveBeenCalledWith('AccountDetail', MONOBANK_PARAMS, false);
    });

    it('is replaced by the account page once an account exists after the empty pane', async () => {
      mockUseDetailPaneRoute.mockReturnValue({ name: 'AccountsEmptyPane', isDefault: true });

      await renderInPane();

      expect(mockShowPaneDefault).toHaveBeenCalledWith('AccountDetail', MONOBANK_PARAMS, false);
    });

    it('is not dispatched again once it is the one shown', async () => {
      mockUseDetailPaneRoute.mockReturnValue({
        name: 'AccountDetail',
        params: MONOBANK_PARAMS,
        isDefault: true,
      });

      await renderInPane();

      expect(mockShowPaneDefault).not.toHaveBeenCalled();
    });

    it('leaves an account the user tapped in the pane', async () => {
      mockUseDetailPaneRoute.mockReturnValue({
        name: 'AccountDetail',
        params: { accountId: 'c', name: 'Savings', kind: 'cash' },
        isDefault: false,
      });

      await renderInPane();

      expect(mockShowPaneDefault).not.toHaveBeenCalled();
    });

    it('waits for the first load rather than showing the empty pane', async () => {
      setLiveData({ accounts: [], holdings: [], isLoading: { accounts: true } });

      await renderInPane();

      expect(mockShowPaneDefault).not.toHaveBeenCalled();
    });

    it('is not dispatched while the tab is not on screen', async () => {
      mockUseIsScreenVisible.mockReturnValue(false);

      await renderInPane();

      expect(mockShowPaneDefault).not.toHaveBeenCalled();
    });

    it('is dispatched once the tab comes back on screen', async () => {
      mockUseIsScreenVisible.mockReturnValue(false);
      const element = () => (
        <PaneContext.Provider value={paneContextOf('columns', 'companion')}>
          <AccountsScreen
            navigation={asNavigationProp<AccountsProps['navigation']>(navigation)}
            route={asRouteProp<AccountsProps['route']>('Accounts')}
          />
        </PaneContext.Provider>
      );
      const { rerender } = await render(element(), { wrapper: GestureRootWrapper });

      mockUseIsScreenVisible.mockReturnValue(true);
      await act(async () => {
        await rerender(element());
      });

      expect(mockShowPaneDefault).toHaveBeenCalledWith('AccountDetail', MONOBANK_PARAMS, false);
    });

    it('is never dispatched on one pane', async () => {
      await renderAccounts();

      expect(mockShowPaneDefault).not.toHaveBeenCalled();
    });
  });

  // A page the user opened stays in the pane until its entity goes; then the pane goes back to its
  // default (the list fills it again once the page is closed).
  describe('the page of an entity that is gone', () => {
    const tapped = (name: string, params: object) =>
      mockUseDetailPaneRoute.mockReturnValue({ key: 'page-key', name, params, isDefault: false });

    it('is closed once its account is no longer in the list', async () => {
      tapped('AccountDetail', { accountId: 'deleted' });

      await renderInPane();

      expect(mockClosePaneRoute).toHaveBeenCalledTimes(1);
      expect(mockClosePaneRoute).toHaveBeenCalledWith('page-key');
    });

    it('is closed once the last account is deleted', async () => {
      tapped('AccountDetail', { accountId: 'a' });
      setLiveData({ accounts: [], holdings: [] });

      await renderInPane();

      expect(mockClosePaneRoute).toHaveBeenCalledWith('page-key');
    });

    it('is closed once its holding is no longer in the list', async () => {
      tapped('HoldingDetail', { holdingId: 'deleted' });

      await renderInPane();

      expect(mockClosePaneRoute).toHaveBeenCalledWith('page-key');
    });

    it('is left open while its account is in the list, archived or not', async () => {
      setLiveData({
        accounts: [MONOBANK, { id: 'z', name: 'Old', kind: 'bank', archivedAt: 1_700_000_000_000 }],
        holdings: [],
      });
      tapped('AccountDetail', { accountId: 'z' });

      await renderInPane();

      expect(mockClosePaneRoute).not.toHaveBeenCalled();
    });

    it('is left open while its holding is in the list, closed or not', async () => {
      setLiveData({
        accounts: [propertyAccount()],
        holdings: [propertyHolding({ closedAt: 1_700_000_000_000 })],
      });
      tapped('HoldingDetail', { holdingId: 'h1' });

      await renderInPane();

      expect(mockClosePaneRoute).not.toHaveBeenCalled();
    });

    it.each([
      ['a default, which the list replaces on its own', { isDefault: true }],
      ['another screen', { name: 'HoldingForm' }],
    ])('is not closed for %s', async (_label, over) => {
      mockUseDetailPaneRoute.mockReturnValue({
        key: 'page-key',
        name: 'AccountDetail',
        params: { accountId: 'deleted' },
        isDefault: false,
        ...over,
      });

      await renderInPane();

      expect(mockClosePaneRoute).not.toHaveBeenCalled();
    });

    it.each([
      ['the first load', { isLoading: { accounts: true } }],
      ['a read that is still the cached one', { isStale: { accounts: true } }],
      ['a holdings read that is still the cached one', { isStale: { holdings: true } }],
    ])('waits for %s before judging the page gone', async (_label, flags) => {
      tapped('AccountDetail', { accountId: 'deleted' });
      setLiveData({ accounts: [MONOBANK], holdings: [], ...flags });

      await renderInPane();

      expect(mockClosePaneRoute).not.toHaveBeenCalled();
    });

    it('waits until the tab is on screen', async () => {
      tapped('AccountDetail', { accountId: 'deleted' });
      mockUseIsScreenVisible.mockReturnValue(false);

      await renderInPane();

      expect(mockClosePaneRoute).not.toHaveBeenCalled();
    });

    it('is never closed on one pane', async () => {
      tapped('AccountDetail', { accountId: 'deleted' });

      await renderAccounts();

      expect(mockClosePaneRoute).not.toHaveBeenCalled();
    });
  });

  describe('the selected row', () => {
    it('is the account whose page the primary pane shows', async () => {
      mockUseDetailPaneRoute.mockReturnValue({
        name: 'AccountDetail',
        params: { accountId: 'c', name: 'Savings', kind: 'cash' },
        isDefault: false,
      });

      const view = await renderInPane();
      const selected = selectedCards(view);

      expect(selected).toHaveLength(1);
      expect(within(selected[0]).getByText('Savings')).toBeTruthy();
    });

    it('is also the default account the list put there', async () => {
      mockUseDetailPaneRoute.mockReturnValue({
        name: 'AccountDetail',
        params: MONOBANK_PARAMS,
        isDefault: true,
      });

      const selected = selectedCards(await renderInPane());

      expect(selected).toHaveLength(1);
      expect(within(selected[0]).getByText('Monobank')).toBeTruthy();
    });

    it('is none while the primary pane shows another screen', async () => {
      mockUseDetailPaneRoute.mockReturnValue({ name: 'AccountsEmptyPane', isDefault: true });

      expect(selectedCards(await renderInPane())).toHaveLength(0);
    });

    it('tells a screen reader which row is selected', async () => {
      mockUseDetailPaneRoute.mockReturnValue({
        name: 'AccountDetail',
        params: MONOBANK_PARAMS,
        isDefault: false,
      });

      const { getAllByRole } = await renderInPane();
      const rows = getAllByRole('button').filter(
        (row) => row.props.accessibilityState?.selected === true,
      );

      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText('Monobank')).toBeTruthy();
    });

    // Every row that opens a page is marked when the primary pane shows that page.
    describe('on every kind of row that opens a page', () => {
      const shown = (name: string, params: object) =>
        mockUseDetailPaneRoute.mockReturnValue({ name, params, isDefault: false });
      const fillOf = (node: { props: { style?: unknown } }) =>
        StyleSheet.flatten(node.props.style as never)?.backgroundColor;
      const isFilled = (node: { props: { style?: unknown } }) =>
        fillOf(node) === darkTheme.colors.accent;

      const withSections = () =>
        setLiveData({
          accounts: [MONOBANK, propertyAccount(), debtAccount()],
          holdings: [
            propertyHolding(),
            propertyHolding({ id: 'h2', name: 'Garage' }),
            loanHolding(),
          ],
        });

      it.each([
        ['Apartment', 'h1'],
        ['Garage', 'h2'],
        ['Mortgage', 'l1'],
      ])(
        'marks the holding card %s while its page is shown, and no other card',
        async (name, id) => {
          withSections();
          shown('HoldingDetail', { holdingId: id, name });

          const { getAllByTestId } = await renderInPane();
          const cards = getAllByTestId('holding-card');
          const marked = cards.filter(isFilled);

          expect(marked).toHaveLength(1);
          expect(within(marked[0]).getByText(name)).toBeTruthy();
          expect(getAllByTestId('account-card').filter(isFilled)).toHaveLength(0);
        },
      );

      it('tells a screen reader which holding card is selected', async () => {
        withSections();
        shown('HoldingDetail', { holdingId: 'h2', name: 'Garage' });

        const { getAllByRole } = await renderInPane();
        const rows = getAllByRole('button').filter(
          (row) => row.props.accessibilityState?.selected === true,
        );

        expect(rows).toHaveLength(1);
        expect(within(rows[0]).getByText('Garage')).toBeTruthy();
      });

      it.each([
        ['accounts-property-open', 'p', 'Properties'],
        ['accounts-debts-open', 'd', 'Loans'],
      ])(
        'marks the section row %s while the page of its account is shown',
        async (testID, id, name) => {
          withSections();
          shown('AccountDetail', { accountId: id, name });

          const { getByTestId, getAllByTestId } = await renderInPane();
          const other =
            testID === 'accounts-property-open' ? 'accounts-debts-open' : 'accounts-property-open';

          expect(isFilled(getByTestId(testID))).toBe(true);
          expect(getByTestId(testID).props.accessibilityState).toEqual({ selected: true });
          expect(isFilled(getByTestId(other))).toBe(false);
          expect(getByTestId(other).props.accessibilityState).toEqual({ selected: false });
          expect(getAllByTestId('holding-card').filter(isFilled)).toHaveLength(0);
          expect(getAllByTestId('account-card').filter(isFilled)).toHaveLength(0);
        },
      );

      it('marks no section row and no holding card for another account', async () => {
        withSections();
        shown('AccountDetail', { accountId: 'a', name: 'Monobank' });

        const { getByTestId, getAllByTestId } = await renderInPane();

        expect(isFilled(getByTestId('accounts-property-open'))).toBe(false);
        expect(isFilled(getByTestId('accounts-debts-open'))).toBe(false);
        expect(getAllByTestId('holding-card').filter(isFilled)).toHaveLength(0);
      });

      it('marks the property section row, not an account card, when the user has no other account', async () => {
        setLiveData({ accounts: [propertyAccount()], holdings: [propertyHolding()] });
        shown('AccountDetail', { accountId: 'p', name: 'Properties' });

        const { getByTestId } = await renderInPane();

        expect(isFilled(getByTestId('accounts-property-open'))).toBe(true);
      });
    });

    it('is none on one pane, where the primary pane has no route to report', async () => {
      expect(selectedCards(await renderAccounts())).toHaveLength(0);
    });
  });

  it('opens a tapped account in a pane', async () => {
    const { getByText } = await renderInPane();

    await fireEvent.press(getByText('Savings'));

    expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
      accountId: 'c',
      name: 'Savings',
      kind: 'cash',
    });
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
