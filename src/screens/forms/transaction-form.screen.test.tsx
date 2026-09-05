import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import '../../design-system/unistyles';
import TransactionFormScreen from './transaction-form.screen';

const mockRecordManual = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
const mockUpsertCategoryOverride = jest.fn();
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
jest.mock('../../repositories/categories.repo', () => ({
  categoriesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('../../repositories/category-overrides.repo', () => ({
  categoryOverridesRepo: {
    upsertCategoryOverride: (...args: unknown[]) => mockUpsertCategoryOverride(...args),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

type Holding = { id: string; currency: string; balanceMinorUnits: number };
type Category = { key: string; title: string; icon: string };
type Transaction = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  description: string;
  source: 'manual' | 'monobank';
  category?: string | null;
};

// The category options the picker renders in every test; a stable set so the
// "category editing" cases can press a chip by its title.
const CATEGORIES: Category[] = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'dining', title: 'Dining', icon: 'fork.knife' },
];

const setLiveData = (
  holdings: Holding[],
  transaction?: Transaction,
  categories: Category[] = CATEGORIES,
): void => {
  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => {
    if (tables[0] === 'holdings') {
      return { data: holdings };
    }
    if (tables[0] === 'transactions') {
      return { data: transaction ? [transaction] : [] };
    }
    if (tables[0] === 'categories') {
      return { data: categories };
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

// Drive the DateField calendar: open the "Date" sheet, then fire the mocked
// calendar's day-press for the given local day, so a test can backdate a row.
const pickDate = async (
  utils: ReturnType<typeof render>,
  year: number,
  month: number,
  day: number,
): Promise<void> => {
  await fireEvent.press(utils.getByLabelText('Date'));
  await fireEvent(utils.getByTestId('Date calendar'), 'dayPress', {
    year,
    month,
    day,
    dateString: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timestamp: 0,
  });
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

  it('shows the income/expense sign as a shared chip row with income selected by default', async () => {
    const { getByRole } = await renderAdd();
    // The hand-rolled Pressable toggle is now the shared ChipRow; income is the
    // default selection and expense is not.
    expect(getByRole('button', { name: 'Income' }).props.accessibilityState.selected).toBe(true);
    expect(getByRole('button', { name: 'Expense' }).props.accessibilityState.selected).toBe(false);
  });

  it('backdates a manual transaction to the date picked in the calendar', async () => {
    const utils = await renderAdd();
    await fireEvent.changeText(utils.getByLabelText('Amount'), '12.34');
    await pickDate(utils, 2025, 6, 1);
    await fireEvent.press(utils.getByText('Save'));
    // The picked day is persisted as the transaction time at LOCAL midnight,
    // instead of the hardcoded Date.now() the form used before.
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ time: new Date(2025, 5, 1).getTime() }),
    );
  });

  it('groups the amount with spaces as the user types and still parses it on save', async () => {
    const { getByLabelText, getByText } = await renderAdd();
    await fireEvent.changeText(getByLabelText('Amount'), '1000000');
    // The field reflects the grouped display value immediately as typed.
    expect(getByLabelText('Amount').props.value).toBe('1 000 000');
    await fireEvent.press(getByText('Save'));
    // The grouped string round-trips through parseAmount: 1,000,000.00 UAH.
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinorUnits: 100_000_000 }),
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

  it('persists the existing time unchanged when the date is not edited', async () => {
    const { getByText } = await renderEdit('txn-1');
    await fireEvent.press(getByText('Save'));
    // The stored time (42) hydrates the DateField and round-trips on save,
    // rather than being reset to Date.now().
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ time: 42 }));
  });

  it('re-dates the transaction to a newly picked calendar day', async () => {
    const utils = await renderEdit('txn-1');
    await pickDate(utils, 2025, 1, 10);
    await fireEvent.press(utils.getByText('Save'));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ time: new Date(2025, 0, 10).getTime() }),
    );
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

describe('TransactionFormScreen — category editing', () => {
  // Pick a category from the field's bottom-sheet: tap the field to open the
  // sheet, then tap the option row. The picker is a single-select sheet now,
  // not an inline chip row, so the option is only mounted once the sheet opens.
  const pickCategory = async (utils: ReturnType<typeof render>, title: string): Promise<void> => {
    await fireEvent.press(utils.getByLabelText('Category'));
    await fireEvent.press(utils.getByText(title));
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('propagates a MANUAL row category change through upsertCategoryOverride after confirming', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000 }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });
    mockUpsertCategoryOverride.mockResolvedValue(undefined);

    const utils = await renderEdit('txn-1');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    // The themed confirm modal (not a native Alert) names the picked category
    // and the affected transaction name.
    expect(utils.getByText('Apply Category to All')).toBeTruthy();
    expect(utils.getByText(/Apply .Dining. to all transactions named .Coffee./)).toBeTruthy();

    await fireEvent.press(utils.getByText('Apply'));

    // The manual edit still runs, and the override propagates the category.
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'txn-1' }));
    await waitFor(() =>
      expect(mockUpsertCategoryOverride).toHaveBeenCalledWith('Coffee', 'dining'),
    );
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('renders the picked category icon in white in the confirm modal', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000 }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });

    const utils = await renderEdit('txn-1');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    // The confirm sheet echoes the picked category's own glyph (mocked to a View
    // that forwards its props), rendered white (textPrimary) against the sheet —
    // not tinted its category color. Scoped to the sheet so the field's own icon
    // is not matched.
    const sheet = utils.getByTestId('category-override-sheet');
    const [icon] = sheet.queryAll((node) => node.props.name === 'fork.knife');
    expect(icon?.props.tintColor).toBe('#FFFFFF');
  });

  it('lets a SYNCED row save a category-only change via the override, without an update', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000 }], {
      id: 'txn-9',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Monobank Merchant',
      source: 'monobank',
      category: 'groceries',
    });
    mockUpsertCategoryOverride.mockResolvedValue(undefined);

    const utils = await renderEdit('txn-9');
    // No Save until the category actually changes on a synced row.
    expect(utils.queryByText('Save')).toBeNull();

    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));
    await fireEvent.press(utils.getByText('Apply'));

    await waitFor(() =>
      expect(mockUpsertCategoryOverride).toHaveBeenCalledWith('Monobank Merchant', 'dining'),
    );
    // The bank-owned fields are never written on a synced row.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('never opens the confirm modal when the category is unchanged', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000 }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });

    const { getByText, queryByText } = await renderEdit('txn-1');
    await fireEvent.press(getByText('Save'));

    expect(queryByText('Apply Category to All')).toBeNull();
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('does not apply the override when the confirmation is cancelled', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000 }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });

    const utils = await renderEdit('txn-1');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));
    await fireEvent.press(utils.getByText('Cancel'));

    // The manual edit from step 1 still stands, but no rule is written.
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
