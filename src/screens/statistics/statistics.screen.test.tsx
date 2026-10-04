// The rate-history repo opens the op-sqlite connection at module load (it is
// imported for real so `rateTableAt`, which `buildNetWorthSeries` calls, stays
// the real implementation). Stub the native module so it loads without a
// database, mirroring the net-worth-series builder test.
// The backfill orchestration reaches the network. Keep the pure helpers
// (`missingDays`, `deriveLastBackfilledDay`) real, but stub `runBackfill` with a
// never-resolving promise so the screen's mount effect leaves the line in its
// `loading` state without hitting NBU/CoinGecko.
const mockRunBackfill = jest.fn(
  (..._args: unknown[]): Promise<BackfillStatus> => new Promise<never>(() => {}),
);

jest.mock('@kiko/rates/history-backfill', () => {
  const actual = jest.requireActual('@kiko/rates/history-backfill');

  return { ...actual, runBackfill: (...args: unknown[]) => mockRunBackfill(...args) };
});

// Spies on the real builder (kept working, unlike `runBackfill` above) so a
// paused-while-hidden test can pin exactly how many times the heavy net-worth
// recompute ran, without also having to fake its own math.
const mockBuildNetWorthSeries = jest.fn();

jest.mock('@kiko/statistics/net-worth-series', () => {
  const actual = jest.requireActual('@kiko/statistics/net-worth-series');

  return {
    ...actual,
    buildNetWorthSeries: (...args: unknown[]) => {
      mockBuildNetWorthSeries(...args);

      return actual.buildNetWorthSeries(...args);
    },
  };
});

// A standalone screen render has no real navigation focus context; default
// focused (matches every other test in this file), overridden per test.
const mockUseIsFocused = jest.fn(() => true);

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => mockUseIsFocused(),
}));

import { i18n } from '@kiko/i18n/init';
import { toUtcMidnight } from '@kiko/rates/history-entry';
import type { TrendFilter } from '@kiko/statistics/trend-filter';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import type { BackfillStatus } from '@kiko/rates/history-backfill';
import { categoryColor } from '@kiko/statistics/category-breakdown';
import { DAY_MS, formatDate, startOfLocalDay, defaultDateRange } from '@kiko/dates';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import { FILTER_ALL } from '@kiko/design-system/components/filter-menu';

import StatisticsScreen from './statistics.screen';

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
const mockSetTrendFilter = jest.fn();
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setTrendFilter: (...args: unknown[]) => mockSetTrendFilter(...args),
  },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    listAllQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    loanLedgerPaymentsQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

// The active-tab re-tap → scroll-to-top hook reads the navigation context, which
// a standalone screen render lacks; stand it in with a spy so this test can
// assert the screen hands it the scroll view's own ref.
const mockUseScrollToTopOnTabPress = jest.fn();
jest.mock('@kiko/navigation/use-scroll-to-top-on-tab-press', () => ({
  useScrollToTopOnTabPress: (ref: unknown, scrollOffset: unknown) =>
    mockUseScrollToTopOnTabPress(ref, scrollOffset),
}));

// useFocusRefreshedNow also reads the navigation context (useFocusEffect) via
// the same real-context requirement as the hook above; a standalone screen
// render has none, so stand it in with a `useState`-seeded read, STABLE across
// an ordinary re-render (matching the real hook's own "only a re-focus
// advances it" contract) but externally advanceable via `advanceFocusedNow`
// (below) for the tests that simulate a refocus.
let mockNow = Date.now();
const mockNowListeners = new Set<(value: number) => void>();

// Simulates a real focus event's `setNow(Date.now())`: advances every
// currently-mounted `useFocusRefreshedNow` instance, wrapped in `act` by the
// caller.
const advanceFocusedNow = (value: number): void => {
  mockNow = value;
  mockNowListeners.forEach((listener) => {
    listener(value);
  });
};

jest.mock('@kiko/design-system/use-focus-refreshed-now/use-focus-refreshed-now', () => {
  const { useEffect, useState } = jest.requireActual('react');

  return {
    useFocusRefreshedNow: () => {
      const [now, setNow] = useState(() => mockNow);

      useEffect(() => {
        mockNowListeners.add(setNow);

        return () => mockNowListeners.delete(setNow);
      }, [setNow]);

      return now;
    },
  };
});

type Account = {
  id: string;
  name: string;
  kind?: 'bank' | 'cash' | 'crypto' | 'property' | 'debt';
  icon?: string | null;
  color?: string | null;
  archivedAt?: number | null;
};
type Holding = {
  id: string;
  accountId: string;
  currency: string;
  type: string;
  balanceMinorUnits: number;
  metadata?: unknown;
  closedAt?: number | null;
};
type Rate = { base: string; quote: string; rate: string };
type Settings = { baseCurrency: string; trendFilter?: TrendFilter | null };
type Transaction = {
  id: string;
  holdingId: string;
  time: number;
  amountMinorUnits: number;
  category?: string | null;
  mcc?: number | null;
  counterIban?: string | null;
  exchangeCounterpartHoldingId?: string | null;
  loanHoldingId?: string | null;
};
type CategoryRow = { key: string; title: string; icon: string };
type HistoryRow = { base: string; quote: string; day: number; rate: string; source?: string };
type LiveData = {
  accounts?: Account[];
  holdings?: Holding[];
  rates?: Rate[];
  settings?: Settings[];
  transactions?: Transaction[];
  history?: HistoryRow[];
  categories?: CategoryRow[];
  // Per-table isLoading overrides, for the loading-gate tests only — every
  // key defaults to `false` (an already-resolved query), so every existing
  // call site above keeps behaving exactly as before.
  isLoading?: Partial<Record<string, boolean>>;
  // Per-table cached-rows overrides: `true` = the table still shows the cached
  // rows of a cached display mount, before its own fresh read has applied.
  isCached?: Partial<Record<string, boolean>>;
};

// Shared by `setLiveData` below and by the paused-while-hidden describe
// block's own read-tracking stub — one place maps a `LiveData` fixture onto
// the table keys `useLiveQuery` calls key off, so both stay in sync.
const buildLiveDataByTable = (data: LiveData): Record<string, unknown[]> => ({
  accounts: data.accounts ?? [],
  holdings: data.holdings ?? [],
  currency_rates: data.rates ?? [],
  settings: data.settings ?? [{ baseCurrency: 'UAH' }],
  // SQLite returns NULL, never undefined, for a column a row does not set, so
  // default every nullable marker the screen reads the same way — an
  // `undefined` here would be a fixture artefact the device never produces.
  transactions: (data.transactions ?? []).map((row) => ({
    exchangeCounterpartHoldingId: null,
    loanHoldingId: null,
    ...row,
  })),
  currency_rate_history: data.history ?? [],
  categories: data.categories ?? [],
  price_points: [],
});

// Feed each `useLiveQuery` call by the first table name it watches — the screen's
// queries each key off a distinct table.
const setLiveData = (data: LiveData): void => {
  const byTable = buildLiveDataByTable(data);
  const isLoadingByTable = data.isLoading ?? {};
  const isCachedByTable = data.isCached ?? {};

  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => {
    const isLoading = isLoadingByTable[tables[0]] ?? false;

    return {
      data: byTable[tables[0]] ?? [],
      isLoading,
      isFresh: !isLoading && !(isCachedByTable[tables[0]] ?? false),
    };
  });
};

const now = Date.now();

const CASH: Account = { id: 'a', name: 'Cash', kind: 'cash', color: null };
const BANK: Account = { id: 'b', name: 'Bank', kind: 'bank', color: null };

const UAH_HOLDING: Holding = {
  id: 'h1',
  accountId: 'a',
  currency: 'UAH',
  type: 'cash',
  balanceMinorUnits: 100_000,
  metadata: null,
  closedAt: null,
};
const USD_HOLDING: Holding = {
  id: 'h2',
  accountId: 'b',
  currency: 'USD',
  type: 'card',
  balanceMinorUnits: 5_000,
  metadata: null,
  closedAt: null,
};

// A second UAH card, so a card-to-card self-transfer has two DIFFERENT holdings
// to move between (both in the UAH base, so no rate is needed to reach it).
const UAH_HOLDING_2: Holding = {
  id: 'h3',
  accountId: 'a',
  currency: 'UAH',
  type: 'card',
  balanceMinorUnits: 0,
  metadata: null,
  closedAt: null,
};

// USD converts to the UAH base so the Bank account (a `card`) contributes to the
// pie and its own by-type bar.
const USD_UAH_RATE: Rate = { base: 'USD', quote: 'UAH', rate: '40' };

const TRANSACTIONS: Transaction[] = [
  { id: 't1', holdingId: 'h1', time: localDaysFrom(now, -3), amountMinorUnits: 50_000 },
  { id: 't2', holdingId: 'h1', time: localDaysFrom(now, -1), amountMinorUnits: 50_000 },
  { id: 't3', holdingId: 'h2', time: localDaysFrom(now, -3), amountMinorUnits: 5_000 },
];

// A historical USD->UAH row dated before the transaction span, so `rateTableAt`
// carries it forward to every bucket and the net-worth line has points to draw.
const HISTORY: HistoryRow[] = [
  { base: 'USD', quote: 'UAH', day: toUtcMidnight(now) - 5 * DAY_MS, rate: '40', source: 'nbu' },
];

const seedFull = (): void =>
  setLiveData({
    accounts: [CASH, BANK],
    holdings: [UAH_HOLDING, USD_HOLDING],
    rates: [USD_UAH_RATE],
    transactions: TRANSACTIONS,
    history: HISTORY,
  });

const CATEGORIES: CategoryRow[] = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transport', title: 'Transport', icon: 'car' },
  { key: 'transfers', title: 'Transfers', icon: 'arrow.left.arrow.right' },
];

// Expenses are NEGATIVE amounts; the spending pie sums their magnitude by
// category. Both sit on the UAH holding under the Cash account, so no rate is
// needed to reach the UAH base.
const EXPENSES: Transaction[] = [
  {
    id: 'e1',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -300_00,
    category: 'groceries',
  },
  {
    id: 'e2',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -100_00,
    category: 'transport',
  },
];

// A dataset whose spending pie is non-empty: the two categorized expenses plus
// the categories that name them.
const seedSpending = (): void =>
  setLiveData({
    accounts: [CASH, BANK],
    holdings: [UAH_HOLDING, USD_HOLDING],
    rates: [USD_UAH_RATE],
    transactions: EXPENSES,
    history: HISTORY,
    categories: CATEGORIES,
  });

// Three categorized expenses (groceries 300 > transport 100 > transfers 50), so
// the trend chart's top-3-by-spend preset selects ALL three categories and the
// filter reads "Categories · 3". None is an internal transfer (no matching
// credit leg, no mcc/description/exchange marker), so all three survive as
// spending.
const THREE_EXPENSES: Transaction[] = [
  {
    id: 'x1',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -300_00,
    category: 'groceries',
  },
  {
    id: 'x2',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -100_00,
    category: 'transport',
  },
  {
    id: 'x3',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -50_00,
    category: 'transfers',
  },
];

// The three-category spending dataset (groceries 300 > transport 100 >
// transfers 50), with an optional SAVED trend filter seeded onto the single
// settings row (null = no saved filter, falls back to the default).
const seedTrend = (trendFilter: TrendFilter | null): void =>
  setLiveData({
    accounts: [CASH, BANK],
    holdings: [UAH_HOLDING, USD_HOLDING],
    rates: [USD_UAH_RATE],
    transactions: THREE_EXPENSES,
    history: HISTORY,
    categories: CATEGORIES,
    settings: [{ baseCurrency: 'UAH', trendFilter }],
  });

// The two legs of a card-to-card self-transfer: a categorized debit on one UAH
// card and its equal-and-opposite credit on another, timestamped the same
// instant. The debit leg would otherwise surface as a "Transfers" spending slice
// even though no money left the user's own holdings.
const SELF_TRANSFER: Transaction[] = [
  {
    id: 'st-out',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -200_00,
    category: 'transfers',
  },
  {
    id: 'st-in',
    holdingId: 'h3',
    time: localDaysFrom(now, -2),
    amountMinorUnits: 200_00,
    category: 'transfers',
  },
];

