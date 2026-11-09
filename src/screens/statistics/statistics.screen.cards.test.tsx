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
  useScrollToTopOnTabPress: () => undefined,
}));

jest.mock('@kiko/design-system/use-visible-refreshed-now/use-visible-refreshed-now', () => ({
  useVisibleRefreshedNow: () => Date.now(),
}));

const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
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
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setTrendFilter: jest.fn(),
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

import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { ACCOUNT_FILTER, pressFilterOption } from '@kiko/test-support/statistics-filter-data';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import '@kiko/design-system/unistyles';

import StatisticsScreen from './statistics.screen';

const MORTGAGE = {
  id: 'loan-1',
  accountId: 'a',
  currency: 'UAH',
  type: 'loan',
  balanceMinorUnits: 0,
  metadata: {
    kind: 'mortgage',
    principalMinorUnits: 500_000,
    startDate: Date.now(),
    annualRatePct: 10,
    termMonths: 120,
    schedule: 'annuity',
  },
  closedAt: null,
};

const tables: Record<string, unknown[]> = {
  accounts: [{ id: 'a', name: 'Cash', kind: 'cash', color: null }],
  holdings: [MORTGAGE],
  currency_rates: [],
  settings: [{ baseCurrency: 'UAH' }],
  transactions: [],
  currency_rate_history: [],
  categories: [],
  price_points: [],
};

// The net-worth plot carries the scrub line's GestureDetector, which needs a root view.
const renderScreen = () => render(<StatisticsScreen />, { wrapper: GestureRootWrapper });

const cryptoHolding = (id: string, accountId: string, metadata: Record<string, string>) => ({
  id,
  accountId,
  currency: 'USDT',
  type: 'crypto',
  balanceMinorUnits: 1_000_000,
  metadata,
  closedAt: null,
});

const EXCHANGE_ACCOUNTS = [
  { id: 'binance', name: 'Binance', kind: 'crypto', color: null, institution: 'binance' },
  { id: 'bybit', name: 'Bybit', kind: 'crypto', color: null, institution: 'bybit' },
];

const EXCHANGE_HOLDINGS = [
  cryptoHolding('binance-usdt', 'binance', { binanceAsset: 'USDT' }),
  cryptoHolding('bybit-usdt', 'bybit', { bybitAsset: 'USDT' }),
];

const BYBIT_PAST_LIMITS_EN =
  "Bybit: the past of this line can be off. Kiko cannot read every move: P2P credits, Earn yield and stakes, interest, bonuses, loans, stocks, card spending, sub-account moves and derivatives, or anything older than two years. It can also rarely count a move twice. Your current balances are not affected. The account's details say more. A coin Kiko could not read stays on this line at its last read balance, or stays off it with no earlier sync.";

const seedExchanges = (
  accounts: readonly Record<string, unknown>[],
  holdings: readonly Record<string, unknown>[],
): void => {
  const byTable: Record<string, unknown[]> = {
    ...tables,
    accounts: [...accounts],
    holdings: [...holdings],
  };

  mockUseLiveQuery.mockImplementation((_query: unknown, watched: string[]) => ({
    data: byTable[watched[0]] ?? [],
    isLoading: false,
    isFresh: true,
  }));
};

describe('StatisticsScreen net worth card past limits line', () => {
  afterEach(resetStatisticsFilterSelection);

  it('the net worth card shows the Bybit limits line only with a Bybit account in scope', async () => {
    seedExchanges(EXCHANGE_ACCOUNTS, EXCHANGE_HOLDINGS);

    const { getByTestId } = await renderScreen();

    expect(
      within(getByTestId('statistics-block-line')).getByText(BYBIT_PAST_LIMITS_EN),
    ).toBeTruthy();

    await pressFilterOption(getByTestId, ACCOUNT_FILTER, 'binance');

    expect(
      within(getByTestId('statistics-block-line')).queryByText(BYBIT_PAST_LIMITS_EN),
    ).toBeNull();
  });

  it('shows no limits line for a world with a Binance account and no Bybit account', async () => {
    seedExchanges([EXCHANGE_ACCOUNTS[0]], [EXCHANGE_HOLDINGS[0]]);

    const { getByTestId } = await renderScreen();

    expect(
      within(getByTestId('statistics-block-line')).queryByText(/^Bybit: the past of this line/),
    ).toBeNull();
  });

  it('shows the limits line under the chart, on no other card', async () => {
    seedExchanges(EXCHANGE_ACCOUNTS, EXCHANGE_HOLDINGS);

    const { getByTestId } = await renderScreen();

    for (const testID of [
      'statistics-block-bar',
      'statistics-block-pie',
      'statistics-block-trend',
    ]) {
      expect(within(getByTestId(testID)).queryByText(/^Bybit: the past of this line/)).toBeNull();
    }
  });

  it('shows the line once when two Bybit accounts are in scope', async () => {
    seedExchanges(
      [...EXCHANGE_ACCOUNTS, { ...EXCHANGE_ACCOUNTS[1], id: 'bybit-two', name: 'Bybit two' }],
      [...EXCHANGE_HOLDINGS, cryptoHolding('two-usdt', 'bybit-two', { bybitAsset: 'USDT' })],
    );

    const { getByTestId } = await renderScreen();

    expect(
      within(getByTestId('statistics-block-line')).getAllByText(/^Bybit: the past of this line/),
    ).toHaveLength(1);
  });
});

describe('StatisticsScreen cards', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockImplementation((_query: unknown, watched: string[]) => ({
      data: tables[watched[0]] ?? [],
      isLoading: false,
      isFresh: true,
    }));
  });

  it.each([
    ['statistics-block-bar', 'By Type'],
    ['statistics-block-pie', 'Account Contribution'],
    ['statistics-block-trend', 'Spending Trend by Category'],
  ])('titles the %s card %s', async (testID, heading) => {
    const { getByTestId } = await renderScreen();

    expect(within(getByTestId(testID)).getByText(heading)).toBeTruthy();
  });

  it('labels the debts total row Debts', async () => {
    const { getByTestId } = await renderScreen();

    expect(within(getByTestId('statistics-debts-total')).getByText('Debts')).toBeTruthy();
  });

  it('opens the category filter sheet titled Categories from the trigger of the same label', async () => {
    const { getByLabelText, getByTestId, queryAllByText } = await renderScreen();
    const titlesBefore = queryAllByText('Categories').length;

    expect(getByLabelText('Categories')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(getByTestId('statistics-category-filter'));
    });

    expect(queryAllByText('Categories')).toHaveLength(titlesBefore + 1);
  });
});
