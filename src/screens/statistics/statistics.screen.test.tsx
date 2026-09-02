import { act, fireEvent, render } from '@testing-library/react-native';
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

type Account = { id: string; name: string; archivedAt?: number | null };
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
type Transaction = { id: string; holdingId: string; time: number; amountMinorUnits: number };
type LiveData = {
  accounts?: Account[];
  holdings?: Holding[];
  rates?: Rate[];
  settings?: Settings[];
  transactions?: Transaction[];
};

// Feed each `useLiveQuery` call by the first table name it watches, exactly as
// the Home screen test does — the screen's five queries key off distinct tables.
const setLiveData = (data: LiveData): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
    currency_rates: data.rates ?? [],
    settings: data.settings ?? [{ baseCurrency: 'UAH' }],
    transactions: data.transactions ?? [],
  };
  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
  }));
};

const DAY = 86_400_000;
const now = Date.now();

const CASH: Account = { id: 'a', name: 'Cash' };
const BANK: Account = { id: 'b', name: 'Bank' };

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
  type: 'cash',
  balanceMinorUnits: 5_000,
  metadata: null,
  closedAt: null,
};

// USD converts to the UAH base so the Bank account produces a pie slice.
const USD_UAH_RATE: Rate = { base: 'USD', quote: 'UAH', rate: '40' };

const TRANSACTIONS: Transaction[] = [
  { id: 't1', holdingId: 'h1', time: now - 3 * DAY, amountMinorUnits: 50_000 },
  { id: 't2', holdingId: 'h1', time: now - DAY, amountMinorUnits: 50_000 },
  { id: 't3', holdingId: 'h2', time: now - 3 * DAY, amountMinorUnits: 5_000 },
];

const seedFull = (): void =>
  setLiveData({
    accounts: [CASH, BANK],
    holdings: [UAH_HOLDING, USD_HOLDING],
    rates: [USD_UAH_RATE],
    transactions: TRANSACTIONS,
  });

const renderScreen = (): ReturnType<typeof render> => render(<StatisticsScreen />);

// Open one filter menu, tap an option row, then dismiss via the backdrop —
// self-contained so each call leaves the sheet closed. Mirrors the Home test.
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

describe('StatisticsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedFull();
  });

  it('renders a line-chart series and legend per currency', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('line-chart-series-UAH')).toBeTruthy();
    expect(getByTestId('line-chart-series-USD')).toBeTruthy();
    expect(getByTestId('line-chart-legend-UAH')).toBeTruthy();
    expect(getByTestId('line-chart-legend-USD')).toBeTruthy();
  });

  it('renders a pie-chart arc and legend per contributing account', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('pie-chart-arc-a')).toBeTruthy();
    expect(getByTestId('pie-chart-arc-b')).toBeTruthy();
    expect(getByTestId('pie-chart-legend-a')).toBeTruthy();
    expect(getByTestId('pie-chart-legend-b')).toBeTruthy();
  });

  it('drops the deselected account from the pie when the account filter narrows', async () => {
    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('pie-chart-arc-b')).toBeTruthy();

    await pressFilter(getByTestId, ACCOUNT_FILTER, 'Cash');

    expect(getByTestId('pie-chart-arc-a')).toBeTruthy();
    expect(queryByTestId('pie-chart-arc-b')).toBeNull();
  });

  it('changes the line-chart geometry when the date range is applied', async () => {
    const { getByTestId, getByLabelText, getByText } = await renderScreen();

    const before = getByTestId('line-chart-series-UAH').props.points;

    await act(async () => {
      fireEvent.press(getByLabelText('Date range'));
    });
    await act(async () => {
      fireEvent.press(getByText('Apply'));
    });

    const after = getByTestId('line-chart-series-UAH').props.points;
    expect(after).not.toBe(before);
  });

  it('renders both empty charts without crashing when there is no data', async () => {
    setLiveData({});

    const { getByTestId } = await renderScreen();

    expect(getByTestId('line-chart-empty')).toBeTruthy();
    expect(getByTestId('pie-chart-empty')).toBeTruthy();
  });
});
