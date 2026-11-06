import '@kiko/design-system/unistyles';
import { render, within } from '@testing-library/react-native';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import StatisticsScreen from './statistics.screen';

afterEach(resetStatisticsFilterSelection);

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
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    listAllQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    loanLedgerPaymentsQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/rates/history-backfill', () => ({
  ...jest.requireActual('@kiko/rates/history-backfill'),
  runBackfill: () => new Promise<never>(() => {}),
}));
jest.mock('@kiko/navigation/pane-stack', () => ({ useIsScreenVisible: () => true }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => false,
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('@kiko/navigation/use-scroll-to-top-on-tab-press', () => ({
  useScrollToTopOnTabPress: jest.fn(),
}));

const now = Date.now();

const BANK = { id: 'bank', name: 'Bank', kind: 'bank', color: null, archivedAt: null };

const CARD = {
  id: 'card',
  accountId: 'bank',
  currency: 'UAH',
  type: 'card',
  balanceMinorUnits: 0,
  metadata: null,
  closedAt: null,
};

const CATEGORIES = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'savings', title: 'Savings', icon: 'tray' },
];

const BASE_ROW = {
  holdingId: 'card',
  exchangePairId: null,
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  loanHoldingId: null,
  mcc: null,
  counterIban: null,
  description: '',
  categorySetByHand: false,
};

const GROCERIES = {
  ...BASE_ROW,
  id: 'groceries',
  time: localDaysFrom(now, -3),
  amountMinorUnits: -100_00,
  category: 'groceries',
  setsBalance: false,
};
const BALANCE_SET = {
  ...BASE_ROW,
  id: 'balance-set',
  time: localDaysFrom(now, -2),
  amountMinorUnits: -500_00,
  category: 'savings',
  setsBalance: true,
};
const UNMARKED_TWIN = { ...BALANCE_SET, id: 'unmarked-twin', setsBalance: false };

const CASH = { ...CARD, id: 'cash', type: 'cash' };
// The marked credit sits on another holding, a second later than the real debit it would have
// cancelled: inside the two-minute window of an own transfer.
const REAL_DEBIT = { ...BALANCE_SET, id: 'real-debit', setsBalance: false };
const SET_CREDIT = {
  ...BALANCE_SET,
  id: 'set-credit',
  holdingId: 'cash',
  time: REAL_DEBIT.time + 1_000,
  amountMinorUnits: 500_00,
};
const UNMARKED_CREDIT = { ...SET_CREDIT, id: 'unmarked-credit', setsBalance: false };

const seedLedger = (...extra: (typeof BALANCE_SET)[]): void =>
  seedHoldings([CARD], [GROCERIES, ...extra]);

const seedHoldings = (holdings: (typeof CARD)[], transactions: (typeof BALANCE_SET)[]): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: [BANK],
    holdings,
    currency_rates: [],
    settings: [{ baseCurrency: 'UAH' }],
    transactions,
    currency_rate_history: [],
    categories: CATEGORIES,
    price_points: [],
  };

  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
    isLoading: false,
    isFresh: true,
  }));
};

const renderScreen = (): ReturnType<typeof render> =>
  render(<StatisticsScreen />, { wrapper: GestureRootWrapper });

describe('StatisticsScreen with a row that sets a balance', () => {
  it('keeps a negative balance-set row out of the donut total and its slices', async () => {
    seedLedger(BALANCE_SET);

    const { getByTestId, queryByTestId } = await renderScreen();
    const centerTotal = within(getByTestId('category-pie-center-total'));

    expect(centerTotal.getByText('100.00 ₴')).toBeTruthy();
    expect(queryByTestId('category-pie-arc-savings')).toBeNull();
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
  });

  it('keeps a negative balance-set row out of the trend', async () => {
    seedLedger(BALANCE_SET);

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(queryByTestId('category-trend-line-line-savings')).toBeNull();
    expect(getByTestId('category-trend-line-line-groceries')).toBeTruthy();
  });

  it('counts an unmarked row of the same amount in the donut and the trend', async () => {
    seedLedger(UNMARKED_TWIN);

    const { getByTestId } = await renderScreen();
    const centerTotal = within(getByTestId('category-pie-center-total'));

    expect(centerTotal.getByText('600.00 ₴')).toBeTruthy();
    expect(getByTestId('category-pie-arc-savings')).toBeTruthy();
    expect(getByTestId('category-trend-line-line-savings')).toBeTruthy();
  });

  it('counts the unmarked row and leaves the marked one out when both exist', async () => {
    seedLedger(BALANCE_SET, UNMARKED_TWIN);

    const { getByTestId } = await renderScreen();
    const centerTotal = within(getByTestId('category-pie-center-total'));

    expect(centerTotal.getByText('600.00 ₴')).toBeTruthy();
  });

  it('counts a real debit in the donut and the trend when a marked credit of its amount sits on another holding', async () => {
    seedHoldings([CARD, CASH], [GROCERIES, SET_CREDIT, REAL_DEBIT]);

    const { getByTestId } = await renderScreen();
    const centerTotal = within(getByTestId('category-pie-center-total'));

    expect(centerTotal.getByText('600.00 ₴')).toBeTruthy();
    expect(getByTestId('category-pie-arc-savings')).toBeTruthy();
    expect(getByTestId('category-trend-line-line-savings')).toBeTruthy();
  });

  it('pairs the same two rows when the credit is unmarked, and counts neither', async () => {
    seedHoldings([CARD, CASH], [GROCERIES, UNMARKED_CREDIT, REAL_DEBIT]);

    const { getByTestId, queryByTestId } = await renderScreen();
    const centerTotal = within(getByTestId('category-pie-center-total'));

    expect(centerTotal.getByText('100.00 ₴')).toBeTruthy();
    expect(queryByTestId('category-pie-arc-savings')).toBeNull();
    expect(queryByTestId('category-trend-line-line-savings')).toBeNull();
  });
});