// The spending dataset plus a self-transfer pair, so the category pie can be
// asserted to drop the transfer while keeping the genuine expenses.
const seedSpendingWithTransfer = (): void =>
  setLiveData({
    accounts: [CASH, BANK],
    holdings: [UAH_HOLDING, USD_HOLDING, UAH_HOLDING_2],
    rates: [USD_UAH_RATE],
    transactions: [...EXPENSES, ...SELF_TRANSFER],
    history: HISTORY,
    categories: CATEGORIES,
  });

// A UAH card whose stored metadata carries the user's OWN IBAN, so a 4829
// transfer whose counterIban matches it reads as an own-account transfer.
const OWN_IBAN = 'UA-OWN-CARD';
const UAH_OWN_CARD: Holding = {
  id: 'h4',
  accountId: 'a',
  currency: 'UAH',
  type: 'card',
  balanceMinorUnits: 0,
  metadata: { iban: OWN_IBAN },
  closedAt: null,
};

const CASH_CATEGORY: CategoryRow = { key: 'cash', title: 'Cash', icon: 'banknote' };

// The seeded catch-all a null category folds onto (DEFAULT_CATEGORY_KEY), so an
// unexcluded exchange leg would render its wedge under this key.
const OTHER_CATEGORY: CategoryRow = { key: 'other', title: 'Other', icon: 'ellipsis' };

// MCC-classified movements that the pie must drop by rule (not by matched pair):
//   - a cash-out (mcc 6011), always excluded — categorized 'cash' so its absence
//     from the pie is observable;
//   - an own-account transfer (mcc 4829) to the user's OWN card IBAN, excluded;
//   - a genuine P2P payment (mcc 4829) to a THIRD-PARTY IBAN, KEPT as spending.
const MCC_MOVEMENTS: Transaction[] = [
  {
    id: 'm-cash',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -500_00,
    category: 'cash',
    mcc: 6011,
    counterIban: null,
  },
  {
    id: 'm-own',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -200_00,
    category: 'transfers',
    mcc: 4829,
    counterIban: OWN_IBAN,
  },
  {
    id: 'm-p2p',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -150_00,
    category: 'transfers',
    mcc: 4829,
    counterIban: 'UA-SOMEONE-ELSE',
  },
];

// The two legs of a CROSS-CURRENCY exchange: 10,000.00 UAH out of the UAH cash
// holding and 240.00 USD into the USD card, each carrying the OTHER leg's
// holding id as its structural marker and no description. No other exclusion
// rule can see this pair — the legs have a null mcc, an empty description, and
// two DIFFERENT currencies, which the matched-pair matcher rejects — so without
// the marker rule the debit surfaces as a full-pie 'other' spending wedge.
const EXCHANGE_LEGS: Transaction[] = [
  {
    id: 'ex-out',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -10_000_00,
    category: null,
    exchangeCounterpartHoldingId: 'h2',
  },
  {
    id: 'ex-in',
    holdingId: 'h2',
    time: localDaysFrom(now, -2),
    amountMinorUnits: 240_00,
    category: null,
    exchangeCounterpartHoldingId: 'h1',
  },
];

const seedSpendingWithExchange = (): void =>
  setLiveData({
    accounts: [CASH, BANK],
    holdings: [UAH_HOLDING, USD_HOLDING],
    rates: [USD_UAH_RATE],
    transactions: [...EXPENSES, ...EXCHANGE_LEGS],
    history: HISTORY,
    categories: [...CATEGORIES, OTHER_CATEGORY],
  });

// A CROSS-CURRENCY Convert: the user's original, already-CATEGORIZED manual
// expense (in UAH) plus the counterpart leg the convert recorded (in USD). The
// repository marks BOTH — the existing row too — so the original expense leaves
// the pie with its counterpart instead of lingering under its own category.
const CONVERT_LEGS: Transaction[] = [
  {
    id: 'cv-existing',
    holdingId: 'h1',
    time: localDaysFrom(now, -2),
    amountMinorUnits: -10_000_00,
    category: 'transport',
    exchangeCounterpartHoldingId: 'h2',
  },
  {
    id: 'cv-new',
    holdingId: 'h2',
    time: localDaysFrom(now, -2),
    amountMinorUnits: 240_00,
    category: null,
    exchangeCounterpartHoldingId: 'h1',
  },
];

const seedSpendingWithConvert = (): void =>
  setLiveData({
    accounts: [CASH, BANK],
    holdings: [UAH_HOLDING, USD_HOLDING],
    rates: [USD_UAH_RATE],
    // Only the groceries expense is real spending here; the transport-labelled
    // row is the converted leg.
    transactions: [EXPENSES[0], ...CONVERT_LEGS],
    history: HISTORY,
    categories: [...CATEGORIES, OTHER_CATEGORY],
  });

const seedSpendingWithMccMovements = (): void =>
  setLiveData({
    accounts: [CASH, BANK],
    holdings: [UAH_HOLDING, USD_HOLDING, UAH_OWN_CARD],
    rates: [USD_UAH_RATE],
    transactions: [...EXPENSES, ...MCC_MOVEMENTS],
    history: HISTORY,
    categories: [...CATEGORIES, CASH_CATEGORY],
  });

const renderScreen = (): ReturnType<typeof render> => render(<StatisticsScreen />);

// Open one filter menu, tap an option row, then dismiss via the backdrop.
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

const ACCOUNT_FILTER = 'statistics-account-filter';
const CATEGORY_FILTER = 'statistics-category-filter';

// A rendered tree node, as `render(...).toJSON()` returns it (host elements
// only — composite components are already resolved away).
type JSONNode = {
  type: string;
  props: Record<string, unknown>;
  children: (JSONNode | string)[] | null;
};

// Every host node in the tree, in PRE-ORDER (a node before its own children,
// each child before its next sibling) — the same order the tree paints in on
// screen, top to bottom. Used to assert one element renders visually ABOVE
// another without depending on how many host `View`s a design-system
// component happens to wrap its content in.
const flattenPreOrder = (node: JSONNode): JSONNode[] => [
  node,
  ...(node.children ?? []).flatMap((child) =>
    typeof child === 'string' ? [] : flattenPreOrder(child),
  ),
];

const renderOrder = (root: Awaited<ReturnType<typeof render>>): JSONNode[] => {
  const tree = root.toJSON();

  if (tree === null) {
    return [];
  }

  return (Array.isArray(tree) ? tree : [tree]).flatMap(flattenPreOrder);
};

// The element type a RNTL query returns (its bundled test-renderer instance),
// derived from the query signature so no react-test-renderer dependency is
// imported just for the annotation.
type QueryNode = ReturnType<Awaited<ReturnType<typeof render>>['getByTestId']>;

// The SFSymbolView glyph carrying `name` inside a given SelectableRow option
// row — the filter option's icon no longer carries an accessibilityLabel (it
// renders through the shared SelectableRow), so it is read off the host node
// carrying that symbol name, scoped to the row from getByTestId.
const optionGlyph = (row: QueryNode, name: string): QueryNode | undefined =>
  row.queryAll((node) => node.props.name === name).at(0);

