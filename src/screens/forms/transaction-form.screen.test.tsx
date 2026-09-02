import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import TransactionFormScreen from './transaction-form.screen';

const mockRecordManual = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
const mockUseLiveQuery = jest.fn();

jest.mock('../../repositories/transactions.repo', () => ({
  transactionsRepo: {
    recordManual: (...args: unknown[]) => mockRecordManual(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    getByIdQuery: (transactionId: string) => ({
      toSQL: () => ({ sql: '', params: [transactionId] }),
    }),
  },
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

type Holding = { id: string; currency: string; balanceMinorUnits: number };
type Transaction = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  description: string;
  source: 'manual' | 'monobank';
};

const setLiveData = (holdings: Holding[], transaction?: Transaction): void => {
  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => {
    if (tables[0] === 'holdings') {
      return { data: holdings };
    }
    if (tables[0] === 'transactions') {
      return { data: transaction ? [transaction] : [] };
    }

    return { data: [] };
  });
};

const navigation = { goBack: jest.fn(), setOptions: jest.fn() } as never;

const renderAdd = (): ReturnType<typeof render> => {
  const route = { params: { holdingId: 'h1' } } as never;

  return render(<TransactionFormScreen route={route} navigation={navigation} />);
};

const renderEdit = (transactionId: string): ReturnType<typeof render> => {
  const route = { params: { transactionId } } as never;

  return render(<TransactionFormScreen route={route} navigation={navigation} />);
};

describe('TransactionFormScreen — add mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0 }]);
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const { getByTestId, queryByText } = await renderAdd();
    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The static stack header title "Add transaction" is now the single title;
    // the in-body duplicate is gone.
    expect(queryByText('Add transaction')).toBeNull();
  });

  it('sets the header title to "Add Transaction"', async () => {
    await renderAdd();
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Add Transaction' });
  });

  it('submits a manual transaction', async () => {
    const { getByLabelText, getByText } = await renderAdd();
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
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('negates the amount for an expense', async () => {
    const { getByLabelText, getByText } = await renderAdd();
    await fireEvent.changeText(getByLabelText('Amount'), '10.00');
    await fireEvent.press(getByText('Expense'));
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ holdingId: 'h1', amountMinorUnits: -1000 }),
    );
  });

  it('does not submit when the amount is empty', async () => {
    const { getByLabelText, getByText } = await renderAdd();
    await fireEvent.changeText(getByLabelText('Description'), 'No amount');
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).not.toHaveBeenCalled();
  });
});

describe('TransactionFormScreen — edit mode (manual)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000 }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
    });
  });

  it('sets the header title to "Edit Transaction"', async () => {
    await renderEdit('txn-1');
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Transaction' });
  });

  it('pre-fills the amount, description and sign from the existing transaction', async () => {
    const { getByLabelText } = await renderEdit('txn-1');
    expect(getByLabelText('Amount').props.value).toBe('12.34');
    expect(getByLabelText('Description').props.value).toBe('Coffee');
    // A negative stored amount pre-selects the Expense sign.
    expect(getByLabelText('Amount').props.editable).not.toBe(false);
  });

  it('calls update (not recordManual) with the transaction id and edited amount on save', async () => {
    const { getByLabelText, getByText } = await renderEdit('txn-1');
    await fireEvent.changeText(getByLabelText('Amount'), '20.00');
    await fireEvent.press(getByText('Save'));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'txn-1',
        // Still an expense: -20.00 UAH.
        amountMinorUnits: -2000,
      }),
    );
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('deletes the transaction and navigates back after confirmation', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = (buttons ?? []).find((button) => button.style === 'destructive');
      destructive?.onPress?.();
    });
    mockRemove.mockResolvedValue(undefined);
    const { getByText } = await renderEdit('txn-1');
    await fireEvent.press(getByText('Delete'));
    expect(mockRemove).toHaveBeenCalledWith('txn-1');
    await Promise.resolve();
    expect(navigation.goBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('TransactionFormScreen — read-only mode (monobank)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000 }], {
      id: 'txn-9',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Imported latte',
      source: 'monobank',
    });
  });

  it('sets the header title to "Transaction"', async () => {
    await renderEdit('txn-9');
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Transaction' });
  });

  it('disables the inputs and shows the imported-from-Monobank explanation', async () => {
    const { getByLabelText, getByText } = await renderEdit('txn-9');
    expect(getByLabelText('Amount').props.editable).toBe(false);
    expect(getByLabelText('Description').props.editable).toBe(false);
    expect(getByText(/imported from monobank/i)).toBeTruthy();
  });

  it('offers no Save action and never writes', async () => {
    const { queryByText } = await renderEdit('txn-9');
    expect(queryByText('Save')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('offers no Delete action for a synced transaction', async () => {
    const { queryByText } = await renderEdit('txn-9');
    expect(queryByText('Delete')).toBeNull();
  });
});
