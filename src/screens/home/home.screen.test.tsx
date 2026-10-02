// Wraps the REAL `groupByDay` in a spy-able `jest.fn` (never a stub) so a
// test can assert it is not called again on a re-render that should have
// stayed memo-stable, while every other test still gets its real grouping.
// `mockGroupByDay` is only referenced inside a CLOSURE created by the
// factory below, never dereferenced while the factory itself runs — the
// factory (and every module it requires) executes before this file's own
// `const` initializer does, so an immediate read here would see `undefined`.
const mockGroupByDay = jest.fn();

jest.mock('@kiko/transactions/group-by-day', () => {
  const actual = jest.requireActual('@kiko/transactions/group-by-day');

  return {
    ...actual,
    groupByDay: (...args: unknown[]) => {
      mockGroupByDay(...args);

      return actual.groupByDay(...args);
    },
  };
});

import { StyleSheet } from 'react-native';
import type { ComponentProps } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import { formatDate, defaultDateRange } from '@kiko/dates';
// Prefixed `mock*` so Jest's hoisted mock factory may reference it. Exposes the
// resolved MoneyText `tone` via a testID — see the module for the full rationale.
import mockTextTone from '@kiko/test-support/mock-text-tone';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { SEEDED_CATEGORIES } from '@kiko/db/__fixtures__/seeded-categories';
import { resolveBottomClearance } from '@kiko/design-system/components/screen';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import HomeScreen from './home.screen';

type HomeProps = ComponentProps<typeof HomeScreen>;

import { FILTER_ALL } from './transaction-filter-bar';

jest.mock('@kiko/design-system/components/text', () => ({
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

const mockUseIsFocused = jest.fn(() => true);
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => mockUseIsFocused(),
}));

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
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
// The ledger is read through three queries on the same tables; each mock query
// names its kind so `setLiveData` can answer it the way the real SQL would.
const mockListBetween = jest.fn();
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    listWithContextBetweenQuery: (...args: unknown[]) => {
      mockListBetween(...args);

      return { kind: 'rows', toSQL: () => ({ sql: '', params: [] }) };
    },
    contextSpanQuery: () => ({ kind: 'span', toSQL: () => ({ sql: '', params: [] }) }),
    contextCategoriesQuery: () => ({ kind: 'categories', toSQL: () => ({ sql: '', params: [] }) }),
    loanLedgerPaymentsQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
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
jest.mock('@kiko/monobank/sync-status', () => ({
  useSyncStatus: () => mockUseSyncStatus(),
  useSyncProgress: () => mockUseSyncProgress(),
}));

