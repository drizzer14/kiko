import type { ComponentProps } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import type { TransactionFormParams } from '@kiko/navigation/types';
import { pressSave, saveItem } from '@kiko/test-support/form-header-items';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import TransactionFormScreen from './transaction-form.screen';

// kiko-architecture: `setCategory` is the single-row, by-id writer for a category change on an
// EXISTING row only. A create already carries its category from `recordManual`, and an edit whose
// category is unchanged has nothing to write. Every row here has a blank description, so the
// name-rule propagation sheet never opens and `setCategory` is the only category write.

const mockRecordManual = jest.fn();
const mockUpdate = jest.fn();
const mockSetCategory = jest.fn();
const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    recordManual: (...args: unknown[]) => mockRecordManual(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    setCategory: (...args: unknown[]) => mockSetCategory(...args),
    getByIdQuery: (transactionId: string) => ({
      toSQL: () => ({ sql: '', params: [transactionId] }),
    }),
    distinctDescriptionsQuery: () => ({
      __kind: 'distinctDescriptions',
      toSQL: () => ({ sql: '', params: [] }),
    }),
    latestManualHoldingQuery: () => ({
      __kind: 'latestManualHolding',
      toSQL: () => ({ sql: '', params: [] }),
    }),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/categories/category-overrides-repo', () => ({
  categoryOverridesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

type TransactionFormProps = ComponentProps<typeof TransactionFormScreen>;
type StoredRow = { id: string; source: 'manual' | 'binance'; category: string | null };

const holdings = [{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash' }];
const categories = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'dining', title: 'Dining', icon: 'fork.knife' },
];

const storedRow = (row: StoredRow) => ({
  holdingId: 'h1',
  amountMinorUnits: -100,
  time: 1_700_000_000_000,
  description: '',
  ...row,
});

const serveRows = (rows: ReturnType<typeof storedRow>[]): void => {
  const dataByTable: Record<string, unknown[]> = { holdings, transactions: rows, categories };

  mockUseLiveQuery.mockImplementation((query: unknown, tables: string[]) => {
    const kind = (query as { __kind?: string })?.__kind;

    if (kind === 'distinctDescriptions') {
      return { data: [] };
    }

    if (kind === 'latestManualHolding') {
      return { data: [], isLoading: false };
    }

    return { data: dataByTable[tables[0]] ?? [] };
  });
};

const navigation = navigationSpy();

const renderForm = (params: TransactionFormParams): ReturnType<typeof render> =>
  render(
    <TransactionFormScreen
      route={asRouteProp<TransactionFormProps['route']>('TransactionForm', params)}
      navigation={asNavigationProp<TransactionFormProps['navigation']>(navigation)}
    />,
  );

const pickCategory = async (
  utils: Awaited<ReturnType<typeof render>>,
  title: string,
): Promise<void> => {
  await fireEvent.press(utils.getByLabelText('Category'));
  await fireEvent.press(utils.getByText(title));
};

describe('TransactionFormScreen — Save writes the category by id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
    mockSetCategory.mockResolvedValue(undefined);
    mockRecordManual.mockResolvedValue(undefined);
  });

  it('does not call setCategory on a create, which carries its category through recordManual', async () => {
    serveRows([]);

    const utils = await renderForm({ holdingId: 'h1' });
    await fireEvent.changeText(utils.getByLabelText('Amount'), '12.34');
    await pickCategory(utils, 'Groceries');
    await pressSave(navigation.setOptions);

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'groceries' }),
    );
    expect(mockSetCategory).not.toHaveBeenCalled();
  });

  it('does not call setCategory when a manual edit is saved with its stored category unchanged', async () => {
    serveRows([storedRow({ id: 'txn-m', source: 'manual', category: 'groceries' })]);

    await renderForm({ transactionId: 'txn-m' });
    await pressSave(navigation.setOptions);

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'txn-m' }));
    expect(mockSetCategory).not.toHaveBeenCalled();
  });

  it('shows no Save for a synced row whose category is unchanged', async () => {
    serveRows([storedRow({ id: 'txn-b', source: 'binance', category: 'groceries' })]);

    await renderForm({ transactionId: 'txn-b' });

    expect(saveItem(navigation.setOptions)).toBeUndefined();
    expect(mockSetCategory).not.toHaveBeenCalled();
  });

  it('calls setCategory once with the row id and the new category when an edit changes it', async () => {
    serveRows([storedRow({ id: 'txn-m', source: 'manual', category: 'groceries' })]);

    const utils = await renderForm({ transactionId: 'txn-m' });
    await pickCategory(utils, 'Dining');
    await pressSave(navigation.setOptions);

    await waitFor(() => expect(mockSetCategory).toHaveBeenCalledTimes(1));
    expect(mockSetCategory).toHaveBeenCalledWith({ transactionId: 'txn-m', category: 'dining' });
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
