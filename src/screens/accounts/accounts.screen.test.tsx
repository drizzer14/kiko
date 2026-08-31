import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import AccountsScreen from './accounts.screen';

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

type Account = { id: string; name: string; kind: string; archivedAt?: number | null };
type Holding = {
  accountId: string;
  currency: string;
  balanceMinorUnits: number;
  closedAt?: number | null;
};
type Rate = { base: string; quote: string; rate: string };
type Settings = { baseCurrency: string };

/**
 * Drive the four `useLiveQuery` calls by the table they subscribe to, so the
 * mock survives re-renders (a sequential once-chain returns undefined after the
 * first render and crashes on the next).
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

describe('AccountsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({
      accounts: [
        { id: 'a', name: 'Monobank', kind: 'bank' },
        { id: 'b', name: 'Old Cash', kind: 'cash', archivedAt: 123 },
      ],
      holdings: [{ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100000 }],
      rates: [],
      settings: [{ baseCurrency: 'UAH' }],
    });
  });

  it('renders an active account with its name and balance', async () => {
    const { getByText } = await render(
      <AccountsScreen navigation={navigation} route={{} as never} />,
    );
    expect(getByText('Monobank')).toBeTruthy();
    expect(getByText(/1,000\.00 ₴/)).toBeTruthy();
  });

  it('does not render an archived account', async () => {
    const { queryByText } = await render(
      <AccountsScreen navigation={navigation} route={{} as never} />,
    );
    expect(queryByText('Old Cash')).toBeNull();
  });

  it('navigates to AccountDetail when a row is pressed', async () => {
    const { getByText } = await render(
      <AccountsScreen navigation={navigation} route={{} as never} />,
    );
    await fireEvent.press(getByText('Monobank'));
    expect(navigation.navigate).toHaveBeenCalledWith('AccountDetail', { accountId: 'a' });
  });

  it('navigates to AccountForm when "Add account" is pressed', async () => {
    const { getByText } = await render(
      <AccountsScreen navigation={navigation} route={{} as never} />,
    );
    await fireEvent.press(getByText('Add account'));
    expect(navigation.navigate).toHaveBeenCalledWith('AccountForm', {});
  });

  it('renders an empty state when there are no active accounts', async () => {
    setLiveData({
      accounts: [{ id: 'b', name: 'Old Cash', kind: 'cash', archivedAt: 123 }],
      holdings: [],
      rates: [],
      settings: [{ baseCurrency: 'UAH' }],
    });
    const { getByText } = await render(
      <AccountsScreen navigation={navigation} route={{} as never} />,
    );
    expect(getByText('No accounts yet')).toBeTruthy();
  });
});
