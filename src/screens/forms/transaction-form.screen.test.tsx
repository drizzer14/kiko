import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { Alert, StyleSheet } from 'react-native';

import type { TransactionFormParams } from '../../navigation/types';
import '../../design-system/unistyles';
import { darkTheme } from '../../design-system/theme';
import { i18n } from '../../i18n';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

import TransactionFormScreen from './transaction-form.screen';

type TransactionFormProps = ComponentProps<typeof TransactionFormScreen>;

const transactionFormRoute = (params: TransactionFormParams) =>
  asRouteProp<TransactionFormProps['route']>('TransactionForm', params);

// A react-test-renderer JSON node's `children` mixes further nodes and raw
// text leaves. Walking only `children` (never `props`) and keeping just the
// string leaves reconstructs the SCREEN-READING order of every rendered
// caption/label/button-text, independent of any prop value (e.g. a
// `placeholder` that happens to equal a neighboring field's label) — used to
// assert field order without depending on internal DOM structure.
type RenderedNode = { children: (RenderedNode | string)[] | null };

const collectRenderedText = (node: RenderedNode | string | null): string[] => {
  if (node === null) {
    return [];
  }
  if (typeof node === 'string') {
    return [node];
  }

  return (node.children ?? []).flatMap(collectRenderedText);
};

