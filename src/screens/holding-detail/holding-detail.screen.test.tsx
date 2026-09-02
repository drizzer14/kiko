import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import HoldingDetailScreen from './holding-detail.screen';

const mockUseLiveQuery = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../../repositories/transactions.repo', () => ({
  transactionsRepo: {
    listByHoldingQuery: (holdingId: string) => ({
      toSQL: () => ({ sql: '', params: [holdingId] }),
    }),
  },
}));

const navigation = { navigate: jest.fn(), setOptions: jest.fn() } as never;
const route = { params: { holdingId: 'h-1' } } as never;

describe('HoldingDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets the header title to the holding name', async () => {
    const holding = {
      id: 'h-1',
      name: 'My deposit',
      type: 'cash',
      currency: 'UAH',
      balanceMinorUnits: 0,
    };
    mockUseLiveQuery
      .mockReturnValueOnce({ data: [holding] }) // holdings
      .mockReturnValueOnce({ data: [] }); // transactions

    await render(<HoldingDetailScreen navigation={navigation} route={route} />);

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'My deposit' });
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const holding = {
      id: 'h-1',
      name: 'My deposit',
      type: 'cash',
      currency: 'UAH',
      balanceMinorUnits: 0,
    };
    mockUseLiveQuery
      .mockReturnValueOnce({ data: [holding] }) // holdings
      .mockReturnValueOnce({ data: [] }); // transactions

    const { getByTestId, queryByText } = await render(
      <HoldingDetailScreen navigation={navigation} route={route} />,
    );

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The header large title is now the single title; the in-body duplicate is
    // gone (the section heading "Transactions" stays).
    expect(queryByText('My deposit')).toBeNull();
  });

  it('shows the computed value and accrued interest for a term deposit', async () => {
    const holding = {
      id: 'h-1',
      name: 'My deposit',
      type: 'term_deposit',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        principalMinorUnits: 100_000,
        annualRatePct: 12,
        startDate: Date.UTC(2026, 0, 1),
        termMonths: 24,
        recapitalization: false,
        compounding: 'monthly',
      },
    };
    mockUseLiveQuery
      .mockReturnValueOnce({ data: [holding] }) // holdings
      .mockReturnValueOnce({ data: [] }); // transactions

    const { getByText } = await render(
      <HoldingDetailScreen navigation={navigation} route={route} />,
    );

    expect(getByText('Value')).toBeTruthy();
    expect(getByText('Accrued interest')).toBeTruthy();
  });

  it('shows the shared default description for a transaction with an empty description', async () => {
    const holding = {
      id: 'h-1',
      name: 'Everyday card',
      type: 'card',
      currency: 'UAH',
      balanceMinorUnits: 0,
    };
    mockUseLiveQuery
      .mockReturnValueOnce({ data: [holding] }) // holdings
      .mockReturnValueOnce({
        data: [
          { id: 'x1', amountMinorUnits: -5000, time: 1, description: '' },
          { id: 'x2', amountMinorUnits: 5000, time: 2, description: '' },
        ],
      }); // transactions

    const { getByText } = await render(
      <HoldingDetailScreen navigation={navigation} route={route} />,
    );

    expect(getByText('Everyday card expense')).toBeTruthy();
    expect(getByText('Everyday card income')).toBeTruthy();
  });

  it('opens the transaction form for the tapped row, keyed by its id', async () => {
    const holding = {
      id: 'h-1',
      name: 'Everyday card',
      type: 'card',
      currency: 'UAH',
      balanceMinorUnits: 0,
    };
    mockUseLiveQuery
      .mockReturnValueOnce({ data: [holding] }) // holdings
      .mockReturnValueOnce({
        data: [{ id: 'txn-7', amountMinorUnits: -5000, time: 1, description: 'Coffee' }],
      }); // transactions

    const { getByText } = await render(
      <HoldingDetailScreen navigation={navigation} route={route} />,
    );

    await fireEvent.press(getByText('Coffee'));

    expect(navigation.navigate).toHaveBeenCalledWith('TransactionForm', { transactionId: 'txn-7' });
  });

  it('hides accrued interest when none accrues (recapitalization on)', async () => {
    const holding = {
      id: 'h-1',
      name: 'My deposit',
      type: 'term_deposit',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        principalMinorUnits: 100_000,
        annualRatePct: 12,
        startDate: Date.UTC(2026, 0, 1),
        termMonths: 24,
        recapitalization: true,
        compounding: 'monthly',
      },
    };
    mockUseLiveQuery
      .mockReturnValueOnce({ data: [holding] }) // holdings
      .mockReturnValueOnce({ data: [] }); // transactions

    const { getByText, queryByText } = await render(
      <HoldingDetailScreen navigation={navigation} route={route} />,
    );

    expect(getByText('Value')).toBeTruthy();
    expect(queryByText('Accrued interest')).toBeNull();
  });
});