describe('StatisticsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedFull();
  });

  it('wires its scroll view to scroll to top on an active-tab re-tap', async () => {
    await renderScreen();

    expect(mockUseScrollToTopOnTabPress).toHaveBeenCalled();
    // The ref handed to the hook is the SAME one the Screen mounts on its
    // ScrollView — after render it resolves to that live scroll view, so an
    // active-tab re-tap has a real scrollable to return to the top. The screen
    // re-renders as its backfill status settles, so read the latest call's ref.
    const scrollRef = mockUseScrollToTopOnTabPress.mock.calls.at(-1)?.[0];
    expect(typeof scrollRef?.current?.scrollTo).toBe('function');
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

    await renderScreen();

    const lastCall = mockUseScrollToTopOnTabPress.mock.calls.at(-1);
    expect(offsetSpy).toHaveBeenCalledWith(lastCall?.[0]);
    expect(lastCall?.[1]).toBe(offsetSpy.mock.results.at(-1)?.value);

    offsetSpy.mockRestore();
  });

  it('renders the five blocks in order: net-worth line, by-type bar, account pie, category pie, spending trend', async () => {
    const { getByTestId } = await renderScreen();

    const order = getByTestId('statistics-blocks')
      .children.map((child) => (typeof child === 'string' ? undefined : child.props.testID))
      .filter((id): id is string => typeof id === 'string' && id.startsWith('statistics-block-'));

    // The net-worth line leads the screen, ahead of the by-type/category
    // charts — it is the one chart every other block on this screen relates
    // back to (a snapshot of the same net worth it plots over time). The
    // spending-trend line closes the screen, after the category donut it shares
    // its category filter's dimension with.
    expect(order).toEqual([
      'statistics-block-line',
      'statistics-block-bar',
      'statistics-block-pie',
      'statistics-block-category',
      'statistics-block-trend',
    ]);
  });

  it('renders a by-type bar, the net-worth polyline, and a pie arc per account', async () => {
    const { getByTestId, getAllByTestId } = await renderScreen();

    expect(getByTestId('bar-chart-bar-cash')).toBeTruthy();
    expect(getByTestId('bar-chart-bar-card')).toBeTruthy();
    expect(getAllByTestId(/^net-worth-line-polyline-/).length).toBeGreaterThan(0);
    expect(getByTestId('pie-chart-arc-a')).toBeTruthy();
    expect(getByTestId('pie-chart-arc-b')).toBeTruthy();
  });

  describe('Debts total', () => {
    it('renders no Debts total under the account pie when there is no loan holding', async () => {
      const { queryByTestId } = await renderScreen();
      expect(queryByTestId('statistics-debts-total')).toBeNull();
    });

    it('renders the Debts total under the account pie, negative, excluded from the pie itself', async () => {
      setLiveData({
        accounts: [CASH, BANK, { id: 'd', name: 'Mortgage', kind: 'bank' }],
        holdings: [
          UAH_HOLDING,
          USD_HOLDING,
          {
            id: 'loan-1',
            accountId: 'd',
            currency: 'UAH',
            type: 'loan',
            balanceMinorUnits: 0,
            metadata: {
              kind: 'mortgage',
              principalMinorUnits: 500_000, // 5,000.00 UAH
              startDate: Date.now(),
              annualRatePct: 10,
              termMonths: 120,
              schedule: 'annuity',
            },
            closedAt: null,
          },
        ],
        rates: [USD_UAH_RATE],
        transactions: TRANSACTIONS,
        history: HISTORY,
      });

      const { getByTestId, queryByTestId } = await renderScreen();

      const debtsTotal = getByTestId('statistics-debts-total');
      expect(within(debtsTotal).getByText(/-5,000\.00 ₴/)).toBeTruthy();
      // A loan just started (no installment due yet) has no OTHER pie
      // contribution of its own to worry about, but the account it lives
      // under must still not get a negative slice.
      expect(queryByTestId('pie-chart-arc-d')).toBeNull();
    });
  });

  it('shows the net-worth line loading state while history is empty and the backfill runs', async () => {
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [],
    });

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(mockRunBackfill).toHaveBeenCalled();
    expect(getByTestId('net-worth-line-loading')).toBeTruthy();
    expect(queryByTestId(/^net-worth-line-polyline-/)).toBeNull();
  });

  it('does not run the backfill while history is still on its own first load (only transactions have settled)', async () => {
    // Once `transactions` has loaded but `currency_rate_history` has not, an
    // empty `historyRows` reads identically to "nothing backfilled yet" —
    // without the `historyLoading` guard the effect would re-fetch and
    // re-write the whole span on first open, adding to the app-open DB burst.
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [],
      isLoading: { currency_rate_history: true },
    });

    await renderScreen();

    expect(mockRunBackfill).not.toHaveBeenCalled();
  });

  it('runs the backfill once history finishes its own first load', async () => {
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [],
      isLoading: { currency_rate_history: true },
    });

    const { rerender } = await renderScreen();

    expect(mockRunBackfill).not.toHaveBeenCalled();

    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [],
    });
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalled();
  });

  // kiko-architecture: a cached display mount's rows can be one read old, and
  // a run marks its span covered for the rest of the mount. A run planned from
  // the cached resume point (for example, history a .kiko restore replaced)
  // would stop the fresh read's own run from ever starting.
  it.each(['transactions', 'currency_rate_history'])(
    'runs the backfill only once %s has its own fresh read, never from the cached rows',
    async (table) => {
      const liveData: LiveData = {
        accounts: [CASH, BANK],
        holdings: [UAH_HOLDING, USD_HOLDING],
        rates: [USD_UAH_RATE],
        transactions: TRANSACTIONS,
        history: [],
      };
      setLiveData({ ...liveData, isCached: { [table]: true } });

      const { rerender } = await renderScreen();

      expect(mockRunBackfill).not.toHaveBeenCalled();

      setLiveData(liveData);
      await act(async () => {
        rerender(<StatisticsScreen />);
      });

      expect(mockRunBackfill).toHaveBeenCalledTimes(1);
    },
  );

  it('does not report the backfill complete after a failed run, and retries the same span once now advances', async () => {
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [],
    });
    mockRunBackfill.mockRejectedValueOnce(new Error('network down'));

    // `useFocusRefreshedNow` is mocked to a stable per-instance value at the
    // top of this file; a real focus re-entry advances it, so drive that
    // here with a spy the test controls directly instead of a fake navigation
    // focus event.
    const focusModule = jest.requireMock(
      '@kiko/design-system/use-focus-refreshed-now/use-focus-refreshed-now',
    ) as {
      useFocusRefreshedNow: () => number;
    };
    const nowSpy = jest.spyOn(focusModule, 'useFocusRefreshedNow').mockReturnValue(now);

    const { getByTestId, queryByTestId, rerender } = await renderScreen();

    await waitFor(() => expect(queryByTestId('net-worth-line-loading')).toBeNull());
    expect(getByTestId('net-worth-line-empty')).toBeTruthy();
    expect(mockRunBackfill).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(localDaysFrom(now, 1));
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('leaves loading once a run rejects even when a refocus interleaved first, and still retries the same span', async () => {
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [],
    });

    let rejectFirstRun: (error: Error) => void = () => {};
    const firstRun = new Promise<never>((_resolve, reject) => {
      rejectFirstRun = reject;
    });
    mockRunBackfill.mockReturnValueOnce(firstRun);

    const focusModule = jest.requireMock(
      '@kiko/design-system/use-focus-refreshed-now/use-focus-refreshed-now',
    ) as {
      useFocusRefreshedNow: () => number;
    };
    const nowSpy = jest.spyOn(focusModule, 'useFocusRefreshedNow').mockReturnValue(now);

    const { getByTestId, queryByTestId, rerender } = await renderScreen();

    expect(getByTestId('net-worth-line-loading')).toBeTruthy();
    expect(mockRunBackfill).toHaveBeenCalledTimes(1);

    // A refocus (a dep-change re-render, `now` advancing) arrives BEFORE the
    // in-flight run settles. `backfillRanForSpanRef` already covers this
    // span, so this re-render starts no second run of its own — the first
    // run is still the only one pending.
    nowSpy.mockReturnValue(localDaysFrom(now, 1));
    await act(async () => {
      rerender(<StatisticsScreen />);
    });
    expect(mockRunBackfill).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectFirstRun(new Error('network down'));
      await firstRun.catch(() => {});
    });

    // A dep-change cleanup must not drop this settle: the line leaves
    // loading instead of staying stuck on it.
    expect(queryByTestId('net-worth-line-loading')).toBeNull();

    // The next focus retries the SAME span (the ref was reset on the reject).
    const firstSpan = mockRunBackfill.mock.calls[0]?.[0] as { earliestDay: number };
    nowSpy.mockReturnValue(localDaysFrom(now, 2));
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(2);
    expect(mockRunBackfill.mock.calls[1]?.[0]).toMatchObject({
      earliestDay: firstSpan.earliestDay,
    });

    nowSpy.mockRestore();
  });

  it('leaves loading and retries the same span when runBackfill itself resolves failed', async () => {
    // Both providers rejected inside `runBackfill`, which resolves a Right
    // `'failed'` status rather than rejecting its own promise — a distinct
    // path from the rejected-promise case above, and must be handled the
    // same way: never reported complete, and retried on the next focus.
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [],
    });
    mockRunBackfill.mockResolvedValueOnce({ state: 'failed', lastDay: null });

    const focusModule = jest.requireMock(
      '@kiko/design-system/use-focus-refreshed-now/use-focus-refreshed-now',
    ) as {
      useFocusRefreshedNow: () => number;
    };
    const nowSpy = jest.spyOn(focusModule, 'useFocusRefreshedNow').mockReturnValue(now);

    const { getByTestId, queryByTestId, rerender } = await renderScreen();

    await waitFor(() => expect(queryByTestId('net-worth-line-loading')).toBeNull());
    expect(getByTestId('net-worth-line-empty')).toBeTruthy();
    expect(mockRunBackfill).toHaveBeenCalledTimes(1);

    const firstSpan = mockRunBackfill.mock.calls[0]?.[0] as { earliestDay: number };
    nowSpy.mockReturnValue(localDaysFrom(now, 1));
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(2);
    expect(mockRunBackfill.mock.calls[1]?.[0]).toMatchObject({
      earliestDay: firstSpan.earliestDay,
    });

    nowSpy.mockRestore();
  });

  it("does not re-enter immediately when a failed run's own partial write changes history at the SAME now", async () => {
    // `runBackfill` upserts whatever rows DID compose even on an overall
    // 'failed' outcome — that write's own live-query echo changes
    // `historyRows`, and with it `lastBackfilledDayByCurrency` (a fresh
    // object every time `historyRows` changes). If either were an effect
    // dependency, this re-render alone — at the SAME `now`, with the span
    // ref just cleared by the failure handler — would start a second run
    // immediately: a permanent retry loop for a currency whose provider
    // never answers, for as long as Statistics stays mounted.
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [],
    });
    mockRunBackfill.mockResolvedValueOnce({ state: 'failed', lastDay: null });

    const focusModule = jest.requireMock(
      '@kiko/design-system/use-focus-refreshed-now/use-focus-refreshed-now',
    ) as {
      useFocusRefreshedNow: () => number;
    };
    const nowSpy = jest.spyOn(focusModule, 'useFocusRefreshedNow').mockReturnValue(now);

    const { rerender } = await renderScreen();

    await waitFor(() => expect(mockRunBackfill).toHaveBeenCalledTimes(1));

    // The failed run's own partial upsert lands: history now has a row, but
    // `now` has NOT advanced — this must not, by itself, start another run.
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [{ base: 'USD', quote: 'UAH', day: now, rate: '40' }],
    });
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(1);

    // A genuine later focus (`now` actually advances) still retries.
    nowSpy.mockReturnValue(localDaysFrom(now, 1));
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('re-runs the backfill when a new currency is held mid-session, but not for an unrelated holdings change', async () => {
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: HISTORY,
    });

    const { rerender } = await renderScreen();

    expect(mockRunBackfill).toHaveBeenCalledTimes(1);

    // A new GBP holding appears while Statistics stays mounted — the held
    // currency set changed, so the backfill must re-run even though the
    // transaction span itself did not move.
    const GBP_HOLDING: Holding = {
      id: 'h5',
      accountId: 'b',
      currency: 'GBP',
      type: 'card',
      balanceMinorUnits: 1_000,
      metadata: null,
      closedAt: null,
    };
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, GBP_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: HISTORY,
    });
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(2);

    // An unrelated holdings change (a balance update) with the SAME currency
    // set must not start a third run.
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, { ...GBP_HOLDING, balanceMinorUnits: 2_000 }],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: HISTORY,
    });
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(2);
  });

  it('retries a newly-held currency on the next focus after its own first run resolved failed', async () => {
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: HISTORY,
    });

    const focusModule = jest.requireMock(
      '@kiko/design-system/use-focus-refreshed-now/use-focus-refreshed-now',
    ) as {
      useFocusRefreshedNow: () => number;
    };
    const nowSpy = jest.spyOn(focusModule, 'useFocusRefreshedNow').mockReturnValue(now);

    const { rerender } = await renderScreen();

    expect(mockRunBackfill).toHaveBeenCalledTimes(1);

    // A new GBP holding appears, and its own run resolves `Right('failed')`
    // (every provider rejected) rather than the promise itself rejecting.
    const GBP_HOLDING: Holding = {
      id: 'h6',
      accountId: 'b',
      currency: 'GBP',
      type: 'card',
      balanceMinorUnits: 1_000,
      metadata: null,
      closedAt: null,
    };
    mockRunBackfill.mockResolvedValueOnce({ state: 'failed', lastDay: null });
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, GBP_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: HISTORY,
    });
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(2);

    // The next focus (`now` advancing, same holdings) must still retry GBP
    // rather than treating its failed run as already covered.
    nowSpy.mockReturnValue(localDaysFrom(now, 1));
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(3);

    nowSpy.mockRestore();
  });

  it("ignores a stale run's rejection once a later run has claimed a newly-extended span", async () => {
    // An older transaction extends `spanStart` EARLIER while run A is still
    // pending, so run B starts for the wider span before A ever settles. A's
    // eventual rejection must not undo run B's own claim on the span ref —
    // otherwise the next plain refocus would wrongly look "never run" again.
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [],
    });

    const focusModule = jest.requireMock(
      '@kiko/design-system/use-focus-refreshed-now/use-focus-refreshed-now',
    ) as {
      useFocusRefreshedNow: () => number;
    };
    const nowSpy = jest.spyOn(focusModule, 'useFocusRefreshedNow').mockReturnValue(now);

    let rejectFirstRun: (error: Error) => void = () => {};
    const firstRun = new Promise<never>((_resolve, reject) => {
      rejectFirstRun = reject;
    });
    mockRunBackfill.mockReturnValueOnce(firstRun);

    const { getByTestId, rerender } = await renderScreen();

    expect(mockRunBackfill).toHaveBeenCalledTimes(1);

    const secondRun = new Promise<never>(() => {});
    mockRunBackfill.mockReturnValueOnce(secondRun);

    const olderTransaction: Transaction = {
      id: 't-older',
      holdingId: 'h1',
      time: TRANSACTIONS[0].time - 10 * DAY_MS,
      amountMinorUnits: 10_000,
    };
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: [olderTransaction, ...TRANSACTIONS],
      history: [],
    });
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(2);

    await act(async () => {
      rejectFirstRun(new Error('stale'));
      await firstRun.catch(() => {});
    });

    // Still loading run B — the stale rejection changed neither the status
    // nor (see the refocus below) the span ref run B already claimed.
    expect(getByTestId('net-worth-line-loading')).toBeTruthy();

    nowSpy.mockReturnValue(localDaysFrom(now, 1));
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it("ignores a stale run's completion once a later run has claimed a newly-extended span, and applies that later run's own settle", async () => {
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [],
    });

    let resolveFirstRun: (status: BackfillStatus) => void = () => {};
    const firstRun = new Promise<BackfillStatus>((resolve) => {
      resolveFirstRun = resolve;
    });
    mockRunBackfill.mockReturnValueOnce(firstRun);

    const { getByTestId, queryByTestId, rerender } = await renderScreen();

    expect(mockRunBackfill).toHaveBeenCalledTimes(1);

    let resolveSecondRun: (status: BackfillStatus) => void = () => {};
    const secondRun = new Promise<BackfillStatus>((resolve) => {
      resolveSecondRun = resolve;
    });
    mockRunBackfill.mockReturnValueOnce(secondRun);

    const olderTransaction: Transaction = {
      id: 't-older',
      holdingId: 'h1',
      time: TRANSACTIONS[0].time - 10 * DAY_MS,
      amountMinorUnits: 10_000,
    };
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: [olderTransaction, ...TRANSACTIONS],
      history: [],
    });
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(2);

    // Run A resolves 'complete' AFTER run B already started for the wider
    // span — a stale completion must not end run B's own loading state.
    await act(async () => {
      resolveFirstRun({ state: 'complete', lastDay: now });
      await firstRun;
    });
    expect(getByTestId('net-worth-line-loading')).toBeTruthy();

    // Run B's own settle IS applied.
    await act(async () => {
      resolveSecondRun({ state: 'complete', lastDay: now });
      await secondRun;
    });
    expect(queryByTestId('net-worth-line-loading')).toBeNull();
  });

  it('recomputes the whole span from the new earliest day on a later focus, after an earlier-span retry itself failed', async () => {
    // History is already fully backfilled through `now` — the exact state
    // that lets a WRONG "never run" retry silently accept as "nothing
    // missing" once the span ref loses track of the earlier-extension it was
    // covering.
    const alreadyBackfilledThroughNow: HistoryRow[] = [
      { base: 'USD', quote: 'UAH', day: now, rate: '40' },
    ];
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: alreadyBackfilledThroughNow,
    });
    mockRunBackfill.mockResolvedValueOnce({ state: 'complete', lastDay: now });

    const focusModule = jest.requireMock(
      '@kiko/design-system/use-focus-refreshed-now/use-focus-refreshed-now',
    ) as {
      useFocusRefreshedNow: () => number;
    };
    const nowSpy = jest.spyOn(focusModule, 'useFocusRefreshedNow').mockReturnValue(now);

    const { rerender } = await renderScreen();

    expect(mockRunBackfill).toHaveBeenCalledTimes(1);

    // An older transaction extends spanStart EARLIER; the earlier-extension
    // retry that this triggers FAILS.
    mockRunBackfill.mockResolvedValueOnce({ state: 'failed', lastDay: null });
    const olderTransaction: Transaction = {
      id: 't-older',
      holdingId: 'h1',
      time: TRANSACTIONS[0].time - 10 * DAY_MS,
      amountMinorUnits: 10_000,
    };
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: [olderTransaction, ...TRANSACTIONS],
      history: alreadyBackfilledThroughNow,
    });
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(2);
    const earlierSpan = mockRunBackfill.mock.calls[1]?.[0] as { earliestDay: number };

    // A later focus retries. It must recompute the WHOLE new span again
    // (`lastBackfilledDay: null`), not silently defer to the CURRENT
    // lastBackfilledDay (already at `now`) as "nothing missing" — which
    // would only ever fetch the newest day and lose the newly-opened
    // earlier gap for good.
    mockRunBackfill.mockResolvedValueOnce({ state: 'complete', lastDay: now });
    nowSpy.mockReturnValue(localDaysFrom(now, 1));
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(3);
    expect(mockRunBackfill.mock.calls[2]?.[0]).toMatchObject({
      earliestDay: earlierSpan.earliestDay,
      lastBackfilledDay: null,
    });

    nowSpy.mockRestore();
  });

  it('drops the deselected account from both the bar and the pie when the filter narrows', async () => {
    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('bar-chart-bar-card')).toBeTruthy();
    expect(getByTestId('pie-chart-arc-b')).toBeTruthy();

    await pressFilter(getByTestId, ACCOUNT_FILTER, CASH.id);

    expect(getByTestId('bar-chart-bar-cash')).toBeTruthy();
    expect(queryByTestId('bar-chart-bar-card')).toBeNull();
    expect(getByTestId('pie-chart-arc-a')).toBeTruthy();
    expect(queryByTestId('pie-chart-arc-b')).toBeNull();
  });

  // The filter keys on the account id, never the name: two accounts may share a
  // name (a renamed implicit account, two banks), and a name may be "All".
  describe('the account filter keys on the account id', () => {
    const SAME_NAME_A: Account = { ...CASH, name: 'Loans' };
    const SAME_NAME_B: Account = { ...BANK, name: 'Loans' };
    const seedSameName = (): void =>
      setLiveData({
        accounts: [SAME_NAME_A, SAME_NAME_B],
        holdings: [UAH_HOLDING, USD_HOLDING],
        rates: [USD_UAH_RATE],
        transactions: TRANSACTIONS,
        history: HISTORY,
      });

    it('lists two accounts with the same name as two separate options', async () => {
      seedSameName();
      const { getByTestId } = await renderScreen();

      await act(async () => {
        await fireEvent.press(getByTestId(ACCOUNT_FILTER));
      });

      expect(getByTestId(`${ACCOUNT_FILTER}-option-a`)).toBeTruthy();
      expect(getByTestId(`${ACCOUNT_FILTER}-option-b`)).toBeTruthy();
    });

    it('selecting one of two same-named accounts narrows the charts to it and checks only its option', async () => {
      seedSameName();
      const { getByTestId, queryByTestId } = await renderScreen();

      await act(async () => {
        await fireEvent.press(getByTestId(ACCOUNT_FILTER));
      });
      await act(async () => {
        await fireEvent.press(getByTestId(`${ACCOUNT_FILTER}-option-b`));
      });

      expect(getByTestId(`${ACCOUNT_FILTER}-option-b`).props.accessibilityState?.checked).toBe(
        true,
      );
      expect(getByTestId(`${ACCOUNT_FILTER}-option-a`).props.accessibilityState?.checked).toBe(
        false,
      );

      await act(async () => {
        await fireEvent.press(getByTestId(`${ACCOUNT_FILTER}-backdrop`));
      });

      expect(getByTestId('pie-chart-arc-b')).toBeTruthy();
      expect(queryByTestId('pie-chart-arc-a')).toBeNull();
    });

    it('keeps a selection when its account is renamed', async () => {
      const { getByTestId, queryByTestId, rerender } = await renderScreen();

      await pressFilter(getByTestId, ACCOUNT_FILTER, BANK.id);
      setLiveData({
        accounts: [CASH, { ...BANK, name: 'Family assets' }],
        holdings: [UAH_HOLDING, USD_HOLDING],
        rates: [USD_UAH_RATE],
        transactions: TRANSACTIONS,
        history: HISTORY,
      });
      await act(async () => {
        await rerender(<StatisticsScreen />);
      });

      expect(getByTestId('pie-chart-arc-b')).toBeTruthy();
      expect(queryByTestId('pie-chart-arc-a')).toBeNull();
    });

    // A selected account that is archived or deleted leaves no checked row to
    // clear, so its stale id must neither filter nor count.
    describe('a selected account that is no longer among the options', () => {
      const SAVINGS: Account = { id: 'c', name: 'Savings', kind: 'cash', color: null };
      const SAVINGS_HOLDING: Holding = { ...UAH_HOLDING, id: 'h-savings', accountId: 'c' };
      const archiveCash = async (
        rerender: Awaited<ReturnType<typeof render>>['rerender'],
        otherAccounts: Account[] = [BANK],
        otherHoldings: Holding[] = [USD_HOLDING],
      ): Promise<void> => {
        setLiveData({
          accounts: [{ ...CASH, archivedAt: 123 }, ...otherAccounts],
          holdings: [UAH_HOLDING, ...otherHoldings],
          rates: [USD_UAH_RATE],
          transactions: TRANSACTIONS,
          history: HISTORY,
        });
        await act(async () => {
          rerender(<StatisticsScreen />);
        });
      };

      it('filters nothing and shows no count once the only selected account is archived', async () => {
        const { getByTestId, getByText, queryByText, queryByTestId, rerender } =
          await renderScreen();

        await pressFilter(getByTestId, ACCOUNT_FILTER, CASH.id);
        expect(queryByTestId('pie-chart-arc-b')).toBeNull();
        expect(getByText('Accounts · 1')).toBeTruthy();

        await archiveCash(rerender);

        expect(getByTestId('pie-chart-arc-b')).toBeTruthy();
        expect(getByTestId('bar-chart-bar-card')).toBeTruthy();
        expect(getByText('Accounts')).toBeTruthy();
        expect(queryByText(/^Accounts · /)).toBeNull();
      });

      // Deleting is the in-app path to this state: nothing in the app archives.
      it('filters nothing and shows no count once the only selected account is deleted', async () => {
        const { getByTestId, getByText, queryByText, queryByTestId, rerender } =
          await renderScreen();

        await pressFilter(getByTestId, ACCOUNT_FILTER, CASH.id);
        expect(queryByTestId('pie-chart-arc-b')).toBeNull();
        expect(getByText('Accounts · 1')).toBeTruthy();

        setLiveData({
          accounts: [BANK],
          holdings: [USD_HOLDING],
          rates: [USD_UAH_RATE],
          transactions: TRANSACTIONS.filter((row) => row.holdingId !== UAH_HOLDING.id),
          history: HISTORY,
        });
        await act(async () => {
          rerender(<StatisticsScreen />);
        });

        expect(getByTestId('pie-chart-arc-b')).toBeTruthy();
        expect(getByText('Accounts')).toBeTruthy();
        expect(queryByText(/^Accounts · /)).toBeNull();
      });

      it('keeps filtering by a second selected account that is still among the options', async () => {
        setLiveData({
          accounts: [CASH, BANK, SAVINGS],
          holdings: [UAH_HOLDING, USD_HOLDING, SAVINGS_HOLDING],
          rates: [USD_UAH_RATE],
          transactions: TRANSACTIONS,
          history: HISTORY,
        });
        const { getByTestId, getByText, queryByTestId, rerender } = await renderScreen();

        await act(async () => {
          await fireEvent.press(getByTestId(ACCOUNT_FILTER));
        });
        await act(async () => {
          await fireEvent.press(getByTestId(`${ACCOUNT_FILTER}-option-a`));
        });
        await act(async () => {
          await fireEvent.press(getByTestId(`${ACCOUNT_FILTER}-option-b`));
        });
        await act(async () => {
          await fireEvent.press(getByTestId(`${ACCOUNT_FILTER}-backdrop`));
        });
        expect(getByText('Accounts · 2')).toBeTruthy();

        await archiveCash(rerender, [BANK, SAVINGS], [USD_HOLDING, SAVINGS_HOLDING]);

        expect(getByText('Accounts · 1')).toBeTruthy();
        expect(getByTestId('pie-chart-arc-b')).toBeTruthy();
        expect(queryByTestId('pie-chart-arc-c')).toBeNull();
      });
    });

    it('filters an account named "All" as one account, not as the clear-all option', async () => {
      setLiveData({
        accounts: [{ ...CASH, name: FILTER_ALL }, BANK],
        holdings: [UAH_HOLDING, USD_HOLDING],
        rates: [USD_UAH_RATE],
        transactions: TRANSACTIONS,
        history: HISTORY,
      });
      const { getByTestId, queryByTestId } = await renderScreen();

      await pressFilter(getByTestId, ACCOUNT_FILTER, CASH.id);

      expect(getByTestId('pie-chart-arc-a')).toBeTruthy();
      expect(queryByTestId('pie-chart-arc-b')).toBeNull();
    });
  });

  // An implicit account is stored under an English sentinel: its filter option
  // and the contribution chart SHOW its localized kind, while the filter keys on
  // the account id, which does not change with the language.
  describe('an implicit account under Ukrainian', () => {
    const PROPERTIES: Account = {
      id: 'p',
      name: 'Properties',
      kind: 'property',
      color: null,
      archivedAt: null,
    };
    const LOANS: Account = {
      id: 'd',
      name: 'Loans',
      kind: 'debt',
      color: null,
      archivedAt: null,
    };
    const FLAT: Holding = {
      id: 'h-flat',
      accountId: 'p',
      currency: 'UAH',
      type: 'property_item',
      balanceMinorUnits: 0,
      metadata: {
        category: 'real_estate',
        lots: [
          { day: toUtcMidnight(now) - 40 * DAY_MS, quantityDelta: '1', costMinorUnits: 500_000 },
        ],
      },
      closedAt: null,
    };

    // Only the account link counts for the filter: an implicit account with no
    // holding at all is left out of its options.
    const LOAN_HOLDING: Holding = { ...FLAT, id: 'h-loan', accountId: 'd' };

    beforeEach(async () => {
      setLiveData({
        accounts: [CASH, PROPERTIES, LOANS],
        holdings: [UAH_HOLDING, FLAT, LOAN_HOLDING],
      });
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('lists each implicit account in the account filter under its localized name, keyed on its id', async () => {
      const { getByTestId } = await renderScreen();

      await act(async () => {
        await fireEvent.press(getByTestId(ACCOUNT_FILTER));
      });

      expect(
        within(getByTestId(`${ACCOUNT_FILTER}-option-${PROPERTIES.id}`)).getByText('Майно'),
      ).toBeTruthy();
      expect(
        within(getByTestId(`${ACCOUNT_FILTER}-option-${LOANS.id}`)).getByText('Кредити'),
      ).toBeTruthy();
    });

    it('selecting it by its localized name narrows the charts to that account', async () => {
      const { getByTestId, queryByTestId } = await renderScreen();

      await act(async () => {
        await fireEvent.press(getByTestId(ACCOUNT_FILTER));
      });
      await act(async () => {
        await fireEvent.press(
          within(getByTestId(`${ACCOUNT_FILTER}-option-${PROPERTIES.id}`)).getByText('Майно'),
        );
      });
      await act(async () => {
        await fireEvent.press(getByTestId(`${ACCOUNT_FILTER}-backdrop`));
      });

      expect(getByTestId('pie-chart-arc-p')).toBeTruthy();
      expect(queryByTestId('pie-chart-arc-a')).toBeNull();
    });

    it('keeps a selection made under English narrowing the same charts after the language switches', async () => {
      await i18n.changeLanguage('en');
      const { getByTestId, queryByTestId } = await renderScreen();

      await pressFilter(getByTestId, ACCOUNT_FILTER, PROPERTIES.id);
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      expect(getByTestId('pie-chart-arc-p')).toBeTruthy();
      expect(queryByTestId('pie-chart-arc-a')).toBeNull();
    });

    it('names it by its localized name in the account contribution chart', async () => {
      const { getByTestId } = await renderScreen();

      expect(within(getByTestId('pie-chart-legend-p')).getByText('Майно')).toBeTruthy();
    });
  });

  // Deleting an implicit account's last holding leaves the account row behind;
  // it must leave the filter options too, but a closed holding's history still
  // counts, so one holding of either state keeps it listed.
  describe('an implicit account in the account filter', () => {
    const PROPERTIES: Account = {
      id: 'p',
      name: 'Properties',
      kind: 'property',
      color: null,
      archivedAt: null,
    };
    const FLAT: Holding = {
      id: 'h-flat',
      accountId: 'p',
      currency: 'UAH',
      type: 'property_item',
      balanceMinorUnits: 0,
      metadata: {
        category: 'real_estate',
        lots: [
          { day: toUtcMidnight(now) - 40 * DAY_MS, quantityDelta: '1', costMinorUnits: 500_000 },
        ],
      },
      closedAt: null,
    };
    const openFilter = async (getByTestId: (id: string) => Parameters<typeof fireEvent.press>[0]) =>
      act(async () => {
        await fireEvent.press(getByTestId(ACCOUNT_FILTER));
      });

    it('is left out when it has no holding at all', async () => {
      setLiveData({ accounts: [CASH, PROPERTIES], holdings: [UAH_HOLDING] });
      const { getByTestId, queryByTestId } = await renderScreen();

      await openFilter(getByTestId);

      expect(getByTestId(`${ACCOUNT_FILTER}-option-${CASH.id}`)).toBeTruthy();
      expect(queryByTestId(`${ACCOUNT_FILTER}-option-${PROPERTIES.id}`)).toBeNull();
    });

    it('stays listed with an open holding', async () => {
      setLiveData({ accounts: [CASH, PROPERTIES], holdings: [UAH_HOLDING, FLAT] });
      const { getByTestId } = await renderScreen();

      await openFilter(getByTestId);

      expect(getByTestId(`${ACCOUNT_FILTER}-option-${PROPERTIES.id}`)).toBeTruthy();
    });

    it('stays listed with only a closed holding, its history still counting', async () => {
      setLiveData({
        accounts: [CASH, PROPERTIES],
        holdings: [UAH_HOLDING, { ...FLAT, closedAt: toUtcMidnight(now) - 10 * DAY_MS }],
      });
      const { getByTestId } = await renderScreen();

      await openFilter(getByTestId);

      expect(getByTestId(`${ACCOUNT_FILTER}-option-${PROPERTIES.id}`)).toBeTruthy();
    });

    it('keeps an empty bank account listed', async () => {
      setLiveData({ accounts: [CASH, BANK], holdings: [UAH_HOLDING] });
      const { getByTestId } = await renderScreen();

      await openFilter(getByTestId);

      expect(getByTestId(`${ACCOUNT_FILTER}-option-${BANK.id}`)).toBeTruthy();
    });

    it('prunes a stored selection of it once its last holding is deleted, moving no total', async () => {
      setLiveData({ accounts: [CASH, PROPERTIES], holdings: [UAH_HOLDING, FLAT] });
      const { getByTestId, getByText, queryByText, queryByTestId, rerender, toJSON } =
        await renderScreen();

      await pressFilter(getByTestId, ACCOUNT_FILTER, PROPERTIES.id);
      expect(getByText('Accounts · 1')).toBeTruthy();
      expect(queryByTestId('pie-chart-arc-a')).toBeNull();

      setLiveData({ accounts: [CASH, PROPERTIES], holdings: [UAH_HOLDING] });
      await act(async () => {
        rerender(<StatisticsScreen />);
      });
      const afterPrune = JSON.stringify(toJSON());
      const everything = await renderScreen();

      expect(getByTestId('pie-chart-arc-a')).toBeTruthy();
      expect(getByText('Accounts')).toBeTruthy();
      expect(queryByText(/^Accounts · /)).toBeNull();
      expect(afterPrune).toBe(JSON.stringify(everything.toJSON()));
    });
  });

  it('shows each account filter option with its stored icon, or its kind glyph, in its resolved color', async () => {
    setLiveData({
      accounts: [
        { ...CASH, icon: null, color: '' },
        { ...BANK, icon: 'creditcard', color: darkTheme.colors.entityColors.violet },
      ],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: HISTORY,
    });
    const { getByTestId } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByTestId(ACCOUNT_FILTER));
    });

    const kindGlyph = optionGlyph(getByTestId(`${ACCOUNT_FILTER}-option-${CASH.id}`), 'banknote');
    const storedGlyph = optionGlyph(
      getByTestId(`${ACCOUNT_FILTER}-option-${BANK.id}`),
      'creditcard',
    );

    expect(kindGlyph?.props.tintColor).toBe(darkTheme.colors.entityColors.khaki);
    expect(storedGlyph?.props.tintColor).toBe(darkTheme.colors.entityColors.violet);
  });

  it('renders all four empty charts without crashing when there is no data', async () => {
    setLiveData({});

    const { getByTestId } = await renderScreen();

    expect(getByTestId('bar-chart-empty')).toBeTruthy();
    expect(getByTestId('net-worth-line-empty')).toBeTruthy();
    expect(getByTestId('pie-chart-empty')).toBeTruthy();
    expect(getByTestId('category-pie-empty')).toBeTruthy();
  });

  it('does not run the backfill when there are no transactions to bound the span', async () => {
    setLiveData({});

    await renderScreen();

    expect(mockRunBackfill).not.toHaveBeenCalled();
  });

  // A metal or property records its purchases as lots, not transactions, so a
  // foreign holding can exist with no ledger row anywhere.
  describe('with holdings but no transactions', () => {
    const backfillSpan = (): { earliestDay: number; today: number } =>
      mockRunBackfill.mock.calls[0]?.[0] as { earliestDay: number; today: number };

    // A lot's day is a day key (the UTC midnight of its date); the span is
    // made of instants, so it starts at that date's local midnight.
    it('backfills from the local midnight of the earliest lot day', async () => {
      const lotDay = toUtcMidnight(now) - 40 * DAY_MS;
      const lotDate = new Date(lotDay);
      setLiveData({
        accounts: [BANK],
        holdings: [
          {
            id: 'villa',
            accountId: BANK.id,
            currency: 'USD',
            type: 'property_item',
            balanceMinorUnits: 0,
            metadata: {
              category: 'real_estate',
              lots: [{ day: lotDay, quantityDelta: '10', costMinorUnits: 150_000 }],
            },
            closedAt: null,
          },
        ],
        rates: [USD_UAH_RATE],
      });

      await renderScreen();

      expect(backfillSpan().earliestDay).toBe(
        new Date(lotDate.getUTCFullYear(), lotDate.getUTCMonth(), lotDate.getUTCDate()).getTime(),
      );
    });

    it('backfills from now when no holding has a lot', async () => {
      setLiveData({ accounts: [BANK], holdings: [USD_HOLDING], rates: [USD_UAH_RATE] });

      await renderScreen();

      expect(backfillSpan().earliestDay).toBe(backfillSpan().today);
    });
  });

  it('renders a spending pie wedge per expense category, with its legend entry', async () => {
    seedSpending();

    const { getByTestId, getAllByText } = await renderScreen();

    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(getByTestId('category-pie-arc-transport')).toBeTruthy();
    // Both category filters are closed dropdown buttons (no chips), so each
    // title renders in the pie's legend row and again in the spending-trend
    // chart's legend below it (both categories are seeded into the trend's
    // top-3 default), so assert at least one instance rather than a unique one.
    expect(getAllByText('Groceries').length).toBeGreaterThan(0);
    expect(getAllByText('Transport').length).toBeGreaterThan(0);
    expect(getByTestId('category-pie-legend-groceries')).toBeTruthy();
  });

  it('crops the category legend to categories at or above 5% share, with a Show all toggle', async () => {
    // groceries 94% and transport 5% stay; transfers 1% is cropped by default.
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: [
        {
          id: 'c1',
          holdingId: 'h1',
          time: localDaysFrom(now, -2),
          amountMinorUnits: -940_00,
          category: 'groceries',
        },
        {
          id: 'c2',
          holdingId: 'h1',
          time: localDaysFrom(now, -2),
          amountMinorUnits: -50_00,
          category: 'transport',
        },
        {
          id: 'c3',
          holdingId: 'h1',
          time: localDaysFrom(now, -2),
          amountMinorUnits: -10_00,
          category: 'transfers',
        },
      ],
      history: HISTORY,
      categories: CATEGORIES,
    });

    const { getByTestId, queryByTestId } = await renderScreen();

    // Cropped by default: groceries and transport show, transfers is hidden,
    // but the ring still draws all three arcs.
    expect(getByTestId('category-pie-legend-groceries')).toBeTruthy();
    expect(getByTestId('category-pie-legend-transport')).toBeTruthy();
    expect(queryByTestId('category-pie-legend-transfers')).toBeNull();
    expect(getByTestId('category-pie-arc-transfers')).toBeTruthy();

    // The toggle reveals the cropped transfers row on tap.
    await fireEvent.press(getByTestId('category-pie-legend-toggle'));
    expect(getByTestId('category-pie-legend-transfers')).toBeTruthy();
  });

  it('titles the category donut "Expenses by Category", with its filter below the title and above the chart', async () => {
    seedSpending();

    const root = await renderScreen();
    const { getByText } = root;

    expect(getByText('Expenses by Category')).toBeTruthy();

    const order = renderOrder(root);
    const titleIndex = order.findIndex((node) =>
      (node.children ?? []).includes('Expenses by Category'),
    );
    const filterIndex = order.findIndex((node) => node.props.testID === CATEGORY_FILTER);
    const chartIndex = order.findIndex(
      (node) => node.props.testID === 'category-pie-arc-groceries',
    );

    expect(titleIndex).toBeGreaterThan(-1);
    expect(filterIndex).toBeGreaterThan(titleIndex);
    expect(chartIndex).toBeGreaterThan(filterIndex);
  });

  it('shows the summed category total, in the base currency, at the donut center', async () => {
    seedSpending();

    const { getByTestId, getByText } = await renderScreen();

    // Groceries (300.00) + Transport (100.00) = 400.00 UAH, the base currency.
    expect(getByTestId('category-pie-center-total')).toBeTruthy();
    expect(getByText('400.00 ₴')).toBeTruthy();
  });

  it('renders each category filter option with the slice icon, tinted with its color', async () => {
    seedSpending();

    const { getByTestId } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByTestId(CATEGORY_FILTER));
    });

    // The option icon (an SFSymbolView, mocked to a View) sits inside its shared
    // SelectableRow, and carries the breakdown slice's own icon + resolved color
    // — proving the slice's icon/color reach the menu row rather than being
    // discarded.
    const grocery = optionGlyph(getByTestId(`${CATEGORY_FILTER}-option-groceries`), 'cart');
    expect(grocery?.props.name).toBe('cart');
    expect(grocery?.props.tintColor).toBeTruthy();
    const transport = optionGlyph(getByTestId(`${CATEGORY_FILTER}-option-transport`), 'car');
    expect(transport?.props.name).toBe('car');
  });

  it('colors an uncolored category slice from the chart set hash', async () => {
    // The seeded categories carry no stored color, so the option tint is
    // `categoryColor(key)` — a hue from `chartSeriesDark`.
    seedSpending();

    const { getByTestId } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByTestId(CATEGORY_FILTER));
    });

    expect(
      optionGlyph(getByTestId(`${CATEGORY_FILTER}-option-groceries`), 'cart')?.props.tintColor,
    ).toBe(categoryColor('groceries'));
  });

  it('orders the category filter options by the custom category order, not by spending magnitude', async () => {
    // Spending magnitude orders groceries (300.00) ahead of transport (100.00).
    // The user's custom category order (categoriesRepo.allQuery, asc sortOrder /
    // key) is the REVERSE here — transport first, then groceries. The filter
    // option list must follow the custom order, keyed by the stable slug.
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: EXPENSES,
      history: HISTORY,
      categories: [
        { key: 'transport', title: 'Transport', icon: 'car' },
        { key: 'groceries', title: 'Groceries', icon: 'cart' },
      ],
    });

    const view = await renderScreen();

    await act(async () => {
      await fireEvent.press(view.getByTestId(CATEGORY_FILTER));
    });

    const prefix = `${CATEGORY_FILTER}-option-`;
    const optionKeys = renderOrder(view)
      .map((node) => node.props.testID)
      .filter((id): id is string => typeof id === 'string' && id.startsWith(prefix))
      .map((id) => id.slice(prefix.length));

    // The synthetic "All" sentinel leads, then the real options in the custom
    // category order (transport before groceries), NOT the spending order.
    expect(optionKeys).toEqual([FILTER_ALL, 'transport', 'groceries']);
  });

  it('excludes a card-to-card self-transfer pair from the category pie while keeping real spending', async () => {
    seedSpendingWithTransfer();

    const { getByTestId, queryByTestId } = await renderScreen();

    // The transfer's debit leg is categorized 'transfers', but both legs are a
    // matched self-transfer and are dropped — so no "transfers" wedge appears.
    expect(queryByTestId('category-pie-arc-transfers')).toBeNull();
    // Genuine spending in other categories is untouched.
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(getByTestId('category-pie-arc-transport')).toBeTruthy();
  });

  // A sync closes a jar or card the bank no longer lists; its past rows are
  // still real history, so both the transfer matcher and the spending charts
  // must keep reading them.
  describe('a closed holding', () => {
    const seedSpendingWithTransferClosing = (closed: { card?: number; jar?: number }): void =>
      setLiveData({
        accounts: [CASH, BANK],
        holdings: [
          { ...UAH_HOLDING, closedAt: closed.card ?? null },
          USD_HOLDING,
          { ...UAH_HOLDING_2, closedAt: closed.jar ?? null },
        ],
        rates: [USD_UAH_RATE],
        transactions: [...EXPENSES, ...SELF_TRANSFER],
        history: HISTORY,
        categories: CATEGORIES,
      });

    it('keeps a transfer into a closed jar out of spending', async () => {
      seedSpendingWithTransferClosing({ jar: now });

      const { getByText, queryByTestId } = await renderScreen();

      expect(queryByTestId('category-pie-arc-transfers')).toBeNull();
      expect(getByText('400.00 ₴')).toBeTruthy();
    });

    it("keeps a closed card's past spending", async () => {
      seedSpendingWithTransferClosing({ card: now });

      const { getByTestId, getByText } = await renderScreen();

      expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
      expect(getByTestId('category-pie-arc-transport')).toBeTruthy();
      expect(getByText('400.00 ₴')).toBeTruthy();
    });
  });

  it('excludes a self-transfer whose other leg sits under a filtered-out account', async () => {
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING, { ...UAH_HOLDING_2, accountId: BANK.id }],
      rates: [USD_UAH_RATE],
      transactions: [...EXPENSES, ...SELF_TRANSFER],
      history: HISTORY,
      categories: CATEGORIES,
    });

    const { getByTestId, getByText, queryByTestId } = await renderScreen();

    await pressFilter(getByTestId, ACCOUNT_FILTER, CASH.id);

    expect(queryByTestId('category-pie-arc-transfers')).toBeNull();
    expect(getByText('400.00 ₴')).toBeTruthy();
  });

  it('still excludes a self-transfer pair whose legs straddle the active range boundary', async () => {
    const MINUTE = 60_000;
    // The screen's own `rangeFrom` is the shared `startOfLocalDay` — TRUE
    // local midnight of the default range's `from` date (a `Date.UTC` anchor
    // would silently exclude the first 2-3 local hours of every day in a
    // positive-UTC-offset locale).
    // Mirror the screen's exact calculation here (idempotent since `dateFrom`
    // is already local midnight) so a UTC-offset host doesn't misplace the
    // straddling legs.
    const dateFrom = defaultDateRange(now).from;
    const rangeFromMs = startOfLocalDay(dateFrom.getTime());

    // The debit leg sits just INSIDE the active range (rangeFrom + 1 minute);
    // its matching credit leg sits just OUTSIDE it (rangeFrom - 1 minute) — a
    // 2-minute gap, still inside the matcher's TRANSFER_MATCH_WINDOW_MS. If
    // the exclusion sets were computed only over the in-range slice (instead
    // of the full, unfiltered ledger), the matcher would never see the
    // out-of-range credit leg and the in-range debit would wrongly surface
    // as a 'transfers' wedge.
    const straddlingDebit: Transaction = {
      id: 'straddle-debit-in-range',
      holdingId: 'h1',
      time: rangeFromMs + MINUTE,
      amountMinorUnits: -200_00,
      category: 'transfers',
    };
    const straddlingCredit: Transaction = {
      id: 'straddle-credit-out-of-range',
      holdingId: 'h3',
      time: rangeFromMs - MINUTE,
      amountMinorUnits: 200_00,
      category: 'transfers',
    };

    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING, UAH_HOLDING_2],
      rates: [USD_UAH_RATE],
      transactions: [...EXPENSES, straddlingDebit, straddlingCredit],
      history: HISTORY,
      categories: CATEGORIES,
    });

    const { getByTestId, queryByTestId } = await renderScreen();

    // The straddling pair is still recognized as an internal transfer, so no
    // 'transfers' wedge appears, even though only the debit leg is in range.
    expect(queryByTestId('category-pie-arc-transfers')).toBeNull();
    // Genuine in-range spending is untouched.
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(getByTestId('category-pie-arc-transport')).toBeTruthy();
  });

  // Kyiv is UTC+2/+3 — a positive offset, where a UTC-anchored `rangeFrom`
  // (`Date.UTC(y, m, d)` built from the picked day's LOCAL y/m/d) sits 2-3
  // hours AFTER true local midnight. A transaction shortly after true local
  // midnight then falls before that UTC-anchored bound and drops out of the
  // range entirely.
  describe('local-day range start in a positive-UTC-offset zone (Kyiv)', () => {
    it('includes a 00:30 local expense on the range’s first day in the category pie', async () => {
      const MINUTE = 60_000;
      const dateFrom = defaultDateRange(now).from;
      const rangeFromMs = startOfLocalDay(dateFrom.getTime());

      const earlyExpense: Transaction = {
        id: 'early-local-day-expense',
        holdingId: 'h1',
        time: rangeFromMs + 30 * MINUTE,
        amountMinorUnits: -400_00,
        category: 'groceries',
      };

      setLiveData({
        accounts: [CASH, BANK],
        holdings: [UAH_HOLDING, USD_HOLDING],
        rates: [USD_UAH_RATE],
        transactions: [earlyExpense],
        history: HISTORY,
        categories: CATEGORIES,
      });

      const { getByTestId } = await renderScreen();

      expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    });
  });

  it('drops a cash-out and an OWN-account transfer by mcc/IBAN while keeping a P2P payment', async () => {
    seedSpendingWithMccMovements();

    const { getByTestId, queryByTestId } = await renderScreen();

    // The cash-out (mcc 6011) is excluded, so its 'cash' wedge never appears.
    expect(queryByTestId('category-pie-arc-cash')).toBeNull();
    // The 4829 transfer to the user's OWN card IBAN is dropped, but the 4829 to
    // a THIRD-PARTY IBAN stays — so a 'transfers' wedge still exists (from the
    // kept P2P payment alone).
    expect(getByTestId('category-pie-arc-transfers')).toBeTruthy();
    // Genuine spending in the other categories is untouched.
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(getByTestId('category-pie-arc-transport')).toBeTruthy();
  });

  it('renders no category wedge for a cross-currency exchange pair', async () => {
    seedSpendingWithExchange();

    const { getByTestId, queryByTestId } = await renderScreen();

    // Both legs are an internal movement between the user's own holdings, so
    // the debit never reaches the pie — no 'other' wedge for its null category.
    expect(queryByTestId('category-pie-arc-other')).toBeNull();
    // Genuine spending is untouched.
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(getByTestId('category-pie-arc-transport')).toBeTruthy();
  });

  it('renders no wedge for the ORIGINAL expense of a cross-currency convert', async () => {
    seedSpendingWithConvert();

    const { getByTestId, queryByTestId } = await renderScreen();

    // The converted row keeps its own 'transport' category, but it is one leg
    // of an internal movement, so its wedge is gone.
    expect(queryByTestId('category-pie-arc-transport')).toBeNull();
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
  });

  it('leaves income-only data with an empty spending pie', async () => {
    // The default `seedFull` transactions are all POSITIVE (income), so no
    // category has spending and the pie shows its empty state.
    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('category-pie-empty')).toBeTruthy();
    expect(queryByTestId('category-pie-arc-groceries')).toBeNull();
  });

  it('narrows the spending pie to the selected category via the FilterMenu, and restores all when the selection clears', async () => {
    seedSpending();

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(getByTestId('category-pie-arc-transport')).toBeTruthy();

    // Selecting one category (by its stable KEY, not its title) narrows the
    // pie to just it — the same include-narrowing model the account filter
    // uses.
    await pressFilter(getByTestId, CATEGORY_FILTER, 'groceries');

    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(queryByTestId('category-pie-arc-transport')).toBeNull();

    // Toggling that same selection back off clears the dimension, so all
    // categories return to the pie.
    await pressFilter(getByTestId, CATEGORY_FILTER, 'groceries');

    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(getByTestId('category-pie-arc-transport')).toBeTruthy();
  });

  it('keeps a selected category checked and listed in the filter menu after the range moves away from its spending', async () => {
    seedSpending();

    const { getByTestId, getByLabelText, getByText, queryByTestId } = await renderScreen();

    await pressFilter(getByTestId, CATEGORY_FILTER, 'groceries');

    // Narrow the range to TODAY — outside the EXPENSES' two-days-ago
    // timestamp — so every category (groceries included) drops out of the
    // range-scoped slices. The selection itself is untouched by the narrowing.
    await act(async () => {
      await fireEvent.press(getByLabelText('Date range'));
    });
    const today = new Date(now);
    const calendar = getByTestId('date-range-calendar').props as {
      onDayPress: (day: unknown) => void;
    };
    await act(async () => {
      calendar.onDayPress({
        year: today.getFullYear(),
        month: today.getMonth() + 1,
        day: today.getDate(),
      });
    });
    await act(async () => {
      await fireEvent.press(getByText('Apply'));
    });

    expect(getByTestId('category-pie-empty')).toBeTruthy();

    // The menu still lists groceries, still checked, even though it has no
    // spending in the narrowed range — hiding it would leave the selection
    // impossible to find and uncheck.
    await act(async () => {
      await fireEvent.press(getByTestId(CATEGORY_FILTER));
    });
    expect(
      getByTestId(`${CATEGORY_FILTER}-option-groceries`).props.accessibilityState?.checked,
    ).toBe(true);

    // The user can still uncheck it, same as any other option.
    await act(async () => {
      await fireEvent.press(getByTestId(`${CATEGORY_FILTER}-option-groceries`));
    });
    await act(async () => {
      await fireEvent.press(getByTestId(`${CATEGORY_FILTER}-backdrop`));
    });
    await act(async () => {
      await fireEvent.press(getByTestId(CATEGORY_FILTER));
    });
    expect(queryByTestId(`${CATEGORY_FILTER}-option-groceries`)).toBeNull();
  });

  it('excludes an expense outside the active date range from the donut center total', async () => {
    // One expense inside the default 30-day window, one 60 days back (well
    // outside it). If the donut summed the whole ledger instead of the active
    // range, the center total would read 1,000.00 (both) instead of 100.00
    // (the in-range expense alone).
    const insideRangeExpense: Transaction = {
      id: 'inside-range',
      holdingId: 'h1',
      time: localDaysFrom(now, -5),
      amountMinorUnits: -100_00,
      category: 'groceries',
    };
    const outsideRangeExpense: Transaction = {
      id: 'outside-range',
      holdingId: 'h1',
      time: localDaysFrom(now, -60),
      amountMinorUnits: -900_00,
      category: 'groceries',
    };

    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: [insideRangeExpense, outsideRangeExpense],
      history: HISTORY,
      categories: CATEGORIES,
    });

    const { getByTestId } = await renderScreen();

    // The donut's center total is the sum of its visible (in-range) slices —
    // scope the query to it, since the legend row below repeats the same
    // per-category figure.
    const centerTotal = within(getByTestId('category-pie-center-total'));

    expect(centerTotal.getByText('100.00 ₴')).toBeTruthy();
    expect(centerTotal.queryByText('1,000.00 ₴')).toBeNull();
  });

  it('draws a category line for each of the default top-3-by-contribution selection', async () => {
    seedSpending();

    const { getByTestId } = await renderScreen();

    // Nothing is saved, so the default filter (top 3 by contribution) applies.
    // With only two spending categories both fall inside the top 3, so both
    // lines are drawn under the trend block's own filter.
    expect(getByTestId('statistics-block-trend')).toBeTruthy();
    expect(getByTestId('category-trend-line-line-groceries')).toBeTruthy();
    expect(getByTestId('category-trend-line-line-transport')).toBeTruthy();
  });

  it('draws only the top-N lines for a saved top filter, independent of the donut', async () => {
    // Top 1 by contribution -> only the highest-spend category (groceries, 300).
    seedTrend({ mode: 'top', amount: 1, by: 'contribution' });

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('category-trend-line-line-groceries')).toBeTruthy();
    expect(queryByTestId('category-trend-line-line-transport')).toBeNull();
    expect(queryByTestId('category-trend-line-line-transfers')).toBeNull();
    // The donut's own groceries wedge is untouched — the two filters are separate.
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
  });

  it('draws only the manually selected category line for a saved manual filter', async () => {
    seedTrend({ mode: 'manual', keys: ['transport'] });

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('category-trend-line-line-transport')).toBeTruthy();
    expect(queryByTestId('category-trend-line-line-groceries')).toBeNull();
    expect(queryByTestId('category-trend-line-line-transfers')).toBeNull();
  });

  it('draws every category line for an empty manual selection (all)', async () => {
    seedTrend({ mode: 'manual', keys: [] });

    const { getByTestId } = await renderScreen();

    expect(getByTestId('category-trend-line-line-groceries')).toBeTruthy();
    expect(getByTestId('category-trend-line-line-transport')).toBeTruthy();
    expect(getByTestId('category-trend-line-line-transfers')).toBeTruthy();
  });

  it('labels the Filters button with the applied manual count', async () => {
    seedTrend({ mode: 'manual', keys: ['transport'] });

    const { getByTestId } = await renderScreen();

    expect(getByTestId('statistics-trend-filter')).toHaveTextContent('1 Category');
  });

  it('labels the Filters button with the top summary, defaulting to top 3 by contribution', async () => {
    seedTrend(null);

    const { getByTestId } = await renderScreen();

    expect(getByTestId('statistics-trend-filter')).toHaveTextContent('Top 3 by Contribution');
  });

  it('persists the edited filter through the sheet on Save', async () => {
    seedTrend(null);

    const { getByTestId, getByText } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByTestId('statistics-trend-filter'));
    });
    await act(async () => {
      await fireEvent.press(getByText('Manual'));
    });
    await act(async () => {
      await fireEvent.press(getByTestId('statistics-trend-filter-option-transport'));
    });
    await act(async () => {
      await fireEvent.press(getByTestId('statistics-trend-filter-save'));
    });

    expect(mockSetTrendFilter).toHaveBeenCalledWith({ mode: 'manual', keys: ['transport'] });
  });

  it('shows a saved manual trend key with no spending in the range with its real label and icon, still checked (not a bare slug row)', async () => {
    // `utilities` is a seeded default category (so its title translates), but
    // THREE_EXPENSES never spends against it — it never reaches
    // `allCategorySlices`, the same gap `selectedCategories` already handles
    // for the category donut.
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: THREE_EXPENSES,
      history: HISTORY,
      categories: [...CATEGORIES, { key: 'utilities', title: 'Utilities', icon: 'bolt' }],
      settings: [{ baseCurrency: 'UAH', trendFilter: { mode: 'manual', keys: ['utilities'] } }],
    });

    const { getByTestId } = await renderScreen();
    await act(async () => {
      await fireEvent.press(getByTestId('statistics-trend-filter'));
    });

    const row = getByTestId('statistics-trend-filter-option-utilities');

    expect(within(row).getByText('Utilities')).toBeTruthy();
    expect(row.queryAll((node) => node.props.name === 'bolt')).not.toHaveLength(0);
    expect(row.props.accessibilityState.checked).toBe(true);

    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const rowAfterSwitch = getByTestId('statistics-trend-filter-option-utilities');

    expect(within(rowAfterSwitch).getByText('Комунальні послуги')).toBeTruthy();
    expect(rowAfterSwitch.props.accessibilityState.checked).toBe(true);

    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('shows the spending-trend empty state when there is no spending', async () => {
    // The default `seedFull` transactions are all income, so the trend has no
    // line to draw and falls back to its empty state.
    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('category-trend-line-empty')).toBeTruthy();
    expect(queryByTestId('category-trend-line-line-groceries')).toBeNull();
  });

  it('defaults the date-range field to the last 30 days', async () => {
    const { getByText } = await renderScreen();
    const range = defaultDateRange();

    expect(getByText(`${formatDate(range.from)} – ${formatDate(range.to)}`)).toBeTruthy();
  });

  it('resets the date range to the 30-day default (not all-time) when Clear is pressed', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderScreen();

    const range = defaultDateRange();

    // Narrow away from the 30-day default. The picker RESETS on each pick: a pick
    // on the already-applied (complete) default range starts a fresh single-date
    // selection at the pick, so picking 3 days ago collapses the range to that
    // one day (from === to === narrowedDay), clearly off the default window.
    await act(async () => {
      await fireEvent.press(getByLabelText('Date range'));
    });
    const narrowedDay = new Date();
    narrowedDay.setDate(narrowedDay.getDate() - 3);
    const calendar = getByTestId('date-range-calendar').props as {
      onDayPress: (day: unknown) => void;
    };
    await act(async () => {
      calendar.onDayPress({
        year: narrowedDay.getFullYear(),
        month: narrowedDay.getMonth() + 1,
        day: narrowedDay.getDate(),
      });
    });
    await act(async () => {
      await fireEvent.press(getByText('Apply'));
    });
    expect(getByText(`${formatDate(narrowedDay)} – ${formatDate(narrowedDay)}`)).toBeTruthy();

    // Clearing must land back on the 30-day default, NOT on all-time.
    await act(async () => {
      await fireEvent.press(getByLabelText('Date range'));
    });
    await act(async () => {
      await fireEvent.press(getByText('Clear'));
    });

    expect(getByText(`${formatDate(range.from)} – ${formatDate(range.to)}`)).toBeTruthy();
  });

  // The default range used to be seeded once in a `useState` initializer, so
  // a tab that stayed mounted overnight kept showing yesterday's window and
  // silently dropped today's activity. The default must instead be derived
  // fresh from `now` (which itself refreshes on focus) on every render.
  it("advances the default range's end to include a transaction from the day after mount, once refocused", async () => {
    mockNow = now;

    // Calendar-day stepping (never `now + DAY_MS`), so the fixture lands on the
    // local day after mount even when the suite runs right at a local
    // midnight boundary.
    const dayAfterMount = new Date(now);
    dayAfterMount.setDate(dayAfterMount.getDate() + 1);
    dayAfterMount.setHours(1, 0, 0, 0);

    const tomorrow: Transaction = {
      id: 'tomorrow',
      holdingId: 'h1',
      time: dayAfterMount.getTime(),
      amountMinorUnits: -50_00,
      category: 'groceries',
    };

    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: [tomorrow],
      history: HISTORY,
      categories: CATEGORIES,
    });

    const { getByTestId, getByText } = await renderScreen();

    // Not yet focus-refreshed past `now`: tomorrow's expense falls outside the
    // default range, so the donut shows its empty state.
    expect(getByTestId('category-pie-empty')).toBeTruthy();

    await act(async () => {
      advanceFocusedNow(localDaysFrom(now, 1));
    });

    const centerTotal = within(getByTestId('category-pie-center-total'));
    const advancedRange = defaultDateRange(localDaysFrom(now, 1));

    expect(centerTotal.getByText('50.00 ₴')).toBeTruthy();
    expect(
      getByText(`${formatDate(advancedRange.from)} – ${formatDate(advancedRange.to)}`),
    ).toBeTruthy();
  });

  describe('Loan interest', () => {
    // A single-installment (termMonths: 1) annuity loan whose one due date
    // falls exactly on "now" (`addMonths(startDate, 1)` reconstructs today's
    // Y/M/D from a start one calendar month earlier), so a payment a couple
    // of days before "now" lands comfortably inside the schedule's window.
    // 900,000.00 principal at 12% annual (1% monthly) gives 9,000.00 interest.
    const startDate = (() => {
      const date = new Date(now);
      date.setMonth(date.getMonth() - 1);

      return date.getTime();
    })();
    const LOAN_META = {
      kind: 'personal',
      principalMinorUnits: 900_000_00,
      startDate,
      annualRatePct: 12,
      termMonths: 1,
      schedule: 'annuity',
    };
    const LOAN_HOLDING: Holding = {
      id: 'loan1',
      accountId: 'b',
      currency: 'UAH',
      type: 'loan',
      balanceMinorUnits: 0,
      metadata: LOAN_META,
      closedAt: null,
    };
    const INFORMAL_LOAN_HOLDING: Holding = {
      id: 'loan-informal',
      accountId: 'b',
      currency: 'UAH',
      type: 'loan',
      balanceMinorUnits: 0,
      metadata: { kind: 'personal', principalMinorUnits: 50_000_00, startDate, schedule: 'none' },
      closedAt: null,
    };
    const LOAN_CATEGORIES: CategoryRow[] = [
      ...CATEGORIES,
      { key: 'loan_interest', title: 'Loan interest', icon: 'percent' },
    ];

    it('a linked -12,000 payment with installment interest 9,000 shows 9,000 under Loan interest, nothing from the raw row', async () => {
      const linkedPayment: Transaction = {
        id: 'lp1',
        holdingId: 'h1',
        time: localDaysFrom(now, -2),
        amountMinorUnits: -12_000_00,
        category: 'groceries',
        loanHoldingId: 'loan1',
      };

      setLiveData({
        accounts: [CASH, BANK],
        holdings: [UAH_HOLDING, USD_HOLDING, LOAN_HOLDING],
        rates: [USD_UAH_RATE],
        transactions: [linkedPayment],
        history: HISTORY,
        categories: LOAN_CATEGORIES,
      });

      const { getByTestId, queryByTestId } = await renderScreen();

      expect(getByTestId('category-pie-arc-loan_interest')).toBeTruthy();
      expect(queryByTestId('category-pie-arc-groceries')).toBeNull();
      const centerTotal = within(getByTestId('category-pie-center-total'));
      expect(centerTotal.getByText('9,000.00 ₴')).toBeTruthy();
    });

    it('an informal (none-schedule) linked loan payment counts 0 interest — no slice at all', async () => {
      const informalPayment: Transaction = {
        id: 'lp2',
        holdingId: 'h1',
        time: localDaysFrom(now, -2),
        amountMinorUnits: -12_000_00,
        category: 'groceries',
        loanHoldingId: 'loan-informal',
      };

      setLiveData({
        accounts: [CASH, BANK],
        holdings: [UAH_HOLDING, USD_HOLDING, INFORMAL_LOAN_HOLDING],
        rates: [USD_UAH_RATE],
        transactions: [informalPayment],
        history: HISTORY,
        categories: LOAN_CATEGORIES,
      });

      const { getByTestId, queryByTestId } = await renderScreen();

      expect(getByTestId('category-pie-empty')).toBeTruthy();
      expect(queryByTestId('category-pie-arc-loan_interest')).toBeNull();
      expect(queryByTestId('category-pie-arc-groceries')).toBeNull();
    });

    it('an unlinked payment counts in full under its own category', async () => {
      const unlinkedPayment: Transaction = {
        id: 'lp3',
        holdingId: 'h1',
        time: localDaysFrom(now, -2),
        amountMinorUnits: -12_000_00,
        category: 'groceries',
      };

      setLiveData({
        accounts: [CASH, BANK],
        holdings: [UAH_HOLDING, USD_HOLDING, LOAN_HOLDING],
        rates: [USD_UAH_RATE],
        transactions: [unlinkedPayment],
        history: HISTORY,
        categories: LOAN_CATEGORIES,
      });

      const { getByTestId, queryByTestId } = await renderScreen();

      expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
      expect(queryByTestId('category-pie-arc-loan_interest')).toBeNull();
      const centerTotal = within(getByTestId('category-pie-center-total'));
      expect(centerTotal.getByText('12,000.00 ₴')).toBeTruthy();
    });

    it('a payment linked to a MISSING loan holding counts as normal spending', async () => {
      const danglingPayment: Transaction = {
        id: 'lp4',
        holdingId: 'h1',
        time: localDaysFrom(now, -2),
        amountMinorUnits: -12_000_00,
        category: 'groceries',
        loanHoldingId: 'ghost-loan',
      };

      setLiveData({
        accounts: [CASH, BANK],
        // The loan holding this payment links to is absent entirely (deleted).
        holdings: [UAH_HOLDING, USD_HOLDING],
        rates: [USD_UAH_RATE],
        transactions: [danglingPayment],
        history: HISTORY,
        categories: LOAN_CATEGORIES,
      });

      const { getByTestId, queryByTestId } = await renderScreen();

      expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
      expect(queryByTestId('category-pie-arc-loan_interest')).toBeNull();
      const centerTotal = within(getByTestId('category-pie-center-total'));
      expect(centerTotal.getByText('12,000.00 ₴')).toBeTruthy();
    });

    it('feeds the derived interest into the spending trend too', async () => {
      const linkedPayment: Transaction = {
        id: 'lp1',
        holdingId: 'h1',
        time: localDaysFrom(now, -2),
        amountMinorUnits: -12_000_00,
        category: 'groceries',
        loanHoldingId: 'loan1',
      };

      setLiveData({
        accounts: [CASH, BANK],
        holdings: [UAH_HOLDING, USD_HOLDING, LOAN_HOLDING],
        rates: [USD_UAH_RATE],
        transactions: [linkedPayment],
        history: HISTORY,
        categories: LOAN_CATEGORIES,
      });

      const { getByTestId } = await renderScreen();

      expect(getByTestId('category-trend-line-line-loan_interest')).toBeTruthy();
    });
  });
});