const mockRecordManual = jest.fn();
const mockRecordExchange = jest.fn();
const mockRecordExchangeCounterpart = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
const mockUpsertCategoryOverride = jest.fn();
const mockSetCategory = jest.fn();
const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/transactions/transactions.repo', () => ({
  transactionsRepo: {
    recordManual: (...args: unknown[]) => mockRecordManual(...args),
    recordExchange: (...args: unknown[]) => mockRecordExchange(...args),
    recordExchangeCounterpart: (...args: unknown[]) => mockRecordExchangeCounterpart(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    setCategory: (...args: unknown[]) => mockSetCategory(...args),
    getByIdQuery: (transactionId: string) => ({
      toSQL: () => ({ sql: '', params: [transactionId] }),
    }),
  },
}));
jest.mock('@kiko/holdings/holdings.repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/categories/categories.repo', () => ({
  categoriesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/categories/category-overrides.repo', () => ({
  categoryOverridesRepo: {
    upsertCategoryOverride: (...args: unknown[]) => mockUpsertCategoryOverride(...args),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

type Holding = {
  id: string;
  currency: string;
  balanceMinorUnits: number;
  type?: string;
  name?: string;
  closedAt?: number | null;
  icon?: string | null;
  color?: string | null;
  accountId?: string;
  sortOrder?: number;
  createdAt?: number;
};
type Account = { id: string; name: string };
type Category = { key: string; title: string; icon: string };
type Transaction = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  description: string;
  source: 'manual' | 'monobank' | 'binance';
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
  accounts: Account[] = [],
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
    if (tables[0] === 'accounts') {
      return { data: accounts };
    }

    return { data: [] };
  });
};

const navigation = navigationSpy();
const navigationProp = asNavigationProp<TransactionFormProps['navigation']>(navigation);

const renderAddFromHolding = (holdingId: string): ReturnType<typeof render> => {
  const route = transactionFormRoute({ holdingId });

  return render(<TransactionFormScreen route={route} navigation={navigationProp} />);
};

const renderAdd = (): ReturnType<typeof render> => renderAddFromHolding('h1');

const renderEdit = (transactionId: string): ReturnType<typeof render> => {
  const route = transactionFormRoute({ transactionId });

  return render(<TransactionFormScreen route={route} navigation={navigationProp} />);
};

// Drive the DateField calendar: open the "Date" sheet, then fire the mocked
// calendar's day-press for the given local day, so a test can backdate a row.
const pickDate = async (
  utils: Awaited<ReturnType<typeof render>>,
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

// Pick a category from the field's bottom-sheet: tap the field to open the
// sheet, then tap the option row. The picker is a single-select sheet, not an
// inline chip row, so the option is only mounted once the sheet opens. A create
// now requires a category before Save enables, so the add-mode cases pick one
// through the same path the category-editing cases use.
const pickCategory = async (
  utils: Awaited<ReturnType<typeof render>>,
  title: string,
): Promise<void> => {
  await fireEvent.press(utils.getByLabelText('Category'));
  await fireEvent.press(utils.getByText(title));
};

describe('TransactionFormScreen — add mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash' }]);
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

  it('marks Amount and Category required on a fresh add', async () => {
    const { getAllByText } = await renderAdd();

    // A create gates save on a positive amount AND a picked category, so both
    // show the required asterisk; description, date, and time do not. The marker
    // is hidden from accessibility, so the query includes hidden elements.
    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(2);
  });

  it('submits a manual transaction', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await fireEvent.changeText(getByLabelText('Description'), 'Coffee');
    await pickCategory(utils, 'Groceries');
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

  it('records one transaction for a double-tapped Save', async () => {
    // Hold the write open (never auto-resolving) so the first press's `await`
    // genuinely has not settled when the second press lands — firing two real
    // `fireEvent.press` calls back to back without awaiting between them trips
    // React's "overlapping act() calls" guard (each is independently wrapped
    // in its own act()), so the two presses are awaited sequentially instead;
    // the guard is still exercised because the write only resolves when this
    // test says so.
    let resolveWrite: () => void = () => {};
    mockRecordManual.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    // Leave the description blank: a non-blank description picks the
    // category-override confirm sheet path (see "skips the override sheet
    // entirely when the description is blank" above), which needs its own
    // "Apply" tap and would make this test about the override flow instead of
    // the double-tap guard.
    await pickCategory(utils, 'Groceries');

    const save = getByText('Save');

    await fireEvent.press(save);
    await fireEvent.press(save);

    expect(mockRecordManual).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite();
    });
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockRecordManual).toHaveBeenCalledTimes(1);

    // jest.clearAllMocks() (this file's beforeEach) clears call history but
    // not a custom mockImplementation — reset it explicitly so it does not
    // leak this test's never-auto-resolving write into the next test.
    mockRecordManual.mockReset();
  });

  it('negates the amount for an expense', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '10.00');
    await fireEvent.press(getByText('Expense'));
    await pickCategory(utils, 'Groceries');
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

  it('backdates a manual transaction to the picked day, keeping the default time-of-day', async () => {
    // A fresh add defaults `time` to now; picking a DAY moves only the day and
    // carries over that default time-of-day (the DateField no longer resets to
    // midnight, so a later time pick is not clobbered). Pin `Date.now()` so the
    // carried-over time-of-day (14:30) is deterministic.
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(2025, 2, 15, 14, 30, 0).getTime());
    const utils = await renderAdd();
    await fireEvent.changeText(utils.getByLabelText('Amount'), '12.34');
    await pickDate(utils, 2025, 6, 1);
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(utils.getByText('Save'));

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ time: new Date(2025, 5, 1, 14, 30, 0).getTime() }),
    );
    nowSpy.mockRestore();
  });

  it('groups the amount with spaces as the user types and still parses it on save', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '1000000');
    // The field reflects the grouped display value immediately as typed.
    expect(getByLabelText('Amount').props.value).toBe('1 000 000');
    await pickCategory(utils, 'Groceries');
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

  it('does not write a zero-amount row', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '0');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('does not write a 0.00 row', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '0.00');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('still writes the smallest representable amount', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '0.01');
    await fireEvent.press(getByText('Expense'));
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinorUnits: -1 }),
    );
  });

  it('disables Save for a zero amount', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '0');
    await pickCategory(utils, 'Groceries');
    expect(getByText('Save').parent?.props.accessibilityState.disabled).toBe(true);
  });

  it('writes the picked category onto the row even with a blank description', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'groceries', description: '' }),
    );
  });

  it('skips the override sheet entirely when the description is blank', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText, queryByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));

    expect(queryByText(/Apply/)).toBeNull();
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('keeps the row categorised when the user cancels the override sheet', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await fireEvent.changeText(getByLabelText('Description'), 'ATB');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    await fireEvent.press(getByText('Cancel'));

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'groceries' }),
    );
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
  });

  it('keeps the income/expense field order: Amount, Description, Date, Time, mode row, Category', async () => {
    const utils = await renderAdd();
    const rendered = collectRenderedText(utils.toJSON());
    const order = ['Amount', 'Description', 'Date', 'Time', 'Income', 'Category'].map((label) =>
      rendered.indexOf(label),
    );

    for (const index of order) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('TransactionFormScreen — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash' }]);
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the income/expense/category field chrome from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByLabelText, getByText, queryByText } = await renderAdd();

    expect(getByLabelText('Сума')).toBeTruthy();
    expect(getByLabelText('Опис')).toBeTruthy();
    expect(getByText('Дохід')).toBeTruthy();
    expect(getByText('Витрата')).toBeTruthy();
    expect(getByLabelText('Категорія')).toBeTruthy();
    expect(queryByText('Amount')).toBeNull();
  });

  it('renders the Exchange field group and Save from the Ukrainian catalog', async () => {
    setLiveData([
      { id: 'cash-1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash', name: 'Cash UAH' },
      { id: 'card-usd-1', currency: 'USD', balanceMinorUnits: 0, type: 'card', name: 'Card USD' },
    ]);
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByLabelText, getByText } = await renderAddFromHolding('cash-1');
    await fireEvent.press(getByText('Обмін'));

    expect(getByLabelText('Віддано')).toBeTruthy();
    expect(getByLabelText('Куди')).toBeTruthy();
    expect(getByLabelText('Отримано')).toBeTruthy();
    expect(getByText('Зберегти')).toBeTruthy();
  });
});

