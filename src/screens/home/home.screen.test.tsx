import { act, fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import '../../design-system/unistyles';

import { SEEDED_CATEGORIES } from '@kiko/db/__fixtures__/seeded-categories';

import { defaultDateRange } from '../../dates/default-range';
import { DAY_MS } from '../../dates/duration';
import { formatDate } from '../../dates/format';
import { resolveBottomClearance } from '../../design-system/components/screen';
import { darkTheme } from '../../design-system/theme';
import { i18n } from '../../i18n';
import { resolveCategoryColor } from '../../statistics/category-breakdown';
// Prefixed `mock*` so Jest's hoisted mock factory may reference it. Exposes the
// resolved MoneyText `tone` via a testID — see the module for the full rationale.
import mockTextTone from '../../test-support/mock-text-tone';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

import HomeScreen from './home.screen';

type HomeProps = ComponentProps<typeof HomeScreen>;

import { FILTER_ALL } from './transaction-filter-bar';

jest.mock('../../design-system/components/text', () => ({
  __esModule: true,
  default: mockTextTone,
}));

// The transaction list's own bottom clearance (see `home.screen.tsx`) is the
// tab-bar height MINUS the bottom safe-area inset, mirroring
// `screen.component.test.tsx:16-31`'s constants and rationale: a ZERO inset
// (the global mocks' default — see `jest/setup.js` and
// `__mocks__/react-native-bottom-tabs.tsx`) makes the pre-fix "add the full
// bar height" formula indistinguishable from the correct one, which is
// exactly how the double-counting regression shipped unnoticed.
const MOCK_TAB_BAR_HEIGHT = 80;
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => MOCK_TAB_BAR_HEIGHT,
}));

const MOCK_BOTTOM_INSET = 34;
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');

  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: MOCK_BOTTOM_INSET, left: 0 }),
  };
});

// The global jest/setup.js mock renders LiquidGlassView as a plain View and
// pins `isLiquidGlassSupported` to false (the non-glass fallback path). This
// file-level mock keeps the same default so every existing fallback-branch
// test is unchanged, but exposes the flag as a MUTABLE property (the same
// pattern `bottom-sheet.component.test.tsx` uses) so the translucentStrong-
// variant test below can flip it on to prove the live-glass branch paints a
// stronger-translucent backdrop under the glass.
jest.mock('@callstack/liquid-glass', () => {
  const { View } = require('react-native');
  return { LiquidGlassView: View, isLiquidGlassSupported: false };
});

const liquidGlass = jest.requireMock('@callstack/liquid-glass') as {
  isLiquidGlassSupported: boolean;
};

const mockUseLiveQuery = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
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
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: { listAllWithContextQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

const mockSyncAll = jest.fn();
const mockUseSyncAll = jest.fn();
jest.mock('@kiko/sync/use-sync-all', () => ({
  useSyncAll: (...args: unknown[]) => mockUseSyncAll(...args),
}));

// The global sync-status store is the SINGLE driver of the native
// RefreshControl spinner: any sync trigger (a pull, or an auto-sync on open)
// lights it via `runSync`, and Home binds `refreshing` straight to it. Mocked
// so a test can drive the "a sync is running" flag without a real run.
const mockUseSyncStatus = jest.fn();
const mockUseSyncProgress = jest.fn(() => ({ completed: 0, total: 0 }));
jest.mock('../../monobank/sync-status', () => ({
  useSyncStatus: () => mockUseSyncStatus(),
  useSyncProgress: () => mockUseSyncProgress(),
}));

// The active-tab re-tap → scroll-to-top hook reads the navigation context, which
// a standalone screen render has none of; stand it in with a spy so this test
// can assert the screen hands it the transaction list's own ref.
const mockUseScrollToTopOnTabPress = jest.fn();
jest.mock('../../navigation/use-scroll-to-top-on-tab-press', () => ({
  useScrollToTopOnTabPress: (ref: unknown) => mockUseScrollToTopOnTabPress(ref),
}));

// The refresh-control signal hook is the PULL GESTURE indicator, DECOUPLED from
// the whole sync run. Stand it in with a controllable `refreshing` so this test
// can assert the RefreshControl binds to the hook's pull flag (NOT the global
// sync signal) and that a pull calls the caller's `syncAll`. The hook's own
// synchronous pull flag and fast-phase-clear behavior are covered by
// `use-refresh-control-signal.test.tsx`.
const mockRefreshing = jest.fn(() => false);
const mockUseRefreshControlSignal = jest.fn();
jest.mock('./use-refresh-control-signal', () => ({
  useRefreshControlSignal: (onRefresh: () => Promise<void>) => {
    mockUseRefreshControlSignal(onRefresh);
    return { refreshing: mockRefreshing(), onRefresh };
  },
}));

type Account = { id: string; name: string; kind: string; archivedAt?: number | null };
type Holding = {
  id?: string;
  name?: string;
  accountId: string;
  currency: string;
  balanceMinorUnits: number;
  closedAt?: number | null;
};
type Rate = { base: string; quote: string; rate: string };
type Settings = { baseCurrency: string };
type Transaction = {
  id: string;
  amountMinorUnits: number;
  currency: string;
  time: number;
  description: string;
  category: string | null;
  accountId: string;
  accountName: string;
  holdingName: string;
  holdingType: string;
  exchangeCounterpartHoldingId: string | null;
};
type Category = { key: string; title: string; icon: string };

type LiveData = {
  accounts?: Account[];
  holdings?: Holding[];
  rates?: Rate[];
  settings?: Settings[];
  transactions?: Transaction[];
  categories?: Category[];
};

/**
 * Drive the five `useLiveQuery` calls by the table they subscribe to, so the
 * mock survives re-renders (a sequential once-chain returns undefined after the
 * first render and crashes on the next). Keyed data still exercises the exact
 * call order the screen must use — asserted separately below.
 */
const setLiveData = (data: LiveData): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
    currency_rates: data.rates ?? [],
    settings: data.settings ?? [{ baseCurrency: 'UAH' }],
    transactions: data.transactions ?? [],
    // Default to the production-seeded rows so category resolution behaves as
    // it would on device unless a test overrides it (e.g. a rename).
    categories: data.categories ?? SEEDED_CATEGORIES,
  };
  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
  }));
};

