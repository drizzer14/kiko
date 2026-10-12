import { act, renderHook } from '@testing-library/react-native';

import { useCategoryOverride } from './use-category-override';

const mockApplyNameRule = jest.fn();
const mockSetCategory = jest.fn();

jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: {
    applyNameRule: (...args: unknown[]) => mockApplyNameRule(...args),
  },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    setCategory: (...args: unknown[]) => mockSetCategory(...args),
  },
}));

const navigation = { goBack: jest.fn() };

const setup = (editingId: string | null) =>
  renderHook(() =>
    useCategoryOverride({
      navigation,
      editingId,
      categoryByKey: new Map(),
      buildApplyCategoryMessage: (category, name) => `${category} ${name}`,
      showSaveErrorAlert: jest.fn(),
    }),
  );

describe('useCategoryOverride', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApplyNameRule.mockResolvedValue(1);
    mockSetCategory.mockResolvedValue(undefined);
  });

  it('applies the rule to the row just created, which then follows it', async () => {
    const { result } = await setup(null);

    await act(async () => {
      result.current.setPendingOverride({
        name: 'Coffee',
        category: 'dining',
        sourceTransactionId: 'created-row',
      });
    });
    await act(async () => {
      result.current.onApplyOverride();
    });

    expect(mockApplyNameRule).toHaveBeenCalledWith({
      name: 'Coffee',
      category: 'dining',
      sourceTransactionId: 'created-row',
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('applies the rule to the row being edited', async () => {
    const { result } = await setup('edited-row');

    await act(async () => {
      result.current.setPendingOverride({
        name: 'Coffee',
        category: 'dining',
        sourceTransactionId: 'edited-row',
      });
    });
    await act(async () => {
      result.current.onApplyOverride();
    });

    expect(mockApplyNameRule).toHaveBeenCalledWith({
      name: 'Coffee',
      category: 'dining',
      sourceTransactionId: 'edited-row',
    });
  });

  it('applies the rule with no source row when the create wrote none', async () => {
    const { result } = await setup(null);

    await act(async () => {
      result.current.setPendingOverride({
        name: 'Coffee',
        category: 'dining',
        sourceTransactionId: null,
      });
    });
    await act(async () => {
      result.current.onApplyOverride();
    });

    expect(mockApplyNameRule).toHaveBeenCalledWith({
      name: 'Coffee',
      category: 'dining',
      sourceTransactionId: null,
    });
  });

  it('sets the category on the edited row alone for "just for this one"', async () => {
    const { result } = await setup('edited-row');

    await act(async () => {
      result.current.setPendingOverride({
        name: 'Coffee',
        category: 'dining',
        sourceTransactionId: 'edited-row',
      });
    });
    await act(async () => {
      result.current.onApplyOverrideOne();
    });

    expect(mockSetCategory).toHaveBeenCalledWith({
      transactionId: 'edited-row',
      category: 'dining',
    });
    expect(mockApplyNameRule).not.toHaveBeenCalled();
  });
});