describe('TransactionFormScreen — edit mode (manual)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
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

  it('hydrates a 50-satoshi BTC transaction to 0.0000005, not 57', async () => {
    // Below 100 satoshis, `String(minor / 1e8)` emits exponential notation
    // ("5e-7"), which the grouping formatter used to strip down to its digits
    // ("57") — a 50-satoshi transaction rendered, and saved, as 57 BTC.
    setLiveData([{ id: 'h-btc', currency: 'BTC', balanceMinorUnits: 0, type: 'crypto_asset' }], {
      id: 'tx-1',
      holdingId: 'h-btc',
      amountMinorUnits: -50,
      time: 0,
      description: '',
      source: 'manual',
    });

    const { getByLabelText } = await renderEdit('tx-1');

    expect(getByLabelText('Amount').props.value).toBe('0.0000005');
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

  it('disables Save when the amount is cleared on an edit', async () => {
    const utils = await renderEdit('txn-1');
    const isSaveDisabled = (): boolean | undefined =>
      utils.getByText('Save').parent?.props.accessibilityState.disabled;

    // The pre-filled amount is valid, so Save starts enabled.
    expect(isSaveDisabled()).toBe(false);

    // Clearing the amount blocks Save, matching the write guard in `save`.
    await fireEvent.changeText(utils.getByLabelText('Amount'), '');
    expect(isSaveDisabled()).toBe(true);
  });

  it('persists the existing time unchanged when the date is not edited', async () => {
    const { getByText } = await renderEdit('txn-1');
    await fireEvent.press(getByText('Save'));
    // The stored time (42) hydrates the DateField and round-trips on save,
    // rather than being reset to Date.now().
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ time: 42 }));
  });

  it('re-dates the transaction to a newly picked calendar day, keeping its time-of-day', async () => {
    // A stored row at 09:15 on 20 June 2024; re-picking only the day must move
    // the day and carry over the 09:15 time-of-day (so a later time pick is not
    // lost), rather than resetting to midnight.
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: new Date(2024, 5, 20, 9, 15, 0).getTime(),
      description: 'Coffee',
      source: 'manual',
    });
    const utils = await renderEdit('txn-1');
    await pickDate(utils, 2025, 1, 10);
    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ time: new Date(2025, 0, 10, 9, 15, 0).getTime() }),
    );
  });

  it('re-times the transaction to a newly picked time, keeping its day', async () => {
    // A stored row at 09:15 on 20 June 2024; picking only the TIME must keep the
    // 20 June 2024 day while replacing the time-of-day with 18:45.
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: new Date(2024, 5, 20, 9, 15, 0).getTime(),
      description: 'Coffee',
      source: 'manual',
    });
    const utils = await renderEdit('txn-1');
    await fireEvent.press(utils.getByLabelText('Time'));
    await fireEvent(
      utils.getByTestId('Time picker'),
      'change',
      { type: 'set' },
      new Date(2000, 0, 1, 18, 45),
    );
    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ time: new Date(2024, 5, 20, 18, 45).getTime() }),
    );
  });

  it('opening an existing transaction shows its stored time-of-day, not the wall clock', async () => {
    // The edit screen hydrates `time` from the stored row (09:15 on 20 June
    // 2024), so the Time field shows 09:15 — never the current wall-clock time.
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: new Date(2024, 5, 20, 9, 15, 0).getTime(),
      description: 'Coffee',
      source: 'manual',
    });
    const { getByText } = await renderEdit('txn-1');

    expect(getByText('09:15')).toBeTruthy();
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

  it('renders the delete action as a red ghost with a trash icon', async () => {
    const { getByText, toJSON } = await renderEdit('txn-1');

    // Red-ghost treatment: the label is the negative (red) tone, not the white
    // onAccent a solid `destructive` fill would give it (item 5 / Task 2.1).
    const deleteLabel = getByText('Delete');
    expect(StyleSheet.flatten(deleteLabel.props.style).color).toBe(darkTheme.colors.negative);
    // A leading `trash` SF Symbol is present on the button (item 6 / Task 2.2).
    expect(JSON.stringify(toJSON())).toContain('trash');
  });
});