const navigation = navigationSpy();

const MONOBANK: Account = { id: 'a', name: 'Monobank', kind: 'bank' };
const PRIVATBANK: Account = { id: 'b', name: 'PrivatBank', kind: 'bank' };
const UAH_HOLDING: Holding = {
  id: 'h-uah',
  name: 'Чорна картка',
  accountId: 'a',
  currency: 'UAH',
  balanceMinorUnits: 100000,
};

// `time` defaults to "now" — the Home screen's date filter defaults to the
// last 30 days on mount, so a fixed historical default would fall outside it
// and silently vanish from every test that does not care about dates.
const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  amountMinorUnits: -5000,
  currency: 'UAH',
  time: Date.now(),
  description: 'Coffee',
  category: 'food',
  accountId: 'a',
  accountName: 'Monobank',
  holdingName: 'Card',
  // Default to a time-specific holding (a card), so an ordinary row keeps its
  // HH:MM stamp; a deposit/bond test overrides this to drop the time.
  holdingType: 'card',
  // The query projects this column for every row; an ordinary transaction is
  // not an exchange leg, so its marker is NULL (what SQLite returns), never
  // undefined.
  exchangeCounterpartHoldingId: null,
  ...overrides,
});

// Seed the live data with the standard single Monobank account + UAH holding,
// letting each test override only the dimension it exercises.
const seed = (data: LiveData = {}): void =>
  setLiveData({ accounts: [MONOBANK], holdings: [UAH_HOLDING], ...data });

const renderHome = (): ReturnType<typeof render> =>
  render(
    <HomeScreen
      navigation={asNavigationProp<HomeProps['navigation']>(navigation)}
      route={asRouteProp<HomeProps['route']>('Home')}
    />,
  );

