import { act, fireEvent, render, within } from '@testing-library/react-native';
import type { ComponentProps, ReactNode } from 'react';
import { ActionSheetIOS, StyleSheet } from 'react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { StyleSheet as UnistylesStyleSheet } from 'react-native-unistyles';
import '../../design-system/unistyles';

import * as colorSchemeModule from '../../design-system/color-scheme';
import { entityCardBackground } from '../../design-system/entity-tint';
import { entityColorsByScheme } from '../../design-system/palette';
import { darkTheme } from '../../design-system/theme';
import { i18n } from '../../i18n';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';
import { HOLD_GESTURE_TEST_ID } from '../card-context-menu';

import AccountsScreen from './accounts.screen';

type AccountsProps = ComponentProps<typeof AccountsScreen>;

// A grid card's delete menu is a react-native-gesture-handler long-press, so
// the screen must mount under a GestureHandlerRootView (the app supplies one at
// its root in production).
const gestureRootWrapper = ({ children }: { children: ReactNode }) => (
  <GestureHandlerRootView>{children}</GestureHandlerRootView>
);

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
jest.mock('../../navigation/use-scroll-to-top-on-tab-press', () => ({
  useScrollToTopOnTabPress: (ref: unknown, scrollOffset: unknown) =>
    mockUseScrollToTopOnTabPress(ref, scrollOffset),
}));

const mockUseLiveQuery = jest.fn();
const mockAccountRemove = jest.fn();
const mockAccountReorder = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: {
    listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    remove: (...args: unknown[]) => mockAccountRemove(...args),
    reorder: (...args: unknown[]) => mockAccountReorder(...args),
  },
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
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
}): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
    currency_rates: data.rates ?? [],
    settings: data.settings ?? [{ baseCurrency: 'UAH' }],
  };
  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
  }));
};

const navigation = navigationSpy();

const renderAccounts = (): ReturnType<typeof render> =>
  render(
    <AccountsScreen
      navigation={asNavigationProp<AccountsProps['navigation']>(navigation)}
      route={asRouteProp<AccountsProps['route']>('Accounts')}
    />,
    { wrapper: gestureRootWrapper },
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

    // Each account maps to its own GlassSurface card (testID `account-card`),
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

  it('deletes a manual account via the deep-press delete menu confirm', async () => {
    setLiveData({ accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }], holdings: [] });
    const sheetSpy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => callback(1));
    await renderAccounts();
    // The manual card is wrapped in the deep-press long-press. A hold that stays
    // still opens the destructive delete sheet; confirming its destructive index
    // removes the account.
    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });
    expect(sheetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ options: ['Cancel', 'Delete "Cash"'] }),
      expect.any(Function),
    );
    expect(mockAccountRemove).toHaveBeenCalledWith('a');
    sheetSpy.mockRestore();
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

  it('wires an auto-scroll ref and an edge activation offset to the grid (F9)', async () => {
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

  it('tints the account icon with its stored color', async () => {
    setLiveData({
      accounts: [
        { id: 'a', name: 'Cash', kind: 'cash', color: darkTheme.colors.entityColors.blue },
      ],
      holdings: [],
    });
    const { getByLabelText } = await renderAccounts();

    expect(getByLabelText('Cash icon').props.tintColor).toBe(darkTheme.colors.entityColors.blue);
  });

  it('falls back to the kind default color when the account has no stored color', async () => {
    setLiveData({ accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }], holdings: [] });
    const { getByLabelText } = await renderAccounts();

    // A `cash` account with no color reads the cash kind default (khaki).
    expect(getByLabelText('Cash icon').props.tintColor).toBe(darkTheme.colors.entityColors.khaki);
  });

  it('resolves the kind default color from the LIGHT entity set on the light theme', async () => {
    // Spy the scheme resolver → 'light' so the card list's `defaultAccountColor`
    // lookup picks the light entity set (see color-scheme.ts / palette.ts). The
    // card `renderItem` reuses the single scheme read at the screen top.
    jest.spyOn(colorSchemeModule, 'resolveColorScheme').mockReturnValue('light');
    try {
      setLiveData({ accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }], holdings: [] });
      const { getByLabelText } = await renderAccounts();

      // The cash kind default is `khaki`, resolved from the LIGHT set here.
      expect(getByLabelText('Cash icon').props.tintColor).toBe(entityColorsByScheme.light.khaki);
      expect(entityColorsByScheme.light.khaki).not.toBe(entityColorsByScheme.dark.khaki);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('washes each account card with a flat darkened background of its color on first render', async () => {
    setLiveData({
      accounts: [
        { id: 'a', name: 'Cash', kind: 'cash', color: darkTheme.colors.entityColors.blue },
      ],
      holdings: [],
    });
    const { getByTestId } = await renderAccounts();

    const flat = StyleSheet.flatten(getByTestId('account-card-wash').props.style);
    expect(flat.backgroundColor).toBe(entityCardBackground(darkTheme.colors.entityColors.blue));
  });

  it('washes an uncolored account card with a flat darkened background of its kind default', async () => {
    setLiveData({ accounts: [{ id: 'a', name: 'Cash', kind: 'cash' }], holdings: [] });
    const { getByTestId } = await renderAccounts();

    // A `cash` account with no color reads the cash kind default (khaki).
    const flat = StyleSheet.flatten(getByTestId('account-card-wash').props.style);
    expect(flat.backgroundColor).toBe(entityCardBackground(darkTheme.colors.entityColors.khaki));
  });

  it('draws the shared hairline card border on first render (G2)', async () => {
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