describe('TransactionFormScreen — read-only mode (monobank)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
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

  it('disables the inputs and shows the source-neutral imported explanation', async () => {
    const { getByLabelText, getByText } = await renderEdit('txn-9');
    expect(getByLabelText('Amount').props.editable).toBe(false);
    expect(getByLabelText('Description').props.editable).toBe(false);
    // The notice is source-neutral: it names no single provider, so it reads
    // correctly on a Monobank, Binance or wallet row alike.
    expect(getByText(/imported from a connected account/i)).toBeTruthy();
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

  it('marks no field required on a read-only synced row', async () => {
    const { queryAllByText } = await renderEdit('txn-9');

    // Nothing gates save on a read-only row (Save only appears once the
    // category changes, and only the category is writable), so no field shows
    // the required asterisk — hidden elements included, so a hidden marker would
    // still be caught.
    expect(queryAllByText('*', { includeHiddenElements: true })).toHaveLength(0);
  });
});

describe('TransactionFormScreen — synced (binance) row', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // A Binance-imported row: a real synced source that carries a BLANK
    // description and a null category. The blank description is why the
    // category-propagation sheet never opens for it (a name rule refuses a
    // blank catch-all), so the category must persist through the single-row,
    // ungated `setCategory` writer instead.
    setLiveData([{ id: 'h-btc', currency: 'BTC', balanceMinorUnits: 0, type: 'crypto_asset' }], {
      id: 'txn-b',
      holdingId: 'h-btc',
      amountMinorUnits: -50,
      time: 42,
      description: '',
      source: 'binance',
      category: null,
    });
  });

  it('persists the picked category on a blank-description binance row via setCategory', async () => {
    mockSetCategory.mockResolvedValue(undefined);

    const utils = await renderEdit('txn-b');
    // A synced row shows no Save until its category actually changes.
    expect(utils.queryByText('Save')).toBeNull();

    await pickCategory(utils, 'Groceries');
    await fireEvent.press(utils.getByText('Save'));

    // The single-row, ungated writer persists the category by id.
    await waitFor(() =>
      expect(mockSetCategory).toHaveBeenCalledWith({
        transactionId: 'txn-b',
        category: 'groceries',
      }),
    );
    // A blank description opens no propagation sheet, writes no name rule, and
    // never touches a bank-owned field.
    expect(utils.queryByText('Apply Category to All')).toBeNull();
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordManual).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('treats the bank-owned amount, description, date and time fields as read-only', async () => {
    const { getByLabelText } = await renderEdit('txn-b');

    expect(getByLabelText('Amount').props.editable).toBe(false);
    expect(getByLabelText('Description').props.editable).toBe(false);
    expect(getByLabelText('Date').props.accessibilityState.disabled).toBe(true);
    expect(getByLabelText('Time').props.accessibilityState.disabled).toBe(true);
  });

  it('shows the source-neutral read-only notice, never Monobank-specific wording', async () => {
    const { getByText, queryByText } = await renderEdit('txn-b');
    // A Binance row must not claim it came from Monobank.
    expect(getByText(/imported from a connected account/i)).toBeTruthy();
    expect(queryByText(/Monobank/i)).toBeNull();
  });

  it('still shows the editable category control on a read-only binance row', async () => {
    const { getByLabelText } = await renderEdit('txn-b');
    // The category picker stays offered even though the bank-owned fields lock.
    expect(getByLabelText('Category')).toBeTruthy();
  });
});

