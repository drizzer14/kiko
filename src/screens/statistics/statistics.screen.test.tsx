// The rate-history repo opens the op-sqlite connection at module load (it is
// imported for real so `rateTableAt`, which `buildNetWorthSeries` calls, stays
// the real implementation). Stub the native module so it loads without a
// database, mirroring the net-worth-series builder test.
// The backfill orchestration reaches the network. Keep the pure helpers
// (`missingDays`, `deriveLastBackfilledDay`) real, but stub `runBackfill` with a
// never-resolving promise so the screen's mount effect leaves the line in its
// `loading` state without hitting NBU/CoinGecko.
const mockRunBackfill = jest.fn(() => new Promise<never>(() => {}));

jest.mock('../../rates/history-backfill', () => {
  const actual = jest.requireActual('../../rates/history-backfill');

  return { ...actual, runBackfill: (...args: unknown[]) => mockRunBackfill(...args) };
});

import { act, fireEvent, render } from '@testing-library/react-native';

import { toUtcMidnight } from '../../rates/history-entry';
import '../../design-system/unistyles';
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
jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
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
  useScrollToTopOnTabPress: (ref: unknown) => mockUseScrollToTopOnTabPress(ref),
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
type Settings = { baseCurrency: string };
type Transaction = {
  id: string;
  holdingId: string;
  time: number;
  amountMinorUnits: number;
  category?: string | null;
  mcc?: number | null;
  counterIban?: string | null;
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
    transactions: data.transactions ?? [],
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

const renderOrder = (root: ReturnType<typeof render>): JSONNode[] => {
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

  it('renders the four blocks in order: net-worth line, by-type bar, account pie, category pie', async () => {
    const { getByTestId } = await renderScreen();

    const order = getByTestId('statistics-blocks')
      .children.map((child) => (typeof child === 'string' ? undefined : child.props.testID))
      .filter((id): id is string => typeof id === 'string' && id.startsWith('statistics-block-'));

    // The net-worth line leads the screen, ahead of the by-type/category
    // charts — it is the one chart every other block on this screen relates
    // back to (a snapshot of the same net worth it plots over time).
    expect(order).toEqual([
      'statistics-block-line',
      'statistics-block-bar',
      'statistics-block-pie',
      'statistics-block-category',
    ]);
  });

  it('renders a by-type bar, the net-worth polyline, and a pie arc per account', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('bar-chart-bar-cash')).toBeTruthy();
    expect(getByTestId('bar-chart-bar-card')).toBeTruthy();
    expect(getByTestId('net-worth-line-polyline')).toBeTruthy();
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
    expect(queryByTestId('net-worth-line-polyline')).toBeNull();
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

    const { getByTestId, getByText } = await renderScreen();

    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(getByTestId('category-pie-arc-transport')).toBeTruthy();
    // The category filter is a closed dropdown button (no chips), so each title
    // shows once — in its pie legend row.
    expect(getByText('Groceries')).toBeTruthy();
    expect(getByText('Transport')).toBeTruthy();
    expect(getByTestId('category-pie-legend-groceries')).toBeTruthy();
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

    // Selecting one category (by its title) narrows the pie to just it — the
    // same include-narrowing model the account filter uses.
    await pressFilter(getByTestId, CATEGORY_FILTER, 'Groceries');

    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(queryByTestId('category-pie-arc-transport')).toBeNull();

    // Toggling that same selection back off clears the dimension, so all
    // categories return to the pie.
    await pressFilter(getByTestId, CATEGORY_FILTER, 'Groceries');

    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
    expect(getByTestId('category-pie-arc-transport')).toBeTruthy();
  });
});
