import { renderHook } from '@testing-library/react-native';

import type { TabBarPlacement } from './tab-bar-placement';
import { useIsTabBarNotAtBottom } from './use-is-tab-bar-not-at-bottom';

let mockPlacement: TabBarPlacement = 'bottom';
jest.mock('./use-tab-bar-placement', () => ({
  useTabBarPlacement: () => mockPlacement,
}));

describe('useIsTabBarNotAtBottom', () => {
  it.each([
    ['top', true],
    ['side', true],
    ['bottom', false],
  ] as const)('is read from the placement %s as %s', async (placement, expected) => {
    mockPlacement = placement;

    const { result } = await renderHook(() => useIsTabBarNotAtBottom());

    expect(result.current).toBe(expected);
  });
});