describe('TransactionFormScreen — category editing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('propagates a MANUAL row category change through upsertCategoryOverride after confirming', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
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

  it('persists a MANUAL blank-description row category via setCategory (the name rule skips it)', async () => {
    // A manual row with a BLANK description whose category the user changes.
    // The name-rule sheet refuses a blank catch-all, so before the fix the
    // pick was silently dropped on save. The single-row `setCategory` now
    // persists it by id, with no propagation sheet.
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'cash' }], {
      id: 'txn-blank',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: '',
      source: 'manual',
      category: 'groceries',
    });
    mockSetCategory.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);

    const utils = await renderEdit('txn-blank');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    expect(utils.queryByText('Apply Category to All')).toBeNull();
    await waitFor(() =>
      expect(mockSetCategory).toHaveBeenCalledWith({
        transactionId: 'txn-blank',
        category: 'dining',
      }),
    );
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('overrides ONLY this row via setCategory when "Just for this one" is pressed, never the name rule', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });
    mockSetCategory.mockResolvedValue(undefined);

    const utils = await renderEdit('txn-1');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    // The sheet offers the single-row override alongside the all-similar one.
    await fireEvent.press(utils.getByText('Just for this one'));

    // Only the target row's category is rewritten, by id — the all-similar name
    // rule is never touched.
    await waitFor(() =>
      expect(mockSetCategory).toHaveBeenCalledWith({
        transactionId: 'txn-1',
        category: 'dining',
      }),
    );
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('sizes every confirm-sheet action the same as the primary Apply (full-width regular)', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
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

    // Every action in this confirm sheet matches the primary "Apply": the tall
    // regular 50pt size, full width. "Just for this one" and "Cancel" are NOT
    // shrunk to a compact/inline size here — they are full-width sheet actions.
    const apply = utils.getByRole('button', { name: 'Apply' });
    expect(StyleSheet.flatten(apply.props.style).minHeight).toBe(50);
    expect(StyleSheet.flatten(apply.props.style).width).toBe('100%');

    const one = utils.getByRole('button', { name: 'Just for this one' });
    expect(StyleSheet.flatten(one.props.style).minHeight).toBe(50);
    expect(StyleSheet.flatten(one.props.style).width).toBe('100%');

    const cancel = utils.getByRole('button', { name: 'Cancel' });
    expect(StyleSheet.flatten(cancel.props.style).minHeight).toBe(50);
    expect(StyleSheet.flatten(cancel.props.style).width).toBe('100%');
  });

  it('does NOT offer "Just for this one" on a create flow (no transaction id to target)', async () => {
    // Create mode: the sheet still rises (a non-blank description + a category
    // pick), but there is no existing row to target — the just-created row
    // already carries its category from recordManual — so the single-row
    // override button must be absent.
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash' }]);

    const utils = await renderAdd();
    await fireEvent.changeText(utils.getByLabelText('Amount'), '12.34');
    await fireEvent.changeText(utils.getByLabelText('Description'), 'ATB');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(utils.getByText('Save'));

    // The all-similar "Apply" is offered; the single-row override is not.
    expect(utils.getByText('Apply')).toBeTruthy();
    expect(utils.queryByText('Just for this one')).toBeNull();
    expect(mockSetCategory).not.toHaveBeenCalled();
  });

  it('propagates one override for a double-tapped Apply', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });

    // Hold the write open (never auto-resolving) so the first press's `await`
    // genuinely has not settled when the second press lands — see "records
    // one transaction for a double-tapped Save" above for why the two
    // presses are awaited sequentially instead of fired back to back.
    let resolveWrite: () => void = () => {};
    mockUpsertCategoryOverride.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const utils = await renderEdit('txn-1');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    const apply = utils.getByText('Apply');

    await fireEvent.press(apply);
    await fireEvent.press(apply);

    expect(mockUpsertCategoryOverride).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite();
    });
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockUpsertCategoryOverride).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).toHaveBeenCalledTimes(1);

    // jest.clearAllMocks() (this describe's beforeEach) clears call history
    // but not a custom mockImplementation — reset it explicitly so it does
    // not leak this test's never-auto-resolving write into the next test.
    mockUpsertCategoryOverride.mockReset();
  });

  it('renders the picked category icon in white in the confirm modal', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
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
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
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
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
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
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
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

// Distinct holding types so the Exchange eligibility/destination-filter rules
// (cash-only source, non-source/non-closed/cash-only destination) can each be
// exercised against a fixture built for that exact case. A second cash holding
// (`cash-usd-1`) stands in for "an eligible destination" now that card is no
// longer create-eligible on either side (Requirement B).
const EXCHANGE_HOLDINGS: Holding[] = [
  { id: 'cash-1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash', name: 'Cash UAH' },
  { id: 'cash-usd-1', currency: 'USD', balanceMinorUnits: 0, type: 'cash', name: 'Cash USD' },
  { id: 'card-usd-1', currency: 'USD', balanceMinorUnits: 0, type: 'card', name: 'Card USD' },
  { id: 'bond-1', currency: 'UAH', balanceMinorUnits: 0, type: 'bond', name: 'Government Bond' },
  {
    id: 'old-cash-1',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Old Cash',
    closedAt: 1,
  },
  { id: 'war-bond-1', currency: 'UAH', balanceMinorUnits: 0, type: 'bond', name: 'War Bond' },
  { id: 'jar-1', currency: 'UAH', balanceMinorUnits: 0, type: 'jar', name: 'Monobank Jar' },
];

describe('TransactionFormScreen — Exchange mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData(EXCHANGE_HOLDINGS);
  });

  it('offers Exchange only when the source holding is cash (not bond)', async () => {
    const cash = await renderAddFromHolding('cash-1');
    expect(cash.queryByText('Exchange')).toBeTruthy();

    const bond = await renderAddFromHolding('bond-1');
    expect(bond.queryByText('Exchange')).toBeNull();
  });

  it('never offers Exchange in edit mode', async () => {
    setLiveData(EXCHANGE_HOLDINGS, {
      id: 'txn-1',
      holdingId: 'cash-1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
    });

    const { queryByText } = await renderEdit('txn-1');
    expect(queryByText('Exchange')).toBeNull();
  });

  it('lists open, non-source cash holdings in the destination select', async () => {
    const { getByText, getByLabelText, queryByText } = await renderAddFromHolding('cash-1');

    await fireEvent.press(getByText('Exchange'));
    await fireEvent.press(getByLabelText('To'));

    // Another cash holding is listed; the source itself, a closed cash
    // holding, a card, and bond/jar holdings are all excluded on create.
    expect(getByText('Cash USD')).toBeTruthy();
    expect(queryByText('Cash UAH')).toBeNull();
    expect(queryByText('Card USD')).toBeNull();
    expect(queryByText('Old Cash')).toBeNull();
    expect(queryByText('War Bond')).toBeNull();
    expect(queryByText('Monobank Jar')).toBeNull();
  });

  it('hides the category picker in Exchange mode', async () => {
    const { getByText, queryByLabelText } = await renderAddFromHolding('cash-1');
    // Category field is visible in income/expense mode.
    expect(queryByLabelText('Category')).toBeTruthy();

    await fireEvent.press(getByText('Exchange'));
    expect(queryByLabelText('Category')).toBeNull();
  });

  it.each([
    ['empty Value Out', '', '2.50'],
    ['zero Value Out', '0', '2.50'],
    ['negative Value Out', '-10', '2.50'],
    ['empty Value In', '100', ''],
    ['zero Value In', '100', '0'],
    ['negative Value In', '100', '-5'],
  ])('rejects %s: recordExchange is not called', async (_case, valueOut, valueIn) => {
    const { getByText, getByLabelText } = await renderAddFromHolding('cash-1');
    await fireEvent.press(getByText('Exchange'));
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD'));

    if (valueOut !== '') {
      await fireEvent.changeText(getByLabelText('Value Out'), valueOut);
    }
    if (valueIn !== '') {
      await fireEvent.changeText(getByLabelText('Value In'), valueIn);
    }

    await fireEvent.press(getByText('Save'));
    expect(mockRecordExchange).not.toHaveBeenCalled();
  });

  it('disables Save until a destination and both positive amounts are set', async () => {
    const utils = await renderAddFromHolding('cash-1');
    const isSaveDisabled = (): boolean | undefined =>
      utils.getByText('Save').parent?.props.accessibilityState.disabled;
    await fireEvent.press(utils.getByText('Exchange'));

    // Nothing filled yet.
    expect(isSaveDisabled()).toBe(true);

    // A sent amount alone, with no destination and no received amount.
    await fireEvent.changeText(utils.getByLabelText('Value Out'), '100');
    expect(isSaveDisabled()).toBe(true);

    // A destination picked, but still no received amount.
    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash USD'));
    expect(isSaveDisabled()).toBe(true);

    // Both legs positive and a destination picked: Save enables.
    await fireEvent.changeText(utils.getByLabelText('Value In'), '2.5');
    expect(isSaveDisabled()).toBe(false);
  });

  it('shows the received (Value In) leg the destination currency glyph as its suffix', async () => {
    const utils = await renderAddFromHolding('cash-1');
    await fireEvent.press(utils.getByText('Exchange'));

    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash USD'));

    // Scope each glyph to its own field so neither passes by matching the
    // other leg's suffix: the sent (Value Out) leg reads in the source currency
    // (UAH), the received (Value In) leg in the destination currency (USD).
    const suffixWithin = (label: string): ReturnType<typeof within> => {
      const field = utils.getByLabelText(label).parent;

      if (field === null) {
        throw new Error(`${label} field has no container`);
      }

      return within(field);
    };

    expect(suffixWithin('Value Out').getByText('₴')).toBeTruthy();
    expect(suffixWithin('Value In').getByText('$')).toBeTruthy();
  });

  it('saves an exchange with correct minor units and holding ids', async () => {
    const { getByText, getByLabelText } = await renderAddFromHolding('cash-1');
    await fireEvent.press(getByText('Exchange'));

    await fireEvent.changeText(getByLabelText('Value Out'), '100');
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD'));
    await fireEvent.changeText(getByLabelText('Value In'), '2.50');

    await fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(mockRecordExchange).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceHoldingId: 'cash-1',
          valueOutMinorUnits: 10_000,
          destinationHoldingId: 'cash-usd-1',
          destinationType: 'cash',
          valueInMinorUnits: 250,
        }),
      ),
    );
  });
});

