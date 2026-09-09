// The rate-history repo opens the op-sqlite connection at module load (it is
// imported for real so `rateTableAt`, which `buildNetWorthSeries` calls, stays
// the real implementation). Stub the native module so it loads without a
// database, mirroring the net-worth-series builder test.
// The backfill orchestration reaches the network. Keep the pure helpers
// (`missingDays`, `deriveLastBackfilledDay`) real, but stub `runBackfill` with a
// never-resolving promise so the screen's mount effect leaves the line in its
// `loading` state without hitting NBU/CoinGecko.
const mockRunBackfill = jest.fn((..._args: unknown[]) => new Promise<never>(() => {}));

jest.mock('../../rates/history-backfill', () => {
  const actual = jest.requireActual('../../rates/history-backfill');

  return { ...actual, runBackfill: (...args: unknown[]) => mockRunBackfill(...args) };
});

import { act, fireEvent, render, within } from '@testing-library/react-native';

import { defaultDateRange } from '../../dates/default-range';
import { formatDate } from '../../dates/format';
import { startOfLocalDay } from '../../dates/local-day';
import { i18n } from '../../i18n';
import { toUtcMidnight } from '../../rates/history-entry';
import { categoryColor } from '../../statistics/category-breakdown';
import '../../design-system/unistyles';
import { FILTER_ALL } from '../home/filter-menu';

import StatisticsScreen from './statistics.screen';

const mockUseLiveQuery = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: { listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../../repositories/rates.repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
const mockSetTrendCategoryKeys = jest.fn();
jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setTrendCategoryKeys: (...args: unknown[]) => mockSetTrendCategoryKeys(...args),
  },
}));
jest.mock('../../repositories/transactions.repo', () => ({
  transactionsRepo: { listAllQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../../repositories/categories.repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

// The active-tab re-tap → scroll-to-top hook reads the navigation context, which
// a standalone screen render lacks; stand it in with a spy so this test can
// assert the screen hands it the scroll view's own ref.
const mockUseScrollToTopOnTabPress = jest.fn();
jest.mock('../../navigation/use-scroll-to-top-on-tab-press', () => ({
  useScrollToTopOnTabPress: (ref: unknown, scrollOffset: unknown) =>
    mockUseScrollToTopOnTabPress(ref, scrollOffset),
}));

type Account = {
  id: string;
  name: string;
  kind?: 'bank' | 'cash' | 'crypto';
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
type Settings = { baseCurrency: string; trendCategoryKeys?: string[] | null };
type Transaction = {
  id: string;
  holdingId: string;
  time: number;
  amountMinorUnits: number;
  category?: string | null;
  mcc?: number | null;
  counterIban?: string | null;
  exchangeCounterpartHoldingId?: string | null;
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
};

// Feed each `useLiveQuery` call by the first table name it watches — the screen's
// queries each key off a distinct table.
const setLiveData = (data: LiveData): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
    currency_rates: data.rates ?? [],
    settings: data.settings ?? [{ baseCurrency: 'UAH' }],
    // SQLite returns NULL, never undefined, for a column a row does not set, so
    // default every nullable marker the screen reads the same way — an
    // `undefined` here would be a fixture artefact the device never produces.
    transactions: (data.transactions ?? []).map((row) => ({
      exchangeCounterpartHoldingId: null,
      ...row,
    })),
    currency_rate_history: data.history ?? [],
    categories: data.categories ?? [],
  };
  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
  }));
};

const DAY = 86_400_000;
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
  { id: 't1', holdingId: 'h1', time: now - 3 * DAY, amountMinorUnits: 50_000 },
  { id: 't2', holdingId: 'h1', time: now - DAY, amountMinorUnits: 50_000 },
  { id: 't3', holdingId: 'h2', time: now - 3 * DAY, amountMinorUnits: 5_000 },
];

// A historical USD->UAH row dated before the transaction span, so `rateTableAt`
// carries it forward to every bucket and the net-worth line has points to draw.
const HISTORY: HistoryRow[] = [
  { base: 'USD', quote: 'UAH', day: toUtcMidnight(now) - 5 * DAY, rate: '40', source: 'nbu' },
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
    time: now - 2 * DAY,
    amountMinorUnits: -300_00,
    category: 'groceries',
  },
  {
    id: 'e2',
    holdingId: 'h1',
    time: now - 2 * DAY,
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
    time: now - 2 * DAY,
    amountMinorUnits: -300_00,
    category: 'groceries',
  },
  {
    id: 'x2',
    holdingId: 'h1',
    time: now - 2 * DAY,
    amountMinorUnits: -100_00,
    category: 'transport',
  },
  {
    id: 'x3',
    holdingId: 'h1',
    time: now - 2 * DAY,
    amountMinorUnits: -50_00,
    category: 'transfers',
  },
];