// The active-tab re-tap → scroll-to-top hook reads the navigation context, which
// a standalone screen render has none of; stand it in with a spy so this test
// can assert the screen hands it the transaction list's own ref.
const mockUseScrollToTopOnTabPress = jest.fn();
jest.mock('@kiko/navigation/use-scroll-to-top-on-tab-press', () => ({
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

type Account = {
  id: string;
  name: string;
  kind: string;
  archivedAt?: number | null;
  icon?: string | null;
  color?: string | null;
};
type Holding = {
  id?: string;
  name?: string;
  accountId: string;
  currency: string;
  balanceMinorUnits: number;
  closedAt?: number | null;
  type?: string;
  metadata?: unknown;
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
  // The whole ledger: what the span and the category filter are read from.
  transactions?: Transaction[];
  // The rows the windowed read returns; the whole ledger unless a test says
  // the database narrowed it to the picked range.
  windowRows?: Transaction[];
  categories?: Category[];
  // Per-table isLoading overrides, for the loading-gate tests only — every
  // key defaults to `false` (an already-resolved query), so every existing
  // call site above keeps behaving exactly as before.
  isLoading?: Partial<Record<string, boolean>>;
};

/**
 * Drive the five `useLiveQuery` calls by the table they subscribe to, so the
 * mock survives re-renders (a sequential once-chain returns undefined after the
 * first render and crashes on the next). Keyed data still exercises the exact
 * call order the screen must use — asserted separately below.
 */
const liveAnswersFor = (
  data: LiveData,
): ((query: { kind?: string }, tables: string[]) => { data: unknown[]; isLoading: boolean }) => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
    currency_rates: data.rates ?? [],
    settings: data.settings ?? [{ baseCurrency: 'UAH' }],
    transactions: data.transactions ?? [],
    // Default to the production-seeded rows so category resolution behaves as
    // it would on device unless a test overrides it (e.g. a rename).
    categories: data.categories ?? SEEDED_CATEGORIES,
    price_points: [],
  };
  const isLoadingByTable = data.isLoading ?? {};
  const ledger = data.transactions ?? [];
  const newestFirst = [...ledger].sort((first, second) => second.time - first.time);
  // What the database answers for the ledger's span and distinct categories.
  const spanRow = {
    count: ledger.length,
    earliest: ledger.length > 0 ? Math.min(...ledger.map((row) => row.time)) : null,
    latest: ledger.length > 0 ? Math.max(...ledger.map((row) => row.time)) : null,
  };
  const categoryRows = [...new Set(newestFirst.map((row) => row.category))].map((category) => ({
    category,
  }));
  const ledgerAnswers: Record<string, unknown[]> = {
    rows: data.windowRows ?? ledger,
    span: [spanRow],
    categories: categoryRows,
  };

  return (query, tables) => ({
    data:
      tables[0] === 'transactions' && tables.length === 3 && query.kind !== undefined
        ? ledgerAnswers[query.kind]
        : (byTable[tables[0]] ?? []),
    isLoading: isLoadingByTable[tables[0]] ?? false,
  });
};

const setLiveData = (data: LiveData): void => {
  mockUseLiveQuery.mockImplementation(liveAnswersFor(data));
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
    await fireEvent.press(getByTestId(menuTestID));
  });
  await act(async () => {
    await fireEvent.press(getByTestId(`${menuTestID}-option-${value}`));
  });
  await act(async () => {
    await fireEvent.press(getByTestId(`${menuTestID}-backdrop`));
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

  it('renders each transaction row as the shared solid Card surface (per the HIG audit)', async () => {
    const { getAllByTestId } = await renderHome();
    // Each row is wrapped in the shared content-layer `Card`, matching every
    // other content card's language, rather than a plain bordered list row.
    expect(getAllByTestId('transaction-row').length).toBeGreaterThan(0);
  });

  it('renders the transaction card with the shared solid surface token, regardless of Liquid Glass support', async () => {
    // The row is the shared solid content-layer `Card` — a flat `surface`
    // fill with a defined border (see `Card`'s own doc comment for why
    // content no longer routes through `GlassSurface`/Liquid Glass at all).
    // Unlike the old `GlassSurface translucentStrong bloom` combination, its
    // rendered tree is identical whether or not the device supports Liquid
    // Glass, so this asserts across BOTH `isLiquidGlassSupported` states.
    const { getByTestId: getByTestIdFallback } = await renderHome();
    const fallbackFill = StyleSheet.flatten(getByTestIdFallback('transaction-row').props.style);
    expect(fallbackFill.backgroundColor).toBe(darkTheme.colors.surface);

    try {
      liquidGlass.isLiquidGlassSupported = true;
      const { getByTestId } = await renderHome();
      const glassFill = StyleSheet.flatten(getByTestId('transaction-row').props.style);
      expect(glassFill.backgroundColor).toBe(darkTheme.colors.surface);
    } finally {
      liquidGlass.isLiquidGlassSupported = false;
    }
  });

  it('renders the transaction time as zero-padded HH:MM', async () => {
    // 2 days ago, at a fixed hour/minute — well inside the screen's default
    // last-30-days window, unlike a fixed historical date would be.
    const at = new Date(localDaysFrom(Date.now(), -2));
    at.setHours(9, 5, 0, 0);
    seed({ transactions: [transaction({ time: at.getTime() })] });
    const { getByText } = await renderHome();
    expect(getByText('09:05')).toBeTruthy();
  });

  it.each(['term_deposit', 'bond'])(
    'hides the HH:MM time on a %s row (deposits and bonds are not time-specific)',
    async (holdingType) => {
      const at = new Date(localDaysFrom(Date.now(), -2));
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
      await fireEvent.press(getByTestId('category-filter-menu'));
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

  // Net worth = assets − debt outstanding, so a debt
  // large enough goes the headline negative — MoneyText renders it with a
  // minus sign, colored `negative` (never `textPrimary`, the positive/zero
  // tone the two tests above assert).
  it('renders a negative net worth with a minus sign, toned negative, when debt outweighs assets', async () => {
    seed({
      holdings: [
        UAH_HOLDING, // 1,000.00 UAH asset
        {
          id: 'loan-1',
          accountId: 'a',
          currency: 'UAH',
          balanceMinorUnits: 0,
          type: 'loan',
          metadata: {
            kind: 'mortgage',
            principalMinorUnits: 500_000, // 5,000.00 UAH — no installment due yet
            startDate: Date.now(),
            annualRatePct: 10,
            termMonths: 120,
            schedule: 'annuity',
          },
        },
      ],
    });

    const { getAllByText } = await renderHome();

    // 1,000.00 asset − 5,000.00 debt = −4,000.00.
    const [netWorth] = getAllByText(/-4,000\.00 ₴/);
    expect(netWorth.props.testID).toBe('text-tone-negative');
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
      await fireEvent.press(getByTestId('account-filter-menu'));
    });

    expect(getByTestId('account-filter-menu-option-Monobank')).toBeTruthy();
    // Present despite having zero transactions...
    expect(getByTestId('account-filter-menu-option-PrivatBank')).toBeTruthy();
    // ...while the archived account is excluded.
    expect(queryByTestId('account-filter-menu-option-Closed')).toBeNull();
  });

  it('shows each account filter option with its stored icon, or its kind glyph, in its resolved color', async () => {
    seed({
      accounts: [
        { ...MONOBANK, icon: null, color: '' },
        { ...PRIVATBANK, icon: 'creditcard', color: darkTheme.colors.entityColors.violet },
      ],
    });
    const { getByTestId } = await renderHome();

    await act(async () => {
      await fireEvent.press(getByTestId('account-filter-menu'));
    });

    const kindGlyph = getByTestId('account-filter-menu-option-Monobank')
      .queryAll((node) => node.props.name === 'building.columns.fill')
      .at(0);
    const storedGlyph = getByTestId('account-filter-menu-option-PrivatBank')
      .queryAll((node) => node.props.name === 'creditcard')
      .at(0);

    expect(kindGlyph?.props.tintColor).toBe(darkTheme.colors.entityColors.white);
    expect(storedGlyph?.props.tintColor).toBe(darkTheme.colors.entityColors.violet);
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
      await fireEvent.press(getByTestId('category-filter-menu'));
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
      await fireEvent.press(getByTestId('category-filter-menu'));
    });
    await act(async () => {
      await fireEvent.press(getByTestId('category-filter-menu-option-dining'));
    });
    expect(queryByTestId('category-filter-menu-option-transport')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(getByTestId('category-filter-menu-option-transport'));
    });
    expect(queryByTestId('category-filter-menu-option-utilities')).toBeTruthy();

    // Dismiss and confirm both selections took effect.
    await act(async () => {
      await fireEvent.press(getByTestId('category-filter-menu-backdrop'));
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
      await fireEvent.press(getByTestId('category-filter-menu'));
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
    const recent = transaction({
      id: 't1',
      time: localDaysFrom(Date.now(), -2),
      description: 'Recent',
    });
    const tooOld = transaction({
      id: 't2',
      time: localDaysFrom(Date.now(), -40),
      description: 'TooOld',
    });
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

  // The ledger grows with every transaction ever synced and re-reads on every
  // write, so Home reads only the picked range's rows; the filter below it
  // still applies the same inclusive, day-aligned bounds.
  const dayStart = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayEnd = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - 1;

  it('reads the ledger window between the default range’s day-aligned bounds', async () => {
    seed();

    await renderHome();

    const range = defaultDateRange();

    expect(mockListBetween).toHaveBeenLastCalledWith(dayStart(range.from), dayEnd(range.to));
  });

  it('reads the ledger window of a picked range', async () => {
    // An older transaction sets the range's selectable floor below the pick.
    seed({ transactions: [transaction({ time: localDaysFrom(Date.now(), -40) })] });

    const { getByLabelText, getByTestId, getByText } = await renderHome();

    await act(async () => {
      await fireEvent.press(getByLabelText('Date range'));
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
      await fireEvent.press(getByText('Apply'));
    });

    // A first pick narrows the range to that one day.
    expect(mockListBetween).toHaveBeenLastCalledWith(dayStart(threeDaysAgo), dayEnd(threeDaysAgo));
  });

  it('keeps the date-range field’s selectable floor at the oldest transaction, though the window holds only recent rows', async () => {
    const oldest = localDaysFrom(Date.now(), -300);
    const recent = transaction({ id: 't1', time: localDaysFrom(Date.now(), -2) });
    seed({
      transactions: [recent, transaction({ id: 't2', time: oldest, description: 'Oldest' })],
      windowRows: [recent],
    });

    const { getByLabelText, getByTestId } = await renderHome();

    await act(async () => {
      await fireEvent.press(getByLabelText('Date range'));
    });

    const floor = new Date(oldest);
    const pad = (value: number): string => String(value).padStart(2, '0');

    expect((getByTestId('date-range-calendar').props as { minDate: string }).minDate).toBe(
      `${floor.getFullYear()}-${pad(floor.getMonth() + 1)}-${pad(floor.getDate())}`,
    );
  });

  it('lists a category only an older, out-of-window transaction holds in the category filter', async () => {
    const recent = transaction({
      id: 't1',
      time: localDaysFrom(Date.now(), -2),
      category: 'groceries',
    });
    const older = transaction({
      id: 't2',
      time: localDaysFrom(Date.now(), -200),
      category: 'transport',
    });
    seed({ transactions: [recent, older], windowRows: [recent] });

    const { getByTestId } = await renderHome();

    await act(async () => {
      await fireEvent.press(getByTestId('category-filter-menu'));
    });

    expect(getByTestId('category-filter-menu-option-transport')).toBeTruthy();
    expect(getByTestId('category-filter-menu-option-groceries')).toBeTruthy();
  });

  it('resets the date range to the 30-day default (not all-time) when Clear is pressed', async () => {
    const recent = transaction({
      id: 't1',
      time: localDaysFrom(Date.now(), -2),
      description: 'Recent',
    });
    const tooOld = transaction({
      id: 't2',
      time: localDaysFrom(Date.now(), -40),
      description: 'TooOld',
    });
    seed({ transactions: [recent, tooOld] });

    const { getByLabelText, getByTestId, getByText, queryByText } = await renderHome();

    // Narrow away from the 30-day default: the picker moves the bound nearer to
    // the pick, so picking 3 days ago pulls the `to` bound down to it. That
    // excludes both the "Recent" (2 days ago) and "TooOld" (40 days ago) rows.
    await act(async () => {
      await fireEvent.press(getByLabelText('Date range'));
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
      await fireEvent.press(getByText('Apply'));
    });
    expect(queryByText('Recent')).toBeNull();

    // Clearing must land back on the 30-day default, NOT on all-time: the
    // 40-day-old row stays excluded and the field shows the 30-day range again.
    await act(async () => {
      await fireEvent.press(getByLabelText('Date range'));
    });
    await act(async () => {
      await fireEvent.press(getByText('Clear'));
    });

    const range = defaultDateRange();
    expect(getByText(`${formatDate(range.from)} – ${formatDate(range.to)}`)).toBeTruthy();
    expect(getByText('Recent')).toBeTruthy();
    expect(queryByText('TooOld')).toBeNull();
  });

  // The default range used to be seeded once in a `useState` initializer, so
  // a tab that stayed mounted overnight kept showing yesterday's window and
  // silently dropped today's activity. The default must instead be derived
  // fresh from `now` on every render, matching the Statistics screen's own fix.
  it("advances the default range's end to include a transaction from the day after mount, once re-rendered", async () => {
    const base = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(base);

    // Calendar-day stepping (never `base + DAY_MS`), so the fixture lands on
    // the local day after mount even when the suite runs right at a local
    // midnight boundary.
    const dayAfterMount = new Date(base);
    dayAfterMount.setDate(dayAfterMount.getDate() + 1);
    dayAfterMount.setHours(1, 0, 0, 0);

    const tomorrow = transaction({
      id: 'tomorrow',
      time: dayAfterMount.getTime(),
      description: 'Tomorrow',
    });
    seed({ transactions: [tomorrow] });

    const { getByText, queryByText, rerender } = await renderHome();

    expect(queryByText('Tomorrow')).toBeNull();

    nowSpy.mockReturnValue(localDaysFrom(base, 1));
    await act(async () => {
      await rerender(
        <HomeScreen
          navigation={asNavigationProp<HomeProps['navigation']>(navigation)}
          route={asRouteProp<HomeProps['route']>('Home')}
        />,
      );
    });

    expect(getByText('Tomorrow')).toBeTruthy();

    nowSpy.mockRestore();
  });

  // The default range is re-derived from `now` every render (see the test
  // above), but `defaultDateRange` allocates fresh Date objects each call —
  // using those objects directly as a dependency for the transaction
  // filter/group memo made it (and the SectionList it feeds) rebuild on
  // EVERY render, not just a day change. `groupByDay` (the section builder)
  // must not run again on a re-render that does not change the day.
  it('does not re-run the section grouping on a re-render on the same day', async () => {
    const recent = transaction({
      id: 't1',
      time: localDaysFrom(Date.now(), -2),
      description: 'Recent',
    });
    seed({ transactions: [recent] });

    mockGroupByDay.mockClear();

    const { rerender } = await renderHome();
    const callsAfterMount = mockGroupByDay.mock.calls.length;

    await act(async () => {
      await rerender(
        <HomeScreen
          navigation={asNavigationProp<HomeProps['navigation']>(navigation)}
          route={asRouteProp<HomeProps['route']>('Home')}
        />,
      );
    });

    expect(mockGroupByDay.mock.calls.length).toBe(callsAfterMount);
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
    const now = Date.now();
    // Ordered newest-first as the repo query (orderBy time desc) delivers them.
    seed({
      transactions: [
        transaction({ id: 't1', time: now, description: 'TodayTxn' }),
        transaction({ id: 't2', time: localDaysFrom(now, -1), description: 'YesterdayTxn' }),
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
    const now = Date.now();
    seed({
      transactions: [
        transaction({ id: 't1', time: now, description: 'TodayTxn' }),
        transaction({ id: 't2', time: localDaysFrom(now, -1), description: 'YesterdayTxn' }),
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
    const older = localDaysFrom(Date.now(), -5);
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

  it('reads accounts, holdings, rates, prices with the linked loan payments, settings, then the ledger window, its span and its categories in that order', async () => {
    await renderHome();
    const tablesInOrder = mockUseLiveQuery.mock.calls.slice(0, 9).map((call) => call[1].join(','));
    expect(tablesInOrder).toEqual([
      'accounts',
      'holdings',
      'currency_rates',
      'price_points',
      'transactions,holdings',
      'settings',
      'transactions,holdings,accounts',
      'transactions,holdings,accounts',
      'transactions,holdings,accounts',
    ]);
    expect(
      mockUseLiveQuery.mock.calls.slice(6, 9).map((call) => (call[0] as { kind: string }).kind),
    ).toEqual(['rows', 'span', 'categories']);
  });

  // kiko-architecture: no request or query for data the user does not have —
  // usePriceBook's price_points read is disabled while nothing on Home is a
  // priced type (property_item/metal) or a loan.
  it('gates the price_points read on whether any holding ever reads it', async () => {
    setLiveData({ holdings: [{ ...UAH_HOLDING, type: 'card' }] });
    await renderHome();
    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(false);
  });

  it('enables the price_points read once a priced holding is present', async () => {
    setLiveData({ holdings: [{ ...UAH_HOLDING, type: 'metal' }] });
    await renderHome();
    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });

  it('reads price_points in parallel while holdings are still on their first load', async () => {
    setLiveData({ isLoading: { holdings: true } });
    await renderHome();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });

  // Only a loan reads its linked payments, so a priced-only Home never runs
  // the linked-payments read.
  it('reads the linked loan payments only once a loan is present', async () => {
    const loanPaymentsCall = () =>
      mockUseLiveQuery.mock.calls.find((call) => call[1].join(',') === 'transactions,holdings');

    setLiveData({ holdings: [{ ...UAH_HOLDING, type: 'metal' }] });
    await renderHome();
    expect(loanPaymentsCall()?.[2]).toBe(false);

    mockUseLiveQuery.mockClear();
    setLiveData({ holdings: [{ ...UAH_HOLDING, type: 'loan' }] });
    await renderHome();
    expect(loanPaymentsCall()?.[2]).toBe(true);
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

describe('HomeScreen — loading gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSyncAll.mockReturnValue({ failures: [], syncAll: mockSyncAll });
    mockUseSyncStatus.mockReturnValue(false);
    mockRefreshing.mockReturnValue(false);
  });

  it('shows a loading spinner, not the net-worth zero or the empty-transactions text, while any of its own queries is on its first load', async () => {
    seed({ transactions: [], isLoading: { holdings: true } });

    const { getByTestId, queryByTestId, queryByText } = await renderHome();

    expect(getByTestId('home-loading')).toBeTruthy();
    expect(queryByTestId('home-content')).toBeNull();
    expect(queryByText(/0\.00 ₴/)).toBeNull();
    expect(queryByText(i18n.t('home.emptyTransactions'))).toBeNull();
  });

  it('still shows the sync progress bar and keeps pull-to-refresh available while loading', async () => {
    // The sync this screen's own first read is queued behind — the user must
    // still see it running, and must still be able to trigger a fresh pull,
    // while this screen's own queries have not settled yet.
    mockUseSyncStatus.mockReturnValue(true);
    mockUseSyncProgress.mockReturnValue({ completed: 1, total: 3 });
    mockRefreshing.mockReturnValue(false);
    seed({ transactions: [], isLoading: { holdings: true } });

    const { getByTestId } = await renderHome();

    expect(getByTestId('sync-progress-bar')).toBeTruthy();
    expect(getByTestId('home-loading-scroll').props.refreshControl).toBeTruthy();
  });

  it('renders the real content once every query has loaded', async () => {
    seed({ transactions: [transaction()] });

    const { getByTestId, getByText, queryByTestId } = await renderHome();

    expect(getByTestId('home-content')).toBeTruthy();
    expect(getByText('Coffee')).toBeTruthy();
    expect(queryByTestId('home-loading')).toBeNull();
  });

  it('withholds pull-to-refresh in the loading branch while the accounts query itself is still loading (syncAll would fan out over zero accounts)', async () => {
    seed({ transactions: [], isLoading: { accounts: true } });

    const { getByTestId } = await renderHome();

    expect(getByTestId('home-loading-scroll').props.refreshControl).toBeFalsy();
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
      await fireEvent.press(getByTestId('category-filter-menu'));
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

// Home stays mounted under the native tab bar, so while another tab or a form
// shows it keeps its subscriptions but defers every read: a write elsewhere
// marks each query dirty and costs no read, no state change and no memo work
// here — `paused`, not `enabled`, which would unsubscribe and drop to `[]`
// (see kiko-architecture's `paused` vs `enabled`).
describe('HomeScreen — paused while hidden', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseIsFocused.mockReturnValue(true);
    mockUseSyncAll.mockReturnValue({ failures: [], syncAll: mockSyncAll });
    mockUseSyncStatus.mockReturnValue(false);
    mockRefreshing.mockReturnValue(false);
  });

  afterEach(() => {
    mockUseIsFocused.mockReturnValue(true);
  });

  it('pauses every live query while unfocused, keeping the cache option and the enabled argument', async () => {
    mockUseIsFocused.mockReturnValue(false);
    seed({ holdings: [{ ...UAH_HOLDING, type: 'metal' }] });

    await renderHome();

    expect(mockUseLiveQuery.mock.calls.length).toBeGreaterThan(0);

    for (const call of mockUseLiveQuery.mock.calls) {
      expect(call[3]).toEqual({ cached: true, paused: true });
    }

    expect(mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points')?.[2]).toBe(
      true,
    );
  });

  it('leaves every live query unpaused while focused', async () => {
    seed();

    await renderHome();

    for (const call of mockUseLiveQuery.mock.calls) {
      expect(call[3]).toEqual({ cached: true, paused: false });
    }
  });

  // Mirrors use-live-query.ts's own paused/dirty contract: a call made with
  // `paused: true` never applies a pending write; the first call made with
  // `paused: false` applies it, so a screen sees new data exactly when the
  // real hook would have read it.
  const pausedAwareLiveData = (initial: LiveData) => {
    let committed = initial;
    let pending: LiveData | undefined;

    mockUseLiveQuery.mockImplementation(
      (
        query: { kind?: string },
        tables: string[],
        _enabled: boolean,
        options?: { paused?: boolean },
      ) => {
        if (!(options?.paused ?? false) && pending !== undefined) {
          committed = pending;
          pending = undefined;
        }

        return liveAnswersFor(committed)(query, tables);
      },
    );

    return {
      writeWhileHidden: (next: LiveData): void => {
        pending = next;
      },
    };
  };

  it('shows a transaction written while hidden once the tab regains focus, and not before', async () => {
    const base: LiveData = {
      accounts: [MONOBANK],
      holdings: [UAH_HOLDING],
      transactions: [transaction({ id: 't1', description: 'Coffee' })],
    };
    const stub = pausedAwareLiveData(base);
    // A fresh element per render: React skips a re-render for the same element.
    const element = () => (
      <HomeScreen
        navigation={asNavigationProp<HomeProps['navigation']>(navigation)}
        route={asRouteProp<HomeProps['route']>('Home')}
      />
    );

    const { getByText, queryByText, rerender } = await render(element());
    expect(getByText('Coffee')).toBeTruthy();

    mockUseIsFocused.mockReturnValue(false);
    await act(async () => {
      await rerender(element());
    });

    stub.writeWhileHidden({
      ...base,
      transactions: [
        transaction({ id: 't1', description: 'Coffee' }),
        transaction({ id: 't2', description: 'Tea', time: Date.now() + 1 }),
      ],
    });
    await act(async () => {
      await rerender(element());
    });
    expect(queryByText('Tea')).toBeNull();

    mockUseIsFocused.mockReturnValue(true);
    await act(async () => {
      await rerender(element());
    });
    expect(getByText('Tea')).toBeTruthy();
    expect(getByText('Coffee')).toBeTruthy();
  });
});
