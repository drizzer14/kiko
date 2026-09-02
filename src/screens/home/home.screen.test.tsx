import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { SEEDED_CATEGORIES } from '../../repositories/__fixtures__/seeded-categories';
// Prefixed `mock*` so Jest's hoisted mock factory may reference it. Exposes the
// resolved MoneyText `tone` via a testID — see the module for the full rationale.
import mockTextTone from '../../test-support/mock-text-tone';
import HomeScreen from './home.screen';
import { FILTER_ALL } from './transaction-filter-bar.component';

jest.mock('../../design-system/components/text', () => ({
  __esModule: true,
  default: mockTextTone,
}));

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
jest.mock('../../repositories/categories.repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
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
type Category = { key: string; title: string; icon: string };

type LiveData = {
  accounts?: Account[];
  holdings?: Holding[];
  rates?: Rate[];
  settings?: Settings[];
  transactions?: Transaction[];
  categories?: Category[];
};

/**
 * Drive the five `useLiveQuery` calls by the table they subscribe to, so the
 * mock survives re-renders (a sequential once-chain returns undefined after the
 * first render and crashes on the next). Keyed data still exercises the exact
 * call order the screen must use — asserted separately below.
 */
const setLiveData = (data: LiveData): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
    currency_rates: data.rates ?? [],
    settings: data.settings ?? [{ baseCurrency: 'UAH' }],
    transactions: data.transactions ?? [],
    // Default to the production-seeded rows so category resolution behaves as
    // it would on device unless a test overrides it (e.g. a rename).
    categories: data.categories ?? SEEDED_CATEGORIES,
  };
  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
  }));
};

const navigation = { navigate: jest.fn() } as never;

const MONOBANK: Account = { id: 'a', name: 'Monobank', kind: 'bank' };
const PRIVATBANK: Account = { id: 'b', name: 'PrivatBank', kind: 'bank' };
const UAH_HOLDING: Holding = { accountId: 'a', currency: 'UAH', balanceMinorUnits: 100000 };

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

// Seed the live data with the standard single Monobank account + UAH holding,
// letting each test override only the dimension it exercises.
const seed = (data: LiveData = {}): void =>
  setLiveData({ accounts: [MONOBANK], holdings: [UAH_HOLDING], ...data });