// The three-category spending dataset, with an optional SAVED trend selection
// seeded onto the single settings row (null = no saved selection).
const seedTrend = (trendCategoryKeys: string[] | null): void =>
  setLiveData({
    accounts: [CASH, BANK],
    holdings: [UAH_HOLDING, USD_HOLDING],
    rates: [USD_UAH_RATE],
    transactions: THREE_EXPENSES,
    history: HISTORY,
    categories: CATEGORIES,
    settings: [{ baseCurrency: 'UAH', trendCategoryKeys }],
  });

// The two legs of a card-to-card self-transfer: a categorized debit on one UAH
// card and its equal-and-opposite credit on another, timestamped the same
// instant. The debit leg would otherwise surface as a "Transfers" spending slice
// even though no money left the user's own holdings.
const SELF_TRANSFER: Transaction[] = [
  {
    id: 'st-out',
    holdingId: 'h1',
    time: now - 2 * DAY,
    amountMinorUnits: -200_00,
    category: 'transfers',
  },
  {
    id: 'st-in',
    holdingId: 'h3',
    time: now - 2 * DAY,
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
    time: now - 2 * DAY,
    amountMinorUnits: -500_00,
    category: 'cash',
    mcc: 6011,
    counterIban: null,
  },
  {
    id: 'm-own',
    holdingId: 'h1',
    time: now - 2 * DAY,
    amountMinorUnits: -200_00,
    category: 'transfers',
    mcc: 4829,
    counterIban: OWN_IBAN,
  },
  {
    id: 'm-p2p',
    holdingId: 'h1',
    time: now - 2 * DAY,
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
    time: now - 2 * DAY,
    amountMinorUnits: -10_000_00,
    category: null,
    exchangeCounterpartHoldingId: 'h2',
  },
  {
    id: 'ex-in',
    holdingId: 'h2',
    time: now - 2 * DAY,
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
    time: now - 2 * DAY,
    amountMinorUnits: -10_000_00,
    category: 'transport',
    exchangeCounterpartHoldingId: 'h2',
  },
  {
    id: 'cv-new',
    holdingId: 'h2',
    time: now - 2 * DAY,
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
    fireEvent.press(getByTestId(menuTestID));
  });
  await act(async () => {
    fireEvent.press(getByTestId(`${menuTestID}-option-${value}`));
  });
  await act(async () => {
    fireEvent.press(getByTestId(`${menuTestID}-backdrop`));
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

  it('drops the deselected account from both the bar and the pie when the filter narrows', async () => {
    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('bar-chart-bar-card')).toBeTruthy();
    expect(getByTestId('pie-chart-arc-b')).toBeTruthy();

    await pressFilter(getByTestId, ACCOUNT_FILTER, 'Cash');

    expect(getByTestId('bar-chart-bar-cash')).toBeTruthy();
    expect(queryByTestId('bar-chart-bar-card')).toBeNull();
    expect(getByTestId('pie-chart-arc-a')).toBeTruthy();
    expect(queryByTestId('pie-chart-arc-b')).toBeNull();
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
          time: now - 2 * DAY,
          amountMinorUnits: -940_00,
          category: 'groceries',
        },
        {
          id: 'c2',
          holdingId: 'h1',
          time: now - 2 * DAY,
          amountMinorUnits: -50_00,
          category: 'transport',
        },
        {
          id: 'c3',
          holdingId: 'h1',
          time: now - 2 * DAY,
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

    const { getByTestId, getByLabelText } = await renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId(CATEGORY_FILTER));
    });

    // The option icon (an SFSymbolView, mocked to a View) is labeled with the
    // category title, and carries the breakdown slice's own icon + resolved
    // color — proving the slice's icon/color reach the menu row rather than
    // being discarded.
    const grocery = getByLabelText('Groceries');
    expect(grocery.props.name).toBe('cart');
    expect(grocery.props.tintColor).toBeTruthy();
    expect(getByLabelText('Transport').props.name).toBe('car');
  });

  it('colors an uncolored category slice from the chart set hash', async () => {
    // The seeded categories carry no stored color, so the option tint is
    // `categoryColor(key)` — a hue from `chartSeriesDark`.
    seedSpending();

    const { getByTestId, getByLabelText } = await renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId(CATEGORY_FILTER));
    });

    expect(getByLabelText('Groceries').props.tintColor).toBe(categoryColor('groceries'));
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
      fireEvent.press(view.getByTestId(CATEGORY_FILTER));
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

  it('still excludes a self-transfer pair whose legs straddle the active range boundary', async () => {
    const MINUTE = 60_000;
    // The screen's own `rangeFrom` is the shared `startOfLocalDay` — TRUE
    // local midnight of the default range's `from` date, the SAME helper
    // `defaultDateRange` itself uses to seed `from` (statistics.screen.tsx
    // used to anchor this to `Date.UTC` instead, matching the rate-history
    // bucket system — that was the T-32 follow-up bug: a positive-UTC-offset
    // locale had its first 2-3 local hours of every day silently excluded).
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
  // range entirely — the T-32 follow-up bug this regression test targets.
  describe('local-day range start in a positive-UTC-offset zone (Kyiv)', () => {
    const originalTz = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'Europe/Kyiv';
    });
    afterAll(() => {
      process.env.TZ = originalTz;
    });

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

  it('excludes an expense outside the active date range from the donut center total', async () => {
    // One expense inside the default 30-day window, one 60 days back (well
    // outside it). If the donut summed the whole ledger instead of the active
    // range, the center total would read 1,000.00 (both) instead of 100.00
    // (the in-range expense alone).
    const insideRangeExpense: Transaction = {
      id: 'inside-range',
      holdingId: 'h1',
      time: now - 5 * DAY,
      amountMinorUnits: -100_00,
      category: 'groceries',
    };
    const outsideRangeExpense: Transaction = {
      id: 'outside-range',
      holdingId: 'h1',
      time: now - 60 * DAY,
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

  it('draws a spending-trend line per category, seeding the top-3 by spend as the default selection', async () => {
    seedSpending();

    const { getByTestId } = await renderScreen();

    // With only two spending categories both fall inside the seeded top-3, so
    // both lines are drawn under the trend block's own filter.
    expect(getByTestId('statistics-block-trend')).toBeTruthy();
    expect(getByTestId('category-trend-line-line-groceries')).toBeTruthy();
    expect(getByTestId('category-trend-line-line-transport')).toBeTruthy();
  });

  it('narrows the spending-trend chart via its own filter, independent of the donut', async () => {
    seedSpending();

    const { getByTestId, queryByTestId } = await renderScreen();

    // Both categories seed the top-3 default selection, so toggling groceries
    // OFF deselects it — dropping its line while leaving transport — and the
    // donut's own groceries wedge is untouched (the two filters are separate).
    await pressFilter(getByTestId, 'statistics-trend-filter', 'groceries');

    expect(queryByTestId('category-trend-line-line-groceries')).toBeNull();
    expect(getByTestId('category-trend-line-line-transport')).toBeTruthy();
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
  });

  it('seeds the trend selection from the saved keys when present, not the top-3 preset', async () => {
    seedTrend(['transport']);

    const { getByTestId } = await renderScreen();

    // The saved single-category selection overrides the 3-key preset, so the
    // filter reads its count of 1 rather than the preset's 3.
    expect(within(getByTestId('statistics-trend-filter')).getByText('Categories · 1')).toBeTruthy();
  });

  it('seeds the trend selection from the top-3 preset when no saved selection exists', async () => {
    seedTrend(null);

    const { getByTestId } = await renderScreen();

    expect(within(getByTestId('statistics-trend-filter')).getByText('Categories · 3')).toBeTruthy();
  });

  it('applies the SAVED selection even when settings resolve AFTER the category slices', async () => {
    // Cold-start race: transactions + categories resolve first, while the
    // independent settings live query has NOT yet resolved (an empty [] row set).
    // The seed must NOT fire yet — if it seeded the live top-3 preset here, the
    // one-shot ref guard would permanently discard the user's persisted
    // selection for this session.
    const seedRows = {
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: THREE_EXPENSES,
      history: HISTORY,
      categories: CATEGORIES,
    };
    setLiveData({ ...seedRows, settings: [] });

    const view = await renderScreen();

    // Settings now resolves with the user's saved single-category selection.
    setLiveData({
      ...seedRows,
      settings: [{ baseCurrency: 'UAH', trendCategoryKeys: ['transport'] }],
    });
    await act(async () => {
      view.rerender(<StatisticsScreen />);
    });

    // The saved selection (1) wins over the top-3 preset (3) — proving the seed
    // waited for settings rather than latching the preset on the first render.
    expect(
      within(view.getByTestId('statistics-trend-filter')).getByText('Categories · 1'),
    ).toBeTruthy();
  });

  it('disables Save at the preset, enables it after a change, then persists the current keys', async () => {
    seedTrend(null);

    const { getByTestId } = await renderScreen();

    // At the preset (saved is null, current == preset) Save is a no-op.
    expect(getByTestId('statistics-trend-save')).toBeDisabled();

    // Deselecting one category moves current away from the preset.
    await pressFilter(getByTestId, 'statistics-trend-filter', 'groceries');

    const save = getByTestId('statistics-trend-save');
    expect(save).toBeEnabled();
    await act(async () => {
      fireEvent.press(save);
    });

    // Save persists the current selection (groceries removed, in insertion order).
    expect(mockSetTrendCategoryKeys).toHaveBeenCalledWith(['transport', 'transfers']);
  });

  it('disables both Save and Reset when the current selection equals the already-saved selection', async () => {
    seedTrend(['groceries', 'transport']);

    const { getByTestId } = await renderScreen();

    // Mounted showing exactly the saved set (which itself differs from the 3-key
    // preset): a re-save would be a no-op, so Save is disabled. Reset targets the
    // SAVED selection now, so at the saved set Reset is a no-op too and is disabled.
    expect(getByTestId('statistics-trend-save')).toBeDisabled();
    expect(getByTestId('statistics-trend-reset')).toBeDisabled();
  });

  it('disables Reset at the preset, enables it after a change, and reverts to the preset WITHOUT clearing the saved selection', async () => {
    seedTrend(null);

    const { getByTestId } = await renderScreen();

    // With no saved selection the Reset target is the live top-3 preset.
    expect(getByTestId('statistics-trend-reset')).toBeDisabled();

    await pressFilter(getByTestId, 'statistics-trend-filter', 'groceries');
    expect(within(getByTestId('statistics-trend-filter')).getByText('Categories · 2')).toBeTruthy();

    const reset = getByTestId('statistics-trend-reset');
    expect(reset).toBeEnabled();
    await act(async () => {
      fireEvent.press(reset);
    });

    // Reset restores the full top-3 preset and never clears the saved value.
    expect(within(getByTestId('statistics-trend-filter')).getByText('Categories · 3')).toBeTruthy();
    expect(mockSetTrendCategoryKeys).not.toHaveBeenCalled();
  });

  it('reverts to the SAVED selection (not the live preset) on Reset, and never clears the saved value', async () => {
    // A saved single-category selection is present; the Reset target is that
    // SAVED set, not the live top-3 preset.
    seedTrend(['transport']);

    const view = await renderScreen();
    const { getByTestId } = view;

    // Mounted at the saved set (count 1): Reset is a no-op there and disabled.
    expect(within(getByTestId('statistics-trend-filter')).getByText('Categories · 1')).toBeTruthy();
    expect(getByTestId('statistics-trend-reset')).toBeDisabled();

    // Add a category, moving current away from the saved target (count 2).
    await pressFilter(getByTestId, 'statistics-trend-filter', 'groceries');
    expect(within(getByTestId('statistics-trend-filter')).getByText('Categories · 2')).toBeTruthy();

    const reset = getByTestId('statistics-trend-reset');
    expect(reset).toBeEnabled();
    await act(async () => {
      fireEvent.press(reset);
    });

    // Reset restores the SAVED selection (count 1), NOT the 3-key preset, and
    // never writes to settings — the saved value is untouched.
    expect(within(getByTestId('statistics-trend-filter')).getByText('Categories · 1')).toBeTruthy();
    expect(mockSetTrendCategoryKeys).not.toHaveBeenCalled();

    // Genuine remount: the saved selection still resolves (Reset did not clear
    // it), so a fresh tree re-seeds off the saved set and reads count 1 again.
    const remounted = await renderScreen();
    expect(
      within(remounted.getByTestId('statistics-trend-filter')).getByText('Categories · 1'),
    ).toBeTruthy();
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

    // Narrow away from the 30-day default by picking a single day (today).
    await act(async () => {
      fireEvent.press(getByLabelText('Date range'));
    });
    const today = new Date();
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
      fireEvent.press(getByText('Apply'));
    });
    expect(getByText(`${formatDate(today)} – ${formatDate(today)}`)).toBeTruthy();

    // Clearing must land back on the 30-day default, NOT on all-time.
    await act(async () => {
      fireEvent.press(getByLabelText('Date range'));
    });
    await act(async () => {
      fireEvent.press(getByText('Clear'));
    });

    const range = defaultDateRange();
    expect(getByText(`${formatDate(range.from)} – ${formatDate(range.to)}`)).toBeTruthy();
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
      fireEvent.press(getByTestId(CATEGORY_FILTER));
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
