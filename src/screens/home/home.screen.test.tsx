import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { HomeScreen } from './home.screen';

const mockUseLiveQuery = jest.fn();
const mockSetBaseCurrency = jest.fn();
const mockRunSync = jest.fn();
const mockRefreshRates = jest.fn();

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
  ratesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    latestFetchedAt: () => Promise.resolve(null),
  },
}));
jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setBaseCurrency: (...args: unknown[]) => mockSetBaseCurrency(...args),
  },
}));
jest.mock('../../monobank/sync', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));
jest.mock('../../rates/rates-refresh', () => ({
  refreshRates: (...args: unknown[]) => mockRefreshRates(...args),
}));

type Account = { id: string; name: string; kind: string };
type Holding = { accountId: string; currency: string; balanceMinorUnits: number };
type Rate = { base: string; quote: string; rate: string };
type Settings = { baseCurrency: string };

/**
 * Drive the four `useLiveQuery` calls by the table they subscribe to, so the
 * mock survives re-renders (a sequential once-chain returns undefined after the
 * first render and crashes on the next). Keyed data still exercises the exact
 * call order the screen must use — asserted separately below.
 */
const setLiveData = (data: {
  accounts?: Account[];
  holdings?: Holding[];
  rates?: Rate[];
  settings?: Settings[];
}): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
    currency_rates: data.rates ?? [],
    settings: data.settings ?? [{ baseCurrency: 'UAH' }],
  };
  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
  }));
};

const navigation = { navigate: jest.fn() } as never;

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunSync.mockResolvedValue({ importedTransactions: 0 });
    mockRefreshRates.mockResolvedValue(undefined);
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100000 }],
      rates: [],
      settings: [{ baseCurrency: 'UAH' }],
    });
  });

  it('renders the screen title', async () => {
    const { getByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getByText('Home')).toBeTruthy();
  });

  it('renders the account name', async () => {
    const { getByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getByText('Monobank')).toBeTruthy();
  });

  it('renders the total net worth in the base currency', async () => {
    const { getAllByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getAllByText(/1,000\.00 UAH/).length).toBeGreaterThan(0);
  });

  it('navigates to AccountDetail when an account row is pressed', async () => {
    const { getByText } = await render(<HomeScreen navigation={navigation} />);
    await fireEvent.press(getByText('Monobank'));
    expect(navigation.navigate).toHaveBeenCalledWith('AccountDetail', { accountId: 'a' });
  });

  it('navigates to AccountForm when Add account is pressed', async () => {
    const { getByText } = await render(<HomeScreen navigation={navigation} />);
    await fireEvent.press(getByText('Add account'));
    expect(navigation.navigate).toHaveBeenCalledWith('AccountForm', {});
  });

  it('calls runSync then refreshRates when Sync is pressed', async () => {
    const { getByText } = await render(<HomeScreen navigation={navigation} />);
    await fireEvent.press(getByText('Sync'));
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalled());
    expect(mockRunSync).toHaveBeenCalled();
  });

  it('shows an error message when sync fails, without crashing', async () => {
    mockRunSync.mockRejectedValue(new Error('sync boom'));
    const { findByText, getByText } = await render(<HomeScreen navigation={navigation} />);
    await fireEvent.press(getByText('Sync'));
    expect(await findByText(/sync boom/i)).toBeTruthy();
  });

  it('calls setBaseCurrency when a currency option is pressed', async () => {
    const { getByText } = await render(<HomeScreen navigation={navigation} />);
    await fireEvent.press(getByText('USD'));
    expect(mockSetBaseCurrency).toHaveBeenCalledWith('USD');
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
    expect(getAllByText(/4,000\.00 UAH/).length).toBeGreaterThan(0);
  });

  it('does not crash when a holding has no rate; excludes it and hints to sync', async () => {
    setLiveData({
      accounts: [{ id: 'a', name: 'Monobank', kind: 'bank' }],
      holdings: [{ accountId: 'a', currency: 'BTC', balanceMinorUnits: 100000000 }],
      rates: [],
      settings: [{ baseCurrency: 'UAH' }],
    });
    const { getByText, getAllByText } = await render(<HomeScreen navigation={navigation} />);
    expect(getByText(/rates unavailable/i)).toBeTruthy();
    // The unconvertible BTC holding is excluded, so the total is zero.
    expect(getAllByText(/0\.00 UAH/).length).toBeGreaterThan(0);
  });

  it('reads accounts, holdings, rates, then settings in that order', async () => {
    await render(<HomeScreen navigation={navigation} />);
    const tablesInOrder = mockUseLiveQuery.mock.calls.slice(0, 4).map(call => call[1][0]);
    expect(tablesInOrder).toEqual(['accounts', 'holdings', 'currency_rates', 'settings']);
  });
});
