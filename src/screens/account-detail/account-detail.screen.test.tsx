import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { AccountDetailScreen } from './account-detail.screen';

const mockUseLiveQuery = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    listByAccountQuery: (accountId: string) => ({
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
  },
}));

type Holding = {
  id: string;
  name: string;
  currency: string;
  balanceMinorUnits: number;
  closedAt?: number | null;
};

const setHoldings = (holdings: Holding[]): void => {
  mockUseLiveQuery.mockReturnValue({ data: holdings });
};

const route = { params: { accountId: 'a' } } as never;

describe('AccountDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setHoldings([{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }]);
  });

  it('lists holdings for the account', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByText } = await render(
      <AccountDetailScreen route={route} navigation={navigation} />,
    );
    expect(getByText('Black card')).toBeTruthy();
  });

  it('shows the holding balance as money', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByText } = await render(
      <AccountDetailScreen route={route} navigation={navigation} />,
    );
    expect(getByText(/1,000\.00 UAH/)).toBeTruthy();
  });

  it('navigates to HoldingDetail when a holding row is pressed', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByText } = await render(
      <AccountDetailScreen route={route} navigation={navigation} />,
    );
    await fireEvent.press(getByText('Black card'));
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingDetail', { holdingId: 'h1' });
  });

  it('excludes closed holdings from the list', async () => {
    setHoldings([
      { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000, closedAt: null },
      {
        id: 'h2',
        name: 'Closed jar',
        currency: 'UAH',
        balanceMinorUnits: 5000,
        closedAt: 1_700_000_000_000,
      },
    ]);
    const navigation = { navigate: jest.fn() } as never;
    const { getByText, queryByText } = await render(
      <AccountDetailScreen route={route} navigation={navigation} />,
    );
    expect(getByText('Black card')).toBeTruthy();
    expect(queryByText('Closed jar')).toBeNull();
  });

  it('navigates to HoldingForm when Add holding is pressed', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByText } = await render(
      <AccountDetailScreen route={route} navigation={navigation} />,
    );
    await fireEvent.press(getByText('Add holding'));
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', { accountId: 'a' });
  });
});
