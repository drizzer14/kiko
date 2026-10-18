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

import { act, fireEvent, render, within } from '@testing-library/react-native';

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

const renderScreen = () => render(<StatisticsScreen />);

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