describe('StatisticsScreen — loading gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading spinner, not an empty chart, while any of its own queries is on its first load', async () => {
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: HISTORY,
      isLoading: { transactions: true },
    });

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('statistics-loading')).toBeTruthy();
    expect(queryByTestId('statistics-blocks')).toBeNull();
    // The net-worth line's own EXISTING empty-state testID (never its real
    // "no data" state) must not render while the screen's own queries are
    // still on their first load — that bug renders as a real chart, not
    // this loading spinner.
    expect(queryByTestId('net-worth-line-empty')).toBeNull();
    expect(queryByTestId('bar-chart-empty')).toBeNull();
  });

  it('renders the real charts once every query has loaded', async () => {
    seedFull();

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('statistics-blocks')).toBeTruthy();
    expect(queryByTestId('statistics-loading')).toBeNull();
  });

  it('renders loading then loaded on ONE mounted instance — spinner first, then the real charts, via rerender', async () => {
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: HISTORY,
      isLoading: { transactions: true },
    });
    const view = await renderScreen();

    expect(view.getByTestId('statistics-loading')).toBeTruthy();
    expect(view.queryByTestId('statistics-blocks')).toBeNull();

    seedFull();
    await act(async () => {
      view.rerender(<StatisticsScreen />);
    });

    expect(view.queryByTestId('statistics-loading')).toBeNull();
    expect(view.getByTestId('statistics-blocks')).toBeTruthy();
    expect(view.getByTestId('bar-chart-bar-cash')).toBeTruthy();
  });
});

