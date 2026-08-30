import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { TransactionFormScreen } from './transaction-form.screen';

const mockAdd = jest.fn();
const mockSetBalance = jest.fn();
const mockUseLiveQuery = jest.fn();

jest.mock('../../repositories/transactions.repo', () => ({
  transactionsRepo: { add: (...args: unknown[]) => mockAdd(...args) },
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setBalance: (...args: unknown[]) => mockSetBalance(...args),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

describe('TransactionFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLiveQuery.mockReturnValue({
      data: [{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0 }],
    });
  });

  it('submits a manual transaction', async () => {
    const route = { params: { holdingId: 'h1' } } as never;
    const navigation = { goBack: jest.fn() } as never;
    const { getByLabelText, getByText } = await render(
      <TransactionFormScreen route={route} navigation={navigation} />,
    );
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await fireEvent.changeText(getByLabelText('Description'), 'Coffee');
    await fireEvent.press(getByText('Save'));
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        holdingId: 'h1',
        amountMinorUnits: 1234,
        description: 'Coffee',
        source: 'manual',
      }),
    );
  });

  it('negates the amount and adjusts the holding balance for an expense', async () => {
    mockUseLiveQuery.mockReturnValue({
      data: [{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000 }],
    });
    const route = { params: { holdingId: 'h1' } } as never;
    const navigation = { goBack: jest.fn() } as never;
    const { getByLabelText, getByText } = await render(
      <TransactionFormScreen route={route} navigation={navigation} />,
    );
    await fireEvent.changeText(getByLabelText('Amount'), '10.00');
    await fireEvent.press(getByText('Expense'));
    await fireEvent.press(getByText('Save'));
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ amountMinorUnits: -1000 }));
    expect(mockSetBalance).toHaveBeenCalledWith('h1', 4000);
  });
});
