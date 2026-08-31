import { render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import HomeScreen from './home.screen';

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
  transactionsRepo: { listAllWithContextQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

type Account = { id: string; name: string; kind: string; archivedAt?: number | null };
type Holding = {
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
};

/**
 * Drive the five `useLiveQuery` calls by the table they subscribe to, so the
 * mock survives re-renders (a sequential once-chain returns undefined after the
 * first render and crashes on the next). Keyed data still exercises the exact
 * call order the screen must use — asserted separately below.
 */
const setLiveData = (data: {
  accounts?: Account[];
  holdings?: Holding[];
  rates?: Rate[];
  settings?: Settings[];
  transactions?: Transaction[];
}): void => {
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

const navigation = { navigate: jest.fn() } as never;

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  amountMinorUnits: -5000,
  currency: 'UAH',
  time: 1,
  description: 'Coffee',
  category: 'Food',
  accountId: 'a',
  accountName: 'Monobank',
  holdingName: 'Card',
  ...overrides,
});

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100000 }],
      rates: [],
      settings: [{ baseCurrency: 'UAH' }],
      transactions: [transaction()],
    });
  });

  it('renders the net worth caption', async () => {
    const { getByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getByText('Net worth')).toBeTruthy();
  });

  it('renders the total net worth in the base currency', async () => {
    const { getAllByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getAllByText(/1,000\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('renders a transaction description', async () => {
    const { getByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getByText('Coffee')).toBeTruthy();
  });

  it('renders the account-name and category label for a transaction', async () => {
    const { getByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getByText('Monobank · Food')).toBeTruthy();
  });

  it('renders the signed transaction amount', async () => {
    const { getByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getByText(/-50\.00 ₴/)).toBeTruthy();
  });

  it('renders a dash when the description is empty', async () => {
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100000 }],
      transactions: [transaction({ description: '', category: null })],
    });
    const { getByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getByText('—')).toBeTruthy();
    expect(getByText('Monobank · Uncategorized')).toBeTruthy();
  });

  it('applies a rate from the rates table to convert a foreign holding', async () => {
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      holdings: [{ accountId: 'a', currency: 'USD', balanceMinorUnits: 10000 }],
      rates: [{ base: 'USD', quote: 'UAH', rate: '40' }],
      settings: [{ baseCurrency: 'UAH' }],
    });
    const { getAllByText } = await render(<HomeScreen navigation={navigation} />);
    // 100.00 USD * 40 = 4,000.00 UAH
    expect(getAllByText(/4,000\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('does not crash when a holding has no rate; excludes it and hints at rates', async () => {
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      holdings: [{ accountId: 'a', currency: 'BTC', balanceMinorUnits: 100000000 }],
      rates: [],
      settings: [{ baseCurrency: 'UAH' }],
    });
    const { getByText, getAllByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getByText(/rates unavailable/i)).toBeTruthy();
    expect(getAllByText(/0\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('excludes holdings whose parent account is archived from the total', async () => {
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank', archivedAt: 123 }],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100000 }],
      settings: [{ baseCurrency: 'UAH' }],
    });
    const { getAllByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getAllByText(/0\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('excludes closed holdings from the total', async () => {
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100000, closedAt: 99 }],
      settings: [{ baseCurrency: 'UAH' }],
    });
    const { getAllByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getAllByText(/0\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('reads accounts, holdings, rates, settings, then transactions in that order', async () => {
    await render(<HomeScreen navigation={navigation} />);
    const tablesInOrder = mockUseLiveQuery.mock.calls.slice(0, 5).map(call => call[1][0]);
    expect(tablesInOrder).toEqual([
      'accounts',
      'holdings',
      'currency_rates',
      'settings',
      'transactions',
    ]);
  });
});