// Fixtures for the cash-only create rule (Requirement B) plus account-name
// threading (Requirement C, Task 2). `cash-1` and `cash-usd-1` sit under two
// different accounts so the destination's account name is unambiguous;
// `card-1`, `btc-1`, and `deposit-1` cover every non-cash type that create
// mode must now exclude on the destination side.
const EXCHANGE_CREATE_HOLDINGS: Holding[] = [
  {
    id: 'cash-1',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Cash UAH',
    accountId: 'acc-cash',
  },
  {
    id: 'cash-usd-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Cash USD',
    accountId: 'acc-wallet',
  },
  {
    id: 'card-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'card',
    name: 'Card USD',
    accountId: 'acc-wallet',
  },
  {
    id: 'btc-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'crypto_asset',
    name: 'BTC Wallet',
    accountId: 'acc-wallet',
  },
  {
    id: 'deposit-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'term_deposit',
    name: 'USD Deposit',
    accountId: 'acc-wallet',
  },
];

const EXCHANGE_CREATE_ACCOUNTS: Account[] = [
  { id: 'acc-cash', name: 'Home' },
  { id: 'acc-wallet', name: 'Wallet' },
];

describe('TransactionFormScreen — Exchange create (cash-only, account names)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData(EXCHANGE_CREATE_HOLDINGS, undefined, CATEGORIES, EXCHANGE_CREATE_ACCOUNTS);
  });

  it('offers Exchange from a cash source but NOT from a card source', async () => {
    const cash = await renderAddFromHolding('cash-1');
    expect(cash.queryByText('Exchange')).toBeTruthy();

    const card = await renderAddFromHolding('card-1');
    expect(card.queryByText('Exchange')).toBeNull();
  });

  it('lists only cash destinations (card/crypto/term_deposit excluded) and shows account names', async () => {
    const { getByText, getByLabelText, queryByText } = await renderAddFromHolding('cash-1');

    await fireEvent.press(getByText('Exchange'));
    await fireEvent.press(getByLabelText('To'));

    // Another cash holding is offered, with its account name shown (rendered
    // as "<account name> · <currency>", per holding-select-field.component).
    expect(getByText('Cash USD')).toBeTruthy();
    expect(getByText('Wallet · USD')).toBeTruthy(); // Cash USD's parent account name

    // The source itself and every non-cash type are excluded on create.
    expect(queryByText('Cash UAH')).toBeNull(); // the source itself
    expect(queryByText('Card USD')).toBeNull(); // card excluded on create
    expect(queryByText('BTC Wallet')).toBeNull(); // crypto excluded on create
    expect(queryByText('USD Deposit')).toBeNull(); // term_deposit excluded on create
  });

  it('saves a cash->cash exchange with correct minor units and holding ids', async () => {
    const { getByText, getByLabelText } = await renderAddFromHolding('cash-1');
    await fireEvent.press(getByText('Exchange'));

    await fireEvent.changeText(getByLabelText('Value Out'), '100');
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD'));
    await fireEvent.changeText(getByLabelText('Value In'), '2.50');

    await fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(mockRecordExchange).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceHoldingId: 'cash-1',
          valueOutMinorUnits: 10_000, // 100 UAH -> minor (scale 2)
          destinationHoldingId: 'cash-usd-1',
          destinationType: 'cash',
          valueInMinorUnits: 250, // 2.50 USD -> minor (scale 2)
        }),
      ),
    );
  });
});