describe('StatisticsScreen — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedFull();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the card titles and category-donut empty label from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByText } = await renderScreen();

    expect(getByText('Капітал з часом')).toBeTruthy();
    expect(getByText('Витрати за категоріями')).toBeTruthy();
  });

  it('preserves an active category filter selection across a live language switch, relabeling the option to its Ukrainian catalog title', async () => {
    // The category donut's filter keys its identity/matching on the STABLE
    // `categories.key` slug ('groceries'), not the resolved display title, so
    // switching the app language live must not reset the selection: the
    // option's stable value is unaffected, only its rendered LABEL changes.
    seedSpending();

    const { getByTestId, getAllByText, queryByTestId } = await renderScreen();

    await pressFilter(getByTestId, CATEGORY_FILTER, 'groceries');
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(queryByTestId('category-pie-arc-transport')).toBeNull();

    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    // The selection survived the language switch: the same slice stays
    // filtered in/out — the Set was not silently cleared.
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(queryByTestId('category-pie-arc-transport')).toBeNull();

    // The option itself now renders the Ukrainian catalog label, still keyed
    // on the same stable `groceries` value and still checked.
    await act(async () => {
      await fireEvent.press(getByTestId(CATEGORY_FILTER));
    });
    expect(
      getByTestId(`${CATEGORY_FILTER}-option-groceries`).props.accessibilityState?.checked,
    ).toBe(true);
    // Rendered twice — the open filter menu's option row and the pie's own
    // legend entry — so assert at least one instance rather than a single
    // unique match.
    expect(getAllByText('Продукти').length).toBeGreaterThan(0);
  });
});