// The filter controls are two custom dropdown sheets, one per dimension. A
// filter toggle opens the sheet (press its anchor testID), taps the option row
// (`${menuTestID}-option-${value}`), then dismisses via the backdrop — self-
// contained so each call leaves the sheet closed. `fireEvent` wraps each state
// update in `act`.
const pressFilter = async (
  getByTestId: (id: string) => Parameters<typeof fireEvent.press>[0],
  menuTestID: string,
  value: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.press(getByTestId(menuTestID));
  });
  await act(async () => {
    fireEvent.press(getByTestId(`${menuTestID}-option-${value}`));
  });
  await act(async () => {
    fireEvent.press(getByTestId(`${menuTestID}-backdrop`));
  });
};

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seed({ transactions: [transaction()] });
    mockUseSyncAll.mockReturnValue({ failures: [], syncAll: mockSyncAll });
    mockUseSyncStatus.mockReturnValue(false);
    mockRefreshing.mockReturnValue(false);
  });

  it('renders the net worth caption', async () => {
    const { getByText } = await renderHome();
    expect(getByText('Net worth')).toBeTruthy();
  });

  it('wires the transaction list to scroll to top on an active-tab re-tap', async () => {
    await renderHome();

    expect(mockUseScrollToTopOnTabPress).toHaveBeenCalledTimes(1);
    // The ref handed to the hook is the SAME one mounted on the transactions
    // SectionList — after render it resolves to that live list instance, so an
    // active-tab re-tap has a real scrollable to return to the top.
    const listRef = mockUseScrollToTopOnTabPress.mock.calls[0]?.[0];
    expect(typeof listRef?.current?.scrollToLocation).toBe('function');
  });

  it('renders the total net worth in the base currency', async () => {
    const { getAllByText } = await renderHome();
    expect(getAllByText(/1,000\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('renders a transaction description', async () => {
    const { getByText } = await renderHome();
    expect(getByText('Coffee')).toBeTruthy();
  });

  it('renders each transaction row as a glass card (M2 in the HIG audit)', async () => {
    const { getAllByTestId } = await renderHome();
    // Each row is wrapped in a GlassSurface, matching the app's glass-card
    // language, rather than a plain bordered list row.
    expect(getAllByTestId('transaction-row').length).toBeGreaterThan(0);
  });

  it("renders the transaction card through GlassSurface's stronger-translucent translucentStrong backdrop variant, reconciled with the app-wide bloom rollout", async () => {
    // The row uses GlassSurface's `translucentStrong` variant — a MORE-opaque
    // (0.80 alpha) translucent backdrop pinned UNDER the glass, so the card
    // stays see-through but drifts LESS in lightness on scroll than either
    // `material` (no backdrop) or `transparent` (a softer 0.60 backdrop). On the
    // non-glass FALLBACK path the `-base` fill IS that stronger translucent
    // color, with NO extra wash (the fallback was never the broken path — see
    // GlassSurface's `translucentStrong` doc); on the live-glass path a
    // `-backdrop` layer carries it, PLUS a `-wash` layer (the device-bug fix:
    // the backdrop alpha alone is invisible under the live glass's own
    // refraction, so a neutral dark overlay painted OVER the finished glass is
    // what actually makes the card read darker). The default seed (beforeEach)
    // is a single transaction, so exactly one row renders.
    //
    // The row ALSO takes `bloom` (the app-wide rollout). On the fallback path
    // this changes nothing — `resolveFallbackFill` checks `isStrong` before
    // `isBloom`, so the stronger translucent fill still wins. On the real
    // glass path it is the key reconciliation: `bloom` wins the BACKDROP
    // (removed entirely, re-admitting the live sample `translucentStrong`'s
    // pin exists to prevent) and switches the native effect to `'clear'`, but
    // the dark `-wash` is UNCHANGED — `resolveWashFill` is driven by
    // `translucentStrong` alone and never reads `bloom` — so it keeps painting
    // over the now-backdrop-less glass. COMBINE, not replace: the dark wash
    // stays for row-text legibility; only the anti-drift backdrop pin is
    // traded away for bloom's live sample.
    const { getByTestId: getByTestIdFallback, queryByTestId: queryByTestIdFallback } =
      await renderHome();
    const fallbackBase = StyleSheet.flatten(
      getByTestIdFallback('transaction-row-base').props.style,
    );
    expect(fallbackBase.backgroundColor).toBe(darkTheme.colors.surfaceTranslucentStrong);
    expect(queryByTestIdFallback('transaction-row-wash')).toBeNull();

    try {
      liquidGlass.isLiquidGlassSupported = true;
      // `bloom` wins on the backdrop: it is entirely absent, not just a
      // different fill — this fails if the row ever drops `bloom` and reverts
      // to plain `translucentStrong`'s pinned backdrop.
      const { getByTestId, queryByTestId } = await renderHome();
      expect(queryByTestId('transaction-row-backdrop')).toBeNull();
      expect(getByTestId('transaction-row-base').props.effect).toBe('clear');

      // The dark wash survives the reconciliation — legibility is preserved
      // even though the backdrop pin is gone.
      const wash = StyleSheet.flatten(getByTestId('transaction-row-wash').props.style);
      expect(wash.backgroundColor).toBe(darkTheme.colors.surfaceWashStrong);
    } finally {
      liquidGlass.isLiquidGlassSupported = false;
    }
  });

  it('renders the transaction time as zero-padded HH:MM', async () => {
    // 2 days ago, at a fixed hour/minute — well inside the screen's default
    // last-30-days window, unlike a fixed historical date would be.
    const at = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    at.setHours(9, 5, 0, 0);
    seed({ transactions: [transaction({ time: at.getTime() })] });
    const { getByText } = await renderHome();
    expect(getByText('09:05')).toBeTruthy();
  });

  it.each(['term_deposit', 'bond'])(
    'hides the HH:MM time on a %s row (deposits and bonds are not time-specific)',
    async (holdingType) => {
      const at = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      at.setHours(9, 5, 0, 0);
      seed({ transactions: [transaction({ time: at.getTime(), holdingType })] });
      const { queryByText } = await renderHome();
      expect(queryByText('09:05')).toBeNull();
    },
  );

  it('renders the account-name and the resolved category title for a transaction', async () => {
    seed({ transactions: [transaction({ category: 'groceries' })] });
    const { getByText } = await renderHome();
    expect(getByText('Monobank · Groceries')).toBeTruthy();
  });

  it('resolves each row title + icon from the categories repo, following a rename', async () => {
    // The `groceries` category has been renamed away from its seeded
    // "Groceries"/"cart" defaults, so the row must follow the repo, not the
    // stored raw key or any hard-coded map.
    seed({
      categories: [{ key: 'groceries', title: 'Supermarket', icon: 'basket' }],
      transactions: [transaction({ category: 'groceries', description: 'Milk' })],
    });
    const { getByText, getByLabelText } = await renderHome();
    expect(getByText('Monobank · Supermarket')).toBeTruthy();
    expect(getByLabelText('Supermarket').props.name).toBe('basket');
  });

  it('falls back to the seeded "other" category when a stored category does not resolve', async () => {
    seed({ transactions: [transaction({ category: 'NoSuchCategory' })] });
    const { getByText, getByLabelText } = await renderHome();
    expect(getByText('Monobank · Other')).toBeTruthy();
    expect(getByLabelText('Other').props.name).toBe('square.grid.2x2');
  });

  it('gives a row icon and its filter chip the same resolved color', async () => {
    // A synced row whose stored slug is absent from the categories table. The
    // filter chip folds it onto the default key, so the row icon must fold it
    // the same way — hashing the icon on the raw slug while the chip hashes on
    // the resolved key renders one category in two different hues.
    seed({
      categories: [{ key: 'other', title: 'Other', icon: 'square.grid.2x2' }],
      transactions: [transaction({ category: 'Groceries' })],
    });
    const { getByLabelText, getByTestId } = await renderHome();

    const rowIconTint = getByLabelText('Other').props.tintColor;
    expect(rowIconTint).toBe(resolveCategoryColor(null, 'other'));

    await act(async () => {
      fireEvent.press(getByTestId('category-filter-menu'));
    });

    // The filter option icon renders through the shared SelectableRow, so it no
    // longer carries an accessibilityLabel — read it off the option row's glyph.
    // It must fold onto the SAME resolved color as the transaction row icon.
    const filterRow = getByTestId('category-filter-menu-option-other');
    const filterIconTint = filterRow.queryAll((node) => node.props.name === 'square.grid.2x2').at(0)
      ?.props.tintColor;

    expect(filterIconTint).toBe(rowIconTint);
  });

  it('renders the signed transaction amount', async () => {
    const { getByText } = await renderHome();
    expect(getByText(/-50\.00 ₴/)).toBeTruthy();
  });

  it('renders a positive transaction amount in the green (positive) tone', async () => {
    seed({ transactions: [transaction({ amountMinorUnits: 5000 })] });
    const { getByText } = await renderHome();
    // The net-worth headline is 1,000.00 ₴, so 50.00 ₴ is uniquely the row.
    expect(getByText(/50\.00 ₴/).props.testID).toBe('text-tone-positive');
  });

  it('renders a negative transaction amount in the negative tone', async () => {
    const { getByText } = await renderHome();
    expect(getByText(/-50\.00 ₴/).props.testID).toBe('text-tone-negative');
  });

  it('renders the default "{holding} expense" description for an empty negative transaction', async () => {
    seed({
      transactions: [
        transaction({
          description: '',
          category: null,
          holdingName: 'Card',
          amountMinorUnits: -5000,
        }),
      ],
    });
    const { getByText } = await renderHome();
    expect(getByText('Card expense')).toBeTruthy();
    // A null category folds into the default category ("Other"), not a separate
    // "Uncategorized" bucket.
    expect(getByText('Monobank · Other')).toBeTruthy();
  });

  it('renders the default "{holding} income" description for an empty positive transaction', async () => {
    seed({
      transactions: [
        transaction({
          description: '',
          category: null,
          holdingName: 'Card',
          amountMinorUnits: 5000,
        }),
      ],
    });
    const { getByText } = await renderHome();
    expect(getByText('Card income')).toBeTruthy();
  });

  it('applies a rate from the rates table to convert a foreign holding', async () => {
    seed({
      holdings: [{ accountId: 'a', currency: 'USD', balanceMinorUnits: 10000 }],
      rates: [{ base: 'USD', quote: 'UAH', rate: '40' }],
    });
    const { getByText } = await renderHome();
    // 100.00 USD * 40 = 4,000.00 UAH. The converted headline is the plain solid
    // MoneyText number.
    expect(getByText('4,000.00 ₴')).toBeTruthy();
  });

  it('does not crash when a holding has no rate; excludes it from both the total and the breakdown', async () => {
    seed({
      holdings: [{ accountId: 'a', currency: 'BTC', balanceMinorUnits: 100000000 }],
      rates: [],
      transactions: [],
    });
    const { getAllByText, queryByText } = await renderHome();
    // The unconvertible holding is dropped from the converted headline total...
    expect(getAllByText(/0\.00 ₴/).length).toBeGreaterThan(0);
    // ...and from the breakdown beneath it too, so the rows always sum to the
    // headline. There is no "Rates unavailable" fallback anymore.
    expect(queryByText('BTC')).toBeNull();
    expect(queryByText(/rates unavailable/i)).toBeNull();
  });

  it('renders a per-currency breakdown line for each held currency', async () => {
    seed({
      holdings: [UAH_HOLDING, { accountId: 'a', currency: 'USD', balanceMinorUnits: 5000 }],
      rates: [{ base: 'USD', quote: 'UAH', rate: '40' }],
      transactions: [],
    });
    const { getByText } = await renderHome();
    // Currency labels for each held currency.
    expect(getByText('UAH')).toBeTruthy();
    expect(getByText('USD')).toBeTruthy();
    // Each currency's own summed total (headline is 3,000.00 ₴, so these
    // amounts belong to the breakdown lines only).
    expect(getByText(/1,000\.00 ₴/)).toBeTruthy();
    expect(getByText(/\$50\.00/)).toBeTruthy();
  });

  it('omits the "Rates unavailable" state and only lists convertible currencies when a rate is missing', async () => {
    seed({
      holdings: [UAH_HOLDING, { accountId: 'a', currency: 'BTC', balanceMinorUnits: 100000000 }],
      rates: [],
      transactions: [],
    });
    const { getByText, queryByText } = await renderHome();
    expect(queryByText(/rates unavailable/i)).toBeNull();
    expect(getByText('UAH')).toBeTruthy();
    // BTC has no cached rate, so it is excluded from the breakdown too — it
    // must match the headline total, which already excludes it.
    expect(queryByText('BTC')).toBeNull();
  });

  it('lists only the currencies the headline total includes', async () => {
    seed({
      holdings: [UAH_HOLDING, { accountId: 'a', currency: 'BTC', balanceMinorUnits: 50_000_000 }],
      rates: [],
      transactions: [],
    });

    const { queryByText } = await renderHome();

    expect(queryByText('BTC')).toBeNull();
  });

  it('renders the net-worth number as a plain solid MoneyText with no wash', async () => {
    const { getAllByText, queryByTestId } = await renderHome();
    // The headline is a plain, solid, non-croppable MoneyText (positive balance
    // -> textPrimary/white). There is no gradient wash behind it.
    const [netWorth] = getAllByText(/1,000\.00 ₴/);
    expect(netWorth.props.testID).toBe('text-tone-textPrimary');
    expect(queryByTestId('net-worth-wash-svg')).toBeNull();
  });

  it('renders the zero net-worth number as a plain solid MoneyText with no wash', async () => {
    seed({ holdings: [] });
    const { getAllByText, queryByTestId } = await renderHome();
    const [netWorth] = getAllByText(/0\.00 ₴/);
    expect(netWorth.props.testID).toBe('text-tone-textPrimary');
    expect(queryByTestId('net-worth-wash-svg')).toBeNull();
  });

  it('excludes holdings whose parent account is archived from the total', async () => {
    seed({ accounts: [{ ...MONOBANK, archivedAt: 123 }] });
    const { getAllByText } = await renderHome();
    expect(getAllByText(/0\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('excludes closed holdings from the total', async () => {
    seed({ holdings: [{ ...UAH_HOLDING, closedAt: 99 }] });
    const { getAllByText } = await renderHome();
    expect(getAllByText(/0\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('filters the transaction list to the selected account only', async () => {
    seed({
      accounts: [MONOBANK, PRIVATBANK],
      transactions: [
        transaction({ id: 't1', accountId: 'a', accountName: 'Monobank', description: 'Coffee' }),
        transaction({
          id: 't2',
          accountId: 'b',
          accountName: 'PrivatBank',
          description: 'Groceries',
        }),
      ],
    });
    const { getByText, queryByText, getByTestId } = await renderHome();
    expect(getByText('Coffee')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();

    await pressFilter(getByTestId, 'account-filter-menu', 'Monobank');

    expect(getByText('Coffee')).toBeTruthy();
    expect(queryByText('Groceries')).toBeNull();
  });

  it('lists every active account in the account filter, even one with no transactions', async () => {
    // PrivatBank has no transactions and Closed is archived. The filter options
    // must come from the accounts query (all active accounts), not from the
    // transactions — so PrivatBank still appears and the archived one does not.
    seed({
      accounts: [MONOBANK, PRIVATBANK, { id: 'c', name: 'Closed', kind: 'bank', archivedAt: 123 }],
      transactions: [transaction({ accountId: 'a', accountName: 'Monobank' })],
    });
    const { getByTestId, queryByTestId } = await renderHome();

    await act(async () => {
      fireEvent.press(getByTestId('account-filter-menu'));
    });

    expect(getByTestId('account-filter-menu-option-Monobank')).toBeTruthy();
    // Present despite having zero transactions...
    expect(getByTestId('account-filter-menu-option-PrivatBank')).toBeTruthy();
    // ...while the archived account is excluded.
    expect(queryByTestId('account-filter-menu-option-Closed')).toBeNull();
  });

  it('keeps both categories active and shows transactions from either when two are toggled on', async () => {
    seed({
      transactions: [
        transaction({ id: 't1', category: 'dining', description: 'Coffee' }),
        transaction({ id: 't2', category: 'transport', description: 'Groceries' }),
        transaction({ id: 't3', category: 'utilities', description: 'Rent' }),
      ],
    });
    const { getByText, queryByText, getByTestId } = await renderHome();

    await pressFilter(getByTestId, 'category-filter-menu', 'dining');
    await pressFilter(getByTestId, 'category-filter-menu', 'transport');

    expect(getByText('Coffee')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();
    expect(queryByText('Rent')).toBeNull();
  });

  it('orders the category filter options by the categories sortOrder, not transaction first-seen order', async () => {
    // The categories repo already arrives ordered by `sortOrder` (dining, then
    // transport here). Transactions are first *seen* the other way round
    // (transport, then dining), so the filter must follow the repo's reorder,
    // not the transaction encounter order.
    seed({
      categories: [
        { key: 'dining', title: 'Dining', icon: 'fork.knife' },
        { key: 'transport', title: 'Transport', icon: 'car' },
      ],
      transactions: [
        transaction({ id: 't1', category: 'transport', description: 'Bus' }),
        transaction({ id: 't2', category: 'dining', description: 'Coffee' }),
      ],
    });
    const { getByTestId, getAllByTestId } = await renderHome();

    await act(async () => {
      fireEvent.press(getByTestId('category-filter-menu'));
    });

    const optionValues = getAllByTestId(/^category-filter-menu-option-/)
      .map((node) => String(node.props.testID).replace('category-filter-menu-option-', ''))
      .filter((value) => value !== FILTER_ALL);

    expect(optionValues).toEqual(['dining', 'transport']);
  });

  it('removes a category from the set when its action is toggled off again', async () => {
    seed({
      transactions: [
        transaction({ id: 't1', category: 'dining', description: 'Coffee' }),
        transaction({ id: 't2', category: 'transport', description: 'Groceries' }),
      ],
    });
    const { getByText, queryByText, getByTestId } = await renderHome();

    await pressFilter(getByTestId, 'category-filter-menu', 'dining');
    await pressFilter(getByTestId, 'category-filter-menu', 'transport');
    await pressFilter(getByTestId, 'category-filter-menu', 'dining');

    expect(queryByText('Coffee')).toBeNull();
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('clears the category dimension and shows every transaction when All is pressed', async () => {
    seed({
      transactions: [
        transaction({ id: 't1', category: 'dining', description: 'Coffee' }),
        transaction({ id: 't2', category: 'transport', description: 'Groceries' }),
      ],
    });
    const { getByText, queryByText, getByTestId } = await renderHome();

    await pressFilter(getByTestId, 'category-filter-menu', 'dining');
    expect(queryByText('Groceries')).toBeNull();

    await pressFilter(getByTestId, 'category-filter-menu', FILTER_ALL);

    expect(getByText('Coffee')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('keeps the category dropdown open through several toggles and applies them all', async () => {
    seed({
      transactions: [
        transaction({ id: 't1', category: 'dining', description: 'Coffee' }),
        transaction({ id: 't2', category: 'transport', description: 'Groceries' }),
        transaction({ id: 't3', category: 'utilities', description: 'Rent' }),
      ],
    });
    const { getByText, queryByText, getByTestId, queryByTestId } = await renderHome();

    // Open once, then toggle two categories without reopening. Each toggle
    // changes the selection state (and re-renders the sheet); it must stay open.
    await act(async () => {
      fireEvent.press(getByTestId('category-filter-menu'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('category-filter-menu-option-dining'));
    });
    expect(queryByTestId('category-filter-menu-option-transport')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('category-filter-menu-option-transport'));
    });
    expect(queryByTestId('category-filter-menu-option-utilities')).toBeTruthy();

    // Dismiss and confirm both selections took effect.
    await act(async () => {
      fireEvent.press(getByTestId('category-filter-menu-backdrop'));
    });
    expect(getByText('Coffee')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();
    expect(queryByText('Rent')).toBeNull();
  });

  it('collapses an overridden slug and a capitalized synced value with the same resolved key into one filter entry', async () => {
    // After an override some rows store the lowercase slug key (`groceries`)
    // while un-overridden synced rows still store the capitalized MCC name
    // (`Groceries`). Both resolve to the same KEY, so the filter must show a
    // single `groceries` entry (labeled "Groceries"), not one chip per raw
    // stored value.
    seed({
      transactions: [
        transaction({ id: 't1', category: 'Groceries', description: 'SyncedRow' }),
        transaction({ id: 't2', category: 'groceries', description: 'OverriddenRow' }),
      ],
    });
    const { getByTestId, getByText, queryByTestId } = await renderHome();

    await act(async () => {
      fireEvent.press(getByTestId('category-filter-menu'));
    });

    expect(getByTestId('category-filter-menu-option-groceries')).toBeTruthy();
    expect(queryByTestId('category-filter-menu-option-Groceries')).toBeNull();
    // A single "Groceries" label renders for the collapsed entry — not two.
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('filters both the overridden slug row and the capitalized synced row in when the resolved category is selected', async () => {
    seed({
      transactions: [
        transaction({ id: 't1', category: 'Groceries', description: 'SyncedRow' }),
        transaction({ id: 't2', category: 'groceries', description: 'OverriddenRow' }),
        transaction({ id: 't3', category: 'transport', description: 'OtherRow' }),
      ],
    });
    const { getByText, queryByText, getByTestId } = await renderHome();

    await pressFilter(getByTestId, 'category-filter-menu', 'groceries');

    expect(getByText('SyncedRow')).toBeTruthy();
    expect(getByText('OverriddenRow')).toBeTruthy();
    expect(queryByText('OtherRow')).toBeNull();
  });

  it('defaults the date-range field to the last 30 days, filtering out an older transaction', async () => {
    const recent = transaction({ id: 't1', time: Date.now() - 2 * DAY_MS, description: 'Recent' });
    const tooOld = transaction({ id: 't2', time: Date.now() - 40 * DAY_MS, description: 'TooOld' });
    seed({ transactions: [recent, tooOld] });

    const { getByText, queryByText } = await renderHome();
    const range = defaultDateRange();

    // The field shows the 30-day default, not the full earliest–latest span...
    expect(getByText(`${formatDate(range.from)} – ${formatDate(range.to)}`)).toBeTruthy();
    // ...a row inside the window shows...
    expect(getByText('Recent')).toBeTruthy();
    // ...and a row older than 30 days is filtered out by default.
    expect(queryByText('TooOld')).toBeNull();
  });

  it('resets the date range to the 30-day default (not all-time) when Clear is pressed', async () => {
    const recent = transaction({ id: 't1', time: Date.now() - 2 * DAY_MS, description: 'Recent' });
    const tooOld = transaction({ id: 't2', time: Date.now() - 40 * DAY_MS, description: 'TooOld' });
    seed({ transactions: [recent, tooOld] });

    const { getByLabelText, getByTestId, getByText, queryByText } = await renderHome();

    // Narrow away from the 30-day default: the picker moves the bound nearer to
    // the pick, so picking 3 days ago pulls the `to` bound down to it. That
    // excludes both the "Recent" (2 days ago) and "TooOld" (40 days ago) rows.
    await act(async () => {
      fireEvent.press(getByLabelText('Date range'));
    });
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const calendar = getByTestId('date-range-calendar').props as {
      onDayPress: (day: unknown) => void;
    };
    await act(async () => {
      calendar.onDayPress({
        year: threeDaysAgo.getFullYear(),
        month: threeDaysAgo.getMonth() + 1,
        day: threeDaysAgo.getDate(),
      });
    });
    await act(async () => {
      fireEvent.press(getByText('Apply'));
    });
    expect(queryByText('Recent')).toBeNull();

    // Clearing must land back on the 30-day default, NOT on all-time: the
    // 40-day-old row stays excluded and the field shows the 30-day range again.
    await act(async () => {
      fireEvent.press(getByLabelText('Date range'));
    });
    await act(async () => {
      fireEvent.press(getByText('Clear'));
    });

    const range = defaultDateRange();
    expect(getByText(`${formatDate(range.from)} – ${formatDate(range.to)}`)).toBeTruthy();
    expect(getByText('Recent')).toBeTruthy();
    expect(queryByText('TooOld')).toBeNull();
  });

  it('renders an empty state when there are no transactions', async () => {
    seed({ transactions: [] });
    const { getByText } = await renderHome();
    expect(getByText('No transactions')).toBeTruthy();
  });

  it('opens the transaction form for the tapped row, keyed by its id', async () => {
    seed({ transactions: [transaction({ id: 't-42', description: 'Coffee' })] });
    const { getByText } = await renderHome();

    await fireEvent.press(getByText('Coffee'));

    expect(navigation.navigate).toHaveBeenCalledWith('TransactionForm', { transactionId: 't-42' });
  });

  it('groups the list by day with Today/Yesterday separators, newest day first', async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    // Ordered newest-first as the repo query (orderBy time desc) delivers them.
    seed({
      transactions: [
        transaction({ id: 't1', time: now, description: 'TodayTxn' }),
        transaction({ id: 't2', time: now - day, description: 'YesterdayTxn' }),
      ],
    });
    const { getByText, getAllByText } = await renderHome();

    // Both day separators render.
    expect(getByText('Today')).toBeTruthy();
    expect(getByText('Yesterday')).toBeTruthy();

    // getAllByText returns matches in tree order, so the rendered order of the
    // separators and their rows proves the newest day (and its row) comes first.
    const rendered = getAllByText(/^(Today|TodayTxn|Yesterday|YesterdayTxn)$/).map(
      (node) => node.props.children,
    );
    expect(rendered).toEqual(['Today', 'TodayTxn', 'Yesterday', 'YesterdayTxn']);
  });

  it('keeps the gap above the first day-group header equal to the section gap (no doubled top pad)', async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    seed({
      transactions: [
        transaction({ id: 't1', time: now, description: 'TodayTxn' }),
        transaction({ id: 't2', time: now - day, description: 'YesterdayTxn' }),
      ],
    });
    const { getAllByTestId, getByTestId } = await renderHome();

    // The content column already sits `contentGap` below the pinned filter/sync
    // band via its own `gap`, so the FIRST day header must add NO top pad of its
    // own — otherwise the gap above the list reads larger than the equal gaps
    // between the filters row, the sync-progress bar, and the list.
    const contentGap = StyleSheet.flatten(getByTestId('home-content').props.style).gap;
    const headers = getAllByTestId('home-day-header');
    const first = StyleSheet.flatten(headers[0].props.style);
    const later = StyleSheet.flatten(headers[1].props.style);

    expect(first.paddingTop).toBe(0);
    // A later day header keeps its day-separator top pad, larger than the section gap.
    expect(later.paddingTop).toBeGreaterThan(contentGap);
  });

  it('renders an explicit DD.MM.YYYY date separator for an older day (not Today/Yesterday)', async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const older = now - 5 * day;
    const expectedHeader = formatDate(
      new Date(
        new Date(older).getFullYear(),
        new Date(older).getMonth(),
        new Date(older).getDate(),
      ),
    );
    seed({
      transactions: [transaction({ id: 't1', time: older, description: 'OldTxn' })],
    });
    const { getByText } = await renderHome();

    expect(getByText(expectedHeader)).toBeTruthy();
  });

  it('renders an empty state when a filter narrows the list to zero rows', async () => {
    seed({
      accounts: [MONOBANK, PRIVATBANK],
      transactions: [
        transaction({
          id: 't1',
          accountId: 'a',
          accountName: 'Monobank',
          category: 'food',
          description: 'Coffee',
        }),
        transaction({
          id: 't2',
          accountId: 'b',
          accountName: 'PrivatBank',
          category: 'transport',
          description: 'Groceries',
        }),
      ],
    });
    const { getByText, getByTestId } = await renderHome();

    await pressFilter(getByTestId, 'account-filter-menu', 'Monobank');
    await pressFilter(getByTestId, 'category-filter-menu', 'transport');

    expect(getByText('No transactions')).toBeTruthy();
  });

  it('reads accounts, holdings, rates, settings, then transactions in that order', async () => {
    await renderHome();
    const tablesInOrder = mockUseLiveQuery.mock.calls.slice(0, 5).map((call) => call[1][0]);
    expect(tablesInOrder).toEqual([
      'accounts',
      'holdings',
      'currency_rates',
      'settings',
      'transactions',
    ]);
  });

  it('clears the tab bar without double-counting the safe-area inset', async () => {
    const { getByTestId } = await renderHome();

    const listPadding = getByTestId('home-transactions').props.contentContainerStyle.paddingBottom;

    // The regression this guards: Home used to pass the FULL tab-bar height
    // as its own clearance on top of the bottom inset Screen's SafeAreaView
    // already reserves (see `home.screen.tsx`), leaving 130pt of dead space
    // under the last row instead of the 96pt every other screen has.
    expect(listPadding).toBe(resolveBottomClearance(MOCK_TAB_BAR_HEIGHT, MOCK_BOTTOM_INSET));

    // Total dead space under the last row must match every other screen's 96:
    // the SafeAreaView's 34 inset + Screen's own 16 base padding + this 46.
    expect(MOCK_BOTTOM_INSET + 16 + listPadding).toBe(96);
  });

  it('runs a full sync when the transaction list is pulled to refresh', async () => {
    const { getByTestId } = await renderHome();

    await act(async () => {
      getByTestId('home-transactions').props.refreshControl.props.onRefresh();
    });

    expect(mockSyncAll).toHaveBeenCalledTimes(1);
  });

  it('binds the native refresh control to the pull flag, not the global sync signal', async () => {
    // The spinner is the PULL GESTURE indicator alone: it reflects the hook's
    // pull flag, decoupled from the whole run.
    mockRefreshing.mockReturnValue(true);
    const { getByTestId } = await renderHome();

    expect(getByTestId('home-transactions').props.refreshControl.props.refreshing).toBe(true);
  });

  it('leaves the native refresh control idle when no pull is active', async () => {
    mockRefreshing.mockReturnValue(false);
    const { getByTestId } = await renderHome();

    expect(getByTestId('home-transactions').props.refreshControl.props.refreshing).toBe(false);
  });

  it('pins the sync progress bar above the list, not as a scrolling list header', async () => {
    mockUseSyncStatus.mockReturnValue(true);
    mockUseSyncProgress.mockReturnValue({ completed: 1, total: 3 });
    const { getByTestId, queryByTestId } = await renderHome();

    // The bar is a pinned sibling ABOVE the SectionList, so it renders while a
    // sync is in flight...
    expect(queryByTestId('sync-progress-bar')).not.toBeNull();
    // ...and it is NOT the list's scrolling header. As the header it would
    // scroll away with the content and draw behind the cells (the z-index
    // symptom); pinning it above the list subsumes that by construction.
    expect(getByTestId('home-transactions').props.ListHeaderComponent).toBeUndefined();
  });

  it('does not spin the pull control for an auto-sync-on-open (decoupled from isSyncing)', async () => {
    // An auto-sync-on-open lights the global sync signal but there is NO pull:
    // the native spinner must stay idle (the progress bar shows the auto-sync),
    // proving the spinner no longer mirrors `isSyncing`.
    mockUseSyncStatus.mockReturnValue(true);
    mockRefreshing.mockReturnValue(false);
    const { getByTestId } = await renderHome();

    expect(getByTestId('home-transactions').props.refreshControl.props.refreshing).toBe(false);
  });

  it('surfaces a message naming the accounts that failed to sync', async () => {
    mockUseSyncAll.mockReturnValue({
      failures: ['Binance', 'Cold storage'],
      syncAll: mockSyncAll,
    });
    const { getByText } = await renderHome();

    expect(getByText(/Binance/)).toBeTruthy();
    expect(getByText(/Cold storage/)).toBeTruthy();
  });
});

describe('HomeScreen — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seed({ transactions: [transaction()] });
    mockUseSyncAll.mockReturnValue({ failures: [], syncAll: mockSyncAll });
    mockUseSyncStatus.mockReturnValue(false);
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the net worth caption and the Today separator from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByText } = await renderHome();

    expect(getByText('Капітал')).toBeTruthy();
    expect(getByText('Сьогодні')).toBeTruthy();
  });

  it('renders the empty-transactions state from the Ukrainian catalog', async () => {
    seed({ transactions: [] });
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByText } = await renderHome();

    expect(getByText('Немає транзакцій')).toBeTruthy();
  });

  it('preserves an active default-category filter selection across a live language switch, relabeling the option to its Ukrainian catalog title', async () => {
    // The category filter's identity/matching keys on the STABLE
    // `categories.key` slug (`groceries`), not the resolved display title, so
    // switching the app language live must not reset the selection: the
    // option's stable value is unaffected, only its rendered LABEL changes.
    seed({
      transactions: [
        transaction({ id: 't1', category: 'groceries', description: 'Milk' }),
        transaction({ id: 't2', category: 'transport', description: 'Bus' }),
      ],
    });
    const { getByText, queryByText, getByTestId } = await renderHome();

    await pressFilter(getByTestId, 'category-filter-menu', 'groceries');
    expect(getByText('Milk')).toBeTruthy();
    expect(queryByText('Bus')).toBeNull();

    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    // The selection survived the language switch: the same transaction stays
    // filtered in/out — the Set was not silently cleared.
    expect(getByText('Milk')).toBeTruthy();
    expect(queryByText('Bus')).toBeNull();

    // The option itself now renders the Ukrainian catalog label, still keyed
    // on the same stable `groceries` value and still checked.
    await act(async () => {
      fireEvent.press(getByTestId('category-filter-menu'));
    });
    expect(
      getByTestId('category-filter-menu-option-groceries').props.accessibilityState?.checked,
    ).toBe(true);
    expect(getByText('Продукти')).toBeTruthy();
  });

  it('renders an exchange leg in the active language, resolved from its counterpart holding', async () => {
    // The leg persists NO description — only the counterpart's holding id — so
    // its label must be built at render time from the Ukrainian catalogue and
    // the counterpart's CURRENT name, never from a stored English sentence.
    seed({
      holdings: [
        UAH_HOLDING,
        { id: 'h-usd', name: 'Ощадний', accountId: 'a', currency: 'USD', balanceMinorUnits: 0 },
      ],
      transactions: [
        transaction({
          id: 'ex-out',
          amountMinorUnits: -1_000_000,
          description: '',
          exchangeCounterpartHoldingId: 'h-usd',
        }),
      ],
    });
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByText } = await renderHome();

    expect(getByText(i18n.t('transactions.exchangeTo', { name: 'Ощадний' }))).toBeTruthy();
  });
});
