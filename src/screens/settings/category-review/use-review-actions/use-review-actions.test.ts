import '@kiko/i18n/init';
import { act, renderHook } from '@testing-library/react-native';
import type { ReviewGroup } from '@kiko/categories/category-rules';

import { useReviewActions } from './use-review-actions';

const mockPreview = jest.fn<Promise<{ count: number; names: string[] }>, [object]>();
const mockApply = jest.fn<Promise<number>, [object]>();

jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: {
    previewNameRule: (input: object) => mockPreview(input),
    applyNameRule: (input: object) => mockApply(input),
  },
}));

const groupOf = (text: string, rowCount: number): ReviewGroup => ({
  key: text.toLowerCase(),
  names: [text],
  rowCount,
  newestTime: 1_000,
  rule: { kind: 'nameIs', text },
});

const FIRST = groupOf('Silpo', 2);
const SECOND = groupOf('Bolt', 3);

beforeEach(() => {
  jest.clearAllMocks();
});

// The line buttons are disabled while a pick runs, but a tap on another line during the options
// sheet's fade still gets past `disabled`, and that pick can be dropped or replace the waiting one:
// the guard of `useSubmitOnce` is what the hook itself relies on while a write runs.
describe('useReviewActions', () => {
  it('ignores a pick that lands while the write of another runs', async () => {
    let finishWrite: (changed: number) => void = () => {};

    mockPreview.mockResolvedValue({ count: FIRST.rowCount, names: [] });
    mockApply.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finishWrite = resolve;
      }),
    );

    const { result } = await renderHook(() => useReviewActions());
    const pickOn = async (group: ReviewGroup): Promise<void> => {
      await act(async () => {
        result.current.choose(group);
      });
      await act(async () => {
        result.current.pick('groceries');
      });
      await act(async () => {
        result.current.onOptionsClosed();
      });
    };

    await pickOn(FIRST);

    expect(result.current.isBusy).toBe(true);

    await pickOn(SECOND);

    expect(mockPreview).toHaveBeenCalledTimes(1);
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(result.current.isConfirmOpen).toBe(false);

    await act(async () => finishWrite(FIRST.rowCount));

    expect(result.current.isBusy).toBe(false);
  });
});