// kiko-architecture: no request or query for data the user does not have —
// usePriceBook's price_points read is disabled while nothing on this screen
// is a priced type (property_item/metal) or a loan.
describe('StatisticsScreen — the price_points gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables the price_points read when no holding needs it', async () => {
    setLiveData({
      holdings: [{ id: 'h1', accountId: 'a', currency: 'UAH', type: 'card', balanceMinorUnits: 0 }],
    });
    await renderScreen();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(false);
  });

  it('enables the price_points read once a priced holding is present', async () => {
    setLiveData({
      holdings: [
        { id: 'h1', accountId: 'a', currency: 'UAH', type: 'metal', balanceMinorUnits: 0 },
      ],
    });
    await renderScreen();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });

  it('reads price_points in parallel while holdings are still on their first load', async () => {
    setLiveData({ isLoading: { holdings: true } });
    await renderScreen();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });

  // Only a loan reads its linked payments, so a priced-only screen never
  // runs the linked-payments read.
  it('reads the linked loan payments only once a loan is present', async () => {
    const loanPaymentsCall = () =>
      mockUseLiveQuery.mock.calls.find((call) => call[1].join(',') === 'transactions,holdings');

    setLiveData({ holdings: [{ ...UAH_HOLDING, type: 'metal' }] });
    await renderScreen();
    expect(loanPaymentsCall()?.[2]).toBe(false);

    mockUseLiveQuery.mockClear();
    setLiveData({ holdings: [{ ...UAH_HOLDING, type: 'loan' }] });
    await renderScreen();
    expect(loanPaymentsCall()?.[2]).toBe(true);
  });
});