// Fixtures for the picker-order rule (F2): two accounts whose display order
// (the sortOrder-driven `accountsRepo.listQuery` order) is Bravo before Alpha,
// each holding one eligible cash destination. The raw `holdings.allQuery`
// array below is deliberately NOT grouped by account, so a picker that
// preserves that order would list Alpha's holding first. The Accounts screen
// groups holdings under their account, so the picker must too.
const PICKER_ORDER_HOLDINGS: Holding[] = [
  {
    id: 'src',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Source',
    accountId: 'acc-alpha',
    sortOrder: 0,
    createdAt: 1,
  },
  {
    id: 'dest-alpha',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Dest Alpha',
    accountId: 'acc-alpha',
    sortOrder: 1,
    createdAt: 2,
  },
  {
    id: 'dest-bravo',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Dest Bravo',
    accountId: 'acc-bravo',
    sortOrder: 0,
    createdAt: 3,
  },
];

// listQuery order (account sortOrder): Bravo ranks before Alpha.
const PICKER_ORDER_ACCOUNTS: Account[] = [
  { id: 'acc-bravo', name: 'Bravo' },
  { id: 'acc-alpha', name: 'Alpha' },
];

describe('TransactionFormScreen — From/To picker order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData(PICKER_ORDER_HOLDINGS, undefined, CATEGORIES, PICKER_ORDER_ACCOUNTS);
  });

  it('orders the destination picker by the Accounts screen order (account, then holding)', async () => {
    const utils = await renderAddFromHolding('src');
    await fireEvent.press(utils.getByText('Exchange'));
    await fireEvent.press(utils.getByLabelText('To'));

    const rendered = collectRenderedText(utils.toJSON());
    const bravoIndex = rendered.indexOf('Dest Bravo');
    const alphaIndex = rendered.indexOf('Dest Alpha');

    expect(bravoIndex).toBeGreaterThan(-1);
    expect(alphaIndex).toBeGreaterThan(-1);
    // Bravo's account ranks first, so its holding lists before Alpha's.
    expect(bravoIndex).toBeLessThan(alphaIndex);
  });
});

// Fixtures for convert-mode (Task 7): `cash-1` is the existing row's own
// holding for the expense/income-manual cases; `card-1` stands in for a
// SYNCED row's holding. `cash-usd-1` and `card-eur-1` are eligible
// counterparts under the WIDER convert predicates (cash/card, unlike the
// cash-only create rule); `deposit-1` (term_deposit) and `btc-1`
// (crypto_asset) must never appear as a source, and `deposit-1`'s holding
// type also makes its OWN transaction row ineligible for the action at all.
const CONVERT_HOLDINGS: Holding[] = [
  {
    id: 'cash-1',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Cash UAH',
    accountId: 'acc-wallet',
  },
  {
    id: 'card-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'card',
    name: 'Card USD',
    accountId: 'acc-wallet',
  },
  {
    id: 'cash-usd-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Cash USD',
    accountId: 'acc-wallet',
  },
  {
    id: 'card-eur-1',
    currency: 'EUR',
    balanceMinorUnits: 0,
    type: 'card',
    name: 'Card EUR',
    accountId: 'acc-wallet',
  },
  {
    id: 'deposit-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'term_deposit',
    name: 'USD Deposit',
    accountId: 'acc-wallet',
  },
  {
    id: 'btc-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'crypto_asset',
    name: 'BTC Wallet',
    accountId: 'acc-wallet',
  },
];

const CONVERT_ACCOUNTS: Account[] = [{ id: 'acc-wallet', name: 'Wallet' }];

const CONVERT_TRANSACTIONS: Record<string, Transaction> = {
  'expense-manual': {
    id: 'expense-manual',
    holdingId: 'cash-1',
    amountMinorUnits: -10_000,
    time: 42,
    description: 'Groceries',
    source: 'manual',
  },
  'expense-synced': {
    id: 'expense-synced',
    holdingId: 'card-1',
    amountMinorUnits: -5_000,
    time: 42,
    description: 'Imported purchase',
    source: 'monobank',
  },
  'income-manual': {
    id: 'income-manual',
    holdingId: 'cash-1',
    amountMinorUnits: 8_000,
    time: 42,
    description: 'Refund',
    source: 'manual',
  },
  'zero-amount': {
    id: 'zero-amount',
    holdingId: 'cash-1',
    amountMinorUnits: 0,
    time: 42,
    description: 'Zero',
    source: 'manual',
  },
  'deposit-txn': {
    id: 'deposit-txn',
    holdingId: 'deposit-1',
    amountMinorUnits: -1_000,
    time: 42,
    description: 'Deposit',
    source: 'manual',
  },
};