const renderHome = (): ReturnType<typeof render> => render(<HomeScreen navigation={navigation} />);

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seed({ transactions: [transaction()] });
  });

  it('renders the net worth caption', async () => {
    const { getByText } = await renderHome();
    expect(getByText('Net worth')).toBeTruthy();
  });

  it('renders the total net worth in the base currency', async () => {
    const { getAllByText } = await renderHome();
    expect(getAllByText(/1,000\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('renders a transaction description', async () => {
    const { getByText } = await renderHome();
    expect(getByText('Coffee')).toBeTruthy();
  });

  it('renders the account-name and the resolved category title for a transaction', async () => {
    seed({ transactions: [transaction({ category: 'Groceries' })] });
    const { getByText } = await renderHome();
    expect(getByText('Monobank · Groceries')).toBeTruthy();
  });

  it('resolves each row title + icon from the categories repo, following a rename', async () => {
    // The `groceries` category has been renamed away from its seeded
    // "Groceries"/"cart" defaults, so the row must follow the repo, not the
    // stored raw key or any hard-coded map.
    seed({
      categories: [{ key: 'groceries', title: 'Supermarket', icon: 'basket' }],
      transactions: [transaction({ category: 'Groceries', description: 'Milk' })],
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
    expect(getByText('Monobank · Uncategorized')).toBeTruthy();
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
    const { getAllByText } = await renderHome();
    // 100.00 USD * 40 = 4,000.00 UAH
    expect(getAllByText(/4,000\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('does not crash when a holding has no rate; excludes it from the total but still lists it', async () => {
    seed({
      holdings: [{ accountId: 'a', currency: 'BTC', balanceMinorUnits: 100000000 }],
      rates: [],
      transactions: [],
    });
    const { getByText, getAllByText, queryByText } = await renderHome();
    // The unconvertible holding is dropped from the converted headline total...
    expect(getAllByText(/0\.00 ₴/).length).toBeGreaterThan(0);
    // ...but the per-currency breakdown still lists it, and there is no
    // "Rates unavailable" fallback anymore.
    expect(getByText('BTC')).toBeTruthy();
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

  it('omits the "Rates unavailable" state and still lists every currency when a rate is missing', async () => {
    seed({
      holdings: [UAH_HOLDING, { accountId: 'a', currency: 'BTC', balanceMinorUnits: 100000000 }],
      rates: [],
      transactions: [],
    });
    const { getByText, queryByText } = await renderHome();
    expect(queryByText(/rates unavailable/i)).toBeNull();
    expect(getByText('UAH')).toBeTruthy();
    expect(getByText('BTC')).toBeTruthy();
  });

  it('renders a positive net worth in the balance tone (white / textPrimary)', async () => {
    const { getAllByText } = await renderHome();
    // The headline amount is rendered before the breakdown lines, so the first
    // match is the net-worth MoneyText — assert its resolved balance tone.
    const [netWorth] = getAllByText(/1,000\.00 ₴/);
    expect(netWorth.props.testID).toBe('text-tone-textPrimary');
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
    const { getByText, queryByText } = await renderHome();
    expect(getByText('Coffee')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();

    await fireEvent.press(getByText('Monobank'));

    expect(getByText('Coffee')).toBeTruthy();
    expect(queryByText('Groceries')).toBeNull();
  });

  it('keeps both categories active and shows transactions from either when two are toggled on', async () => {
    seed({
      transactions: [
        transaction({ id: 't1', category: 'Food', description: 'Coffee' }),
        transaction({ id: 't2', category: 'Transport', description: 'Groceries' }),
        transaction({ id: 't3', category: 'Housing', description: 'Rent' }),
      ],
    });
    const { getByText, queryByText } = await renderHome();

    await fireEvent.press(getByText('Food'));
    await fireEvent.press(getByText('Transport'));

    expect(getByText('Coffee')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();
    expect(queryByText('Rent')).toBeNull();
  });

  it('removes a category from the set when its chip is toggled off again', async () => {
    seed({
      transactions: [
        transaction({ id: 't1', category: 'Food', description: 'Coffee' }),
        transaction({ id: 't2', category: 'Transport', description: 'Groceries' }),
      ],
    });
    const { getByText, queryByText } = await renderHome();

    await fireEvent.press(getByText('Food'));
    await fireEvent.press(getByText('Transport'));
    await fireEvent.press(getByText('Food'));

    expect(queryByText('Coffee')).toBeNull();
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('clears the category dimension and shows every transaction when All is pressed', async () => {
    seed({
      transactions: [
        transaction({ id: 't1', category: 'Food', description: 'Coffee' }),
        transaction({ id: 't2', category: 'Transport', description: 'Groceries' }),
      ],
    });
    const { getByText, getAllByText, queryByText } = await renderHome();

    await fireEvent.press(getByText('Food'));
    expect(queryByText('Groceries')).toBeNull();

    // The category row's `All` chip is the second `All` (the account row's is first).
    await fireEvent.press(getAllByText(FILTER_ALL)[1]);

    expect(getByText('Coffee')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();
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
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    // Ordered newest-first as the repo query (orderBy time desc) delivers them.
    seed({
      transactions: [
        transaction({ id: 't1', time: now, description: 'TodayTxn' }),
        transaction({ id: 't2', time: now - day, description: 'YesterdayTxn' }),
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

  it('renders a locale-formatted date separator for an older day (not Today/Yesterday)', async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const older = now - 5 * day;
    const expectedHeader = new Date(
      new Date(older).getFullYear(),
      new Date(older).getMonth(),
      new Date(older).getDate(),
    ).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
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
          category: 'Food',
          description: 'Coffee',
        }),
        transaction({
          id: 't2',
          accountId: 'b',
          accountName: 'PrivatBank',
          category: 'Transport',
          description: 'Groceries',
        }),
      ],
    });
    const { getByText } = await renderHome();

    await fireEvent.press(getByText('Monobank'));
    await fireEvent.press(getByText('Transport'));

    expect(getByText('No transactions')).toBeTruthy();
  });

  it('reads accounts, holdings, rates, settings, then transactions in that order', async () => {
    await renderHome();
    const tablesInOrder = mockUseLiveQuery.mock.calls.slice(0, 5).map((call) => call[1][0]);
    expect(tablesInOrder).toEqual([
      'accounts',
      'holdings',
      'currency_rates',
      'settings',
      'transactions',
    ]);
  });
});
