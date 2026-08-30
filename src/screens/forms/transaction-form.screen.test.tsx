import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { TransactionFormScreen } from './transaction-form.screen';

const mockRecordManual = jest.fn();
const mockUseLiveQuery = jest.fn();

jest.mock('../../repositories/transactions.repo', () => ({
  transactionsRepo: { recordManual: (...args: unknown[]) => mockRecordManual(...args) },
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
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
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({
        holdingId: 'h1',
        amountMinorUnits: 1234,
        description: 'Coffee',
      }),
    );
  });

  it('negates the amount for an expense', async () => {
    const route = { params: { holdingId: 'h1' } } as never;
    const navigation = { goBack: jest.fn() } as never;
    const { getByLabelText, getByText } = await render(
      <TransactionFormScreen route={route} navigation={navigation} />,
    );
    await fireEvent.changeText(getByLabelText('Amount'), '10.00');
    await fireEvent.press(getByText('Expense'));
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ holdingId: 'h1', amountMinorUnits: -1000 }),
    );
  });

  it('does not submit when the amount is empty', async () => {
    const route = { params: { holdingId: 'h1' } } as never;
    const navigation = { goBack: jest.fn() } as never;
    const { getByLabelText, getByText } = await render(
      <TransactionFormScreen route={route} navigation={navigation} />,
    );
    await fireEvent.changeText(getByLabelText('Description'), 'No amount');
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).not.toHaveBeenCalled();
  });
});