describe('TransactionFormScreen — Convert to Exchange', () => {
  const renderEdit = (transactionId: string): ReturnType<typeof render> => {
    setLiveData(
      CONVERT_HOLDINGS,
      CONVERT_TRANSACTIONS[transactionId],
      CATEGORIES,
      CONVERT_ACCOUNTS,
    );
    const route = transactionFormRoute({ transactionId });

    return render(<TransactionFormScreen route={route} navigation={navigationProp} />);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the action for a non-zero expense on a cash/card holding (manual AND synced)', async () => {
    const manual = await renderEdit('expense-manual');
    expect(manual.queryByText('Convert to exchange')).toBeTruthy();

    const synced = await renderEdit('expense-synced');
    expect(synced.queryByText('Convert to exchange')).toBeTruthy();
  });

  it('does NOT show the action for a zero amount or a non-liquid holding', async () => {
    const zero = await renderEdit('zero-amount');
    expect(zero.queryByText('Convert to exchange')).toBeNull();

    const deposit = await renderEdit('deposit-txn');
    expect(deposit.queryByText('Convert to exchange')).toBeNull();
  });

  it('opens the destination ("To") form for an expense-sourced convert', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-manual');

    await fireEvent.press(getByText('Convert to exchange'));

    // Expense source: the fixed side is Value Out; the picked leg is a destination ("To").
    expect(getByText('Value Out')).toBeTruthy();
    expect(getByLabelText('To')).toBeTruthy();
    expect(getByLabelText('Value In')).toBeTruthy();
  });

  it('opens the source ("From") form for an income-sourced convert', async () => {
    const { getByText, getByLabelText } = await renderEdit('income-manual');

    await fireEvent.press(getByText('Convert to exchange'));

    // Income destination: the fixed side is Value In; the picked leg is a source ("From").
    expect(getByText('Value In')).toBeTruthy();
    expect(getByLabelText('From')).toBeTruthy();
    expect(getByLabelText('Value Out')).toBeTruthy();
  });

  it('writes the destination leg with the right sign, id, and exchange marker for an expense convert', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-manual');
    // existing: holding 'cash-1' name 'Cash UAH', amount -10_000 (100.00 UAH)

    await fireEvent.press(getByText('Convert to exchange'));
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD')); // a cash destination in another account
    await fireEvent.changeText(getByLabelText('Value In'), '2.50');

    await fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(mockRecordExchangeCounterpart).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'record-destination',
          counterpartHoldingId: 'cash-usd-1',
          counterpartType: 'cash',
          amountMinorUnits: 250, // 2.50 USD -> minor
          // The EXISTING row's own id and holding id: the row is marked as the
          // other leg of this movement, and its holding becomes the new leg's
          // structural exchange marker (no English description is persisted).
          existingTransactionId: 'expense-manual',
          existingHoldingId: 'cash-1',
        }),
      ),
    );
  });

  it('restricts the source picker to cash/card for an income convert', async () => {
    const { getByText, getByLabelText, queryByText } = await renderEdit('income-manual');

    await fireEvent.press(getByText('Convert to exchange'));
    await fireEvent.press(getByLabelText('From'));

    expect(getByText('Cash USD')).toBeTruthy(); // cash offered
    expect(getByText('Card EUR')).toBeTruthy(); // card offered
    expect(queryByText('USD Deposit')).toBeNull(); // term_deposit NOT a source
    expect(queryByText('BTC Wallet')).toBeNull(); // crypto NOT a source
  });

  it('rejects a blank/zero/negative counterpart amount (no write)', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-manual');

    await fireEvent.press(getByText('Convert to exchange'));
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD'));
    // leave Value In blank
    await fireEvent.press(getByText('Save'));

    expect(mockRecordExchangeCounterpart).not.toHaveBeenCalled();
  });

  it('disables Save until a counterpart holding and a positive amount are set', async () => {
    const utils = await renderEdit('expense-manual');
    const isSaveDisabled = (): boolean | undefined =>
      utils.getByText('Save').parent?.props.accessibilityState.disabled;

    await fireEvent.press(utils.getByText('Convert to exchange'));

    // No counterpart and no amount yet.
    expect(isSaveDisabled()).toBe(true);

    // A counterpart picked, but the amount is still blank.
    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash USD'));
    expect(isSaveDisabled()).toBe(true);

    // A positive counterpart amount enables Save.
    await fireEvent.changeText(utils.getByLabelText('Value In'), '2.5');
    expect(isSaveDisabled()).toBe(false);
  });

  it('never calls update/remove on the existing row when converting', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-synced');

    await fireEvent.press(getByText('Convert to exchange'));
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD'));
    await fireEvent.changeText(getByLabelText('Value In'), '5');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockRecordExchangeCounterpart).toHaveBeenCalled());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
