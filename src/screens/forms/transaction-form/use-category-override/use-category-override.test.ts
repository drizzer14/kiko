import { act, renderHook } from '@testing-library/react-native';

import { useCategoryOverride } from './use-category-override';

const mockApplyNameRule = jest.fn();
const mockSetCategory = jest.fn();
const mockPreviewNameRule = jest.fn();

jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: {
    applyNameRule: (...args: unknown[]) => mockApplyNameRule(...args),
    previewNameRule: (...args: unknown[]) => mockPreviewNameRule(...args),
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

describe('useCategoryOverride, the prefix offer', () => {
  type Preview = { count: number; names: string[] };

  const PREVIEW: Preview = { count: 3, names: ['ATB 0212', 'ATB 0340', 'ATB Market'] };
  const showSaveErrorAlert = jest.fn();

  const pendingFor = (name: string) => ({
    name,
    category: 'dining',
    sourceTransactionId: 'created-row',
  });

  const setupFlow = () =>
    renderHook(() =>
      useCategoryOverride({
        navigation,
        editingId: null,
        categoryByKey: new Map(),
        buildApplyCategoryMessage: (category, name) => `${category} ${name}`,
        showSaveErrorAlert,
      }),
    );

  const pendingWith = async (name: string) => {
    const rendered = await setupFlow();

    await act(async () => {
      rendered.result.current.setPendingOverride(pendingFor(name));
    });

    return rendered;
  };

  const offered = async (name = 'ATB 0212') => {
    const rendered = await pendingWith(name);

    await act(async () => {
      rendered.result.current.onOfferPrefix();
    });

    return rendered;
  };

  const expectNothingWritten = (): void => {
    expect(mockApplyNameRule).not.toHaveBeenCalled();
    expect(mockSetCategory).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockApplyNameRule.mockResolvedValue(3);
    mockSetCategory.mockResolvedValue(undefined);
    mockPreviewNameRule.mockResolvedValue(PREVIEW);
  });

  it('offers no prefix for a name with no store number', async () => {
    const { result } = await pendingWith('Coffee Shop');

    expect(result.current.prefixOffer).toBeNull();
  });

  it('offers the prefix for a name that ends in one', async () => {
    const { result } = await pendingWith('ATB 0212');

    expect(result.current.prefixOffer).toBe('ATB');
  });

  it('previews without writing on the first tap', async () => {
    const { result } = await offered();

    expect(mockPreviewNameRule).toHaveBeenCalledWith({
      text: 'ATB',
      kind: 'nameStartsWith',
      category: 'dining',
      sourceTransactionId: 'created-row',
    });
    expect(result.current.prefixPreview).toEqual(PREVIEW);
    expectNothingWritten();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('writes with kind nameStartsWith and the source row only on confirm', async () => {
    const { result } = await offered();

    expectNothingWritten();

    await act(async () => {
      result.current.onApplyPrefix();
    });

    expect(mockApplyNameRule).toHaveBeenCalledTimes(1);
    expect(mockApplyNameRule).toHaveBeenCalledWith({
      name: 'ATB',
      kind: 'nameStartsWith',
      category: 'dining',
      sourceTransactionId: 'created-row',
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('returning from the confirm leaves the first step and writes nothing', async () => {
    const { result } = await offered();

    await act(async () => {
      result.current.onBackFromPrefix();
    });

    expect(result.current.prefixPreview).toBeNull();
    expect(result.current.prefixOffer).toBe('ATB');
    expectNothingWritten();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('cancel leaves what the form saved and writes no rule', async () => {
    const { result } = await offered();

    await act(async () => {
      result.current.cancelOverride();
    });

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expectNothingWritten();
  });

  it('shows the save alert when the preview fails', async () => {
    mockPreviewNameRule.mockRejectedValue(new Error('preview failed'));

    const { result } = await offered();

    expect(showSaveErrorAlert).toHaveBeenCalledTimes(1);
    expect(result.current.prefixPreview).toBeNull();
    expectNothingWritten();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  describe('while the preview is still loading', () => {
    const NEVER_RESOLVED = new Promise<never>(() => undefined);

    it('holds the sheet: Cancel does nothing while it loads', async () => {
      mockPreviewNameRule.mockReturnValue(NEVER_RESOLVED);

      const { result } = await offered();

      expect(result.current.isOfferingPrefix).toBe(true);
      expect(result.current.isOverrideWriting).toBe(true);

      await act(async () => {
        result.current.cancelOverride();
      });

      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(result.current.prefixPreview).toBeNull();
      expectNothingWritten();
    });

    it('holds the step: Back keeps the preview that is shown', async () => {
      const { result } = await offered();

      mockPreviewNameRule.mockReturnValue(NEVER_RESOLVED);

      await act(async () => {
        result.current.onOfferPrefix();
      });

      expect(result.current.isOverrideWriting).toBe(true);

      await act(async () => {
        result.current.onBackFromPrefix();
      });

      expect(result.current.prefixPreview).toEqual(PREVIEW);
      expect(navigation.goBack).not.toHaveBeenCalled();
    });
  });

  it('blocks a second confirm while the write runs', async () => {
    let finishWrite: () => void = () => undefined;

    mockApplyNameRule.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          finishWrite = () => resolve(3);
        }),
    );

    const { result } = await offered();

    await act(async () => {
      result.current.onApplyPrefix();
      result.current.onApplyPrefix();
    });

    expect(mockApplyNameRule).toHaveBeenCalledTimes(1);
    expect(result.current.isOverrideWriting).toBe(true);

    await act(async () => {
      result.current.cancelOverride();
    });

    expect(navigation.goBack).not.toHaveBeenCalled();

    await act(async () => {
      finishWrite();
    });

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