// While another tab shows, Statistics keeps its subscriptions but defers
// every read, so a write elsewhere causes no re-render, no memo recompute,
// and no state change here — `paused`, not `enabled` (which would
// unsubscribe and drop to `[]`, see kiko-architecture).
describe('StatisticsScreen — paused while hidden', () => {
  const PAUSED_TABLES = [
    'accounts',
    'holdings',
    'currency_rates',
    'settings',
    'transactions',
    'currency_rate_history',
    'categories',
  ];

  const callFor = (table: string) =>
    mockUseLiveQuery.mock.calls.find((call) => (call[1] as string[])[0] === table);

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseIsFocused.mockReturnValue(true);
    seedFull();
  });

  it('pauses the 7 direct live queries while unfocused, without changing their own enabled argument', async () => {
    mockUseIsFocused.mockReturnValue(false);
    await renderScreen();

    for (const table of PAUSED_TABLES) {
      const call = callFor(table);

      expect(call?.[2]).toBe(true);
      expect(call?.[3]).toEqual({ cached: true, paused: true });
    }
  });

  it('unpauses the 7 direct live queries while focused', async () => {
    await renderScreen();

    for (const table of PAUSED_TABLES) {
      expect(callFor(table)?.[3]).toEqual({ cached: true, paused: false });
    }
  });

  it('pauses usePriceBook the same way while unfocused', async () => {
    mockUseIsFocused.mockReturnValue(false);
    await renderScreen();

    expect(callFor('price_points')?.[3]).toEqual({ cached: true, paused: true });
  });

  it('never lets a query on this screen skip the paused flag', async () => {
    await renderScreen();

    expect(mockUseLiveQuery.mock.calls.length).toBeGreaterThan(0);

    for (const call of mockUseLiveQuery.mock.calls) {
      const options = call[3] as Record<string, unknown> | undefined;

      expect(options !== undefined && 'paused' in options).toBe(true);
    }
  });

  // Mirrors use-live-query.ts's own paused/dirty contract (see
  // use-live-query.test.ts's "paused option" describe block): a call made
  // with `paused: true` never applies a pending write and hands back the
  // SAME array reference; a call made with `paused: false` applies the one
  // pending write, if any, as a NEW reference, and otherwise (nothing
  // pending) also keeps the same reference — so a screen render downstream
  // of this stub only sees new data exactly when the real hook would have
  // read one. `writeWhileHidden` simulates another tab's write landing
  // while this table is paused, without itself forcing a render (a real
  // write is a native-side event, never a React state update here).
  const createPausedAwareLiveQuery = (
    initial: LiveData,
  ): { writeWhileHidden: (overrides: Record<string, unknown[]>) => void } => {
    const committed = buildLiveDataByTable(initial);
    const pending = new Map<string, unknown[]>();

    mockUseLiveQuery.mockImplementation(
      (_query: unknown, tables: string[], _enabled: boolean, options?: { paused?: boolean }) => {
        const table = tables[0];

        if (!(options?.paused ?? false) && pending.has(table)) {
          committed[table] = pending.get(table) as unknown[];
          pending.delete(table);
        }

        return { data: committed[table] ?? [], isLoading: false, isFresh: true };
      },
    );

    return {
      writeWhileHidden: (overrides: Record<string, unknown[]>): void => {
        for (const [table, rows] of Object.entries(overrides)) {
          pending.set(table, rows);
        }
      },
    };
  };

  it('recomputes the net-worth series exactly once for a hidden-tab write, applied together with the now refresh on return — never while still paused', async () => {
    const stub = createPausedAwareLiveQuery({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: HISTORY,
    });

    const { rerender } = await renderScreen();
    expect(mockBuildNetWorthSeries).toHaveBeenCalledTimes(1);

    mockUseIsFocused.mockReturnValue(false);
    await act(async () => {
      rerender(<StatisticsScreen />);
    });
    expect(mockBuildNetWorthSeries).toHaveBeenCalledTimes(1);

    // A write elsewhere while this tab is hidden: deferred, so a render that
    // is still paused must not pick it up — this is what would catch a
    // regression that reads eagerly regardless of `paused`.
    stub.writeWhileHidden({
      transactions: [
        ...TRANSACTIONS,
        { id: 't4', holdingId: 'h1', time: localDaysFrom(now, -1), amountMinorUnits: 25_00 },
      ],
    });
    await act(async () => {
      rerender(<StatisticsScreen />);
    });
    expect(mockBuildNetWorthSeries).toHaveBeenCalledTimes(1);

    // The return: the deferred write applies (a real focus's own read) AND
    // `now` refreshes (a real focus's own setNow) — together, ONE recompute.
    advanceFocusedNow(localDaysFrom(now, 1));
    mockUseIsFocused.mockReturnValue(true);
    await act(async () => {
      rerender(<StatisticsScreen />);
    });
    expect(mockBuildNetWorthSeries).toHaveBeenCalledTimes(2);
  });

  it('does not re-trigger the backfill on a blur/focus toggle alone, even once the now dependency refreshes on the return', async () => {
    const { rerender } = await renderScreen();
    const callsBefore = mockRunBackfill.mock.calls.length;

    mockUseIsFocused.mockReturnValue(false);
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    advanceFocusedNow(localDaysFrom(now, 1));
    mockUseIsFocused.mockReturnValue(true);
    await act(async () => {
      rerender(<StatisticsScreen />);
    });

    expect(mockRunBackfill.mock.calls.length).toBe(callsBefore);
  });
});
