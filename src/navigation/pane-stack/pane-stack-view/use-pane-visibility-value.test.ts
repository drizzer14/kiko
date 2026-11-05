import { renderHook } from '@testing-library/react-native';

import { usePaneVisibilityValue } from './use-pane-visibility-value';

let mockIsFocused = true;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockIsFocused,
}));

const INPUT = {
  isSplit: true,
  layer: null,
  companionTopKey: 'form',
  primaryTopKey: 'home',
  detailRoute: null,
};

const visibleKeysOf = async (input: Parameters<typeof usePaneVisibilityValue>[0]) => {
  const { result } = await renderHook(() => usePaneVisibilityValue(input));

  return [...(result.current?.visibleKeys ?? [])].sort();
};

describe('usePaneVisibilityValue', () => {
  beforeEach(() => {
    mockIsFocused = true;
  });

  it('is null in one pane', async () => {
    const { result } = await renderHook(() => usePaneVisibilityValue({ ...INPUT, isSplit: false }));

    expect(result.current).toBeNull();
  });

  it('lists the top route of each pane when the navigator has no layer', async () => {
    expect(await visibleKeysOf(INPUT)).toEqual(['form', 'home']);
  });

  it('lists the top route of each pane while the layer holds only its root', async () => {
    expect(await visibleKeysOf({ ...INPUT, layer: { topKey: null } })).toEqual(['form', 'home']);
  });

  it('lists the top route of the layer alone while it holds a page', async () => {
    expect(await visibleKeysOf({ ...INPUT, layer: { topKey: 'tables' } })).toEqual(['tables']);
  });

  it('carries the tab focus and the detail route', async () => {
    mockIsFocused = false;
    const detailRoute = {
      key: 'form',
      name: 'TransactionForm',
      params: undefined,
      isDefault: false,
    };
    const { result } = await renderHook(() => usePaneVisibilityValue({ ...INPUT, detailRoute }));

    expect(result.current?.isTabFocused).toBe(false);
    expect(result.current?.detailRoute).toBe(detailRoute);
  });

  it('keeps one value while the keys stay the same, though the layer is a new object', async () => {
    const { result, rerender } = await renderHook(
      (layer: { topKey: string | null }) => usePaneVisibilityValue({ ...INPUT, layer }),
      { initialProps: { topKey: 'tables' } },
    );
    const first = result.current;

    await rerender({ topKey: 'tables' });

    expect(result.current).toBe(first);

    await rerender({ topKey: null });

    expect(result.current).not.toBe(first);
  });
});
