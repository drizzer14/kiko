import { renderHook } from '@testing-library/react-native';

import { useIsTabBarAtTop } from './use-is-tab-bar-at-top';
import type { TabBarPlacement } from './tab-bar-placement';

let mockPlacement: TabBarPlacement = 'bottom';
jest.mock('./use-tab-bar-placement', () => ({
  useTabBarPlacement: () => mockPlacement,
}));

describe('useIsTabBarAtTop', () => {
  it.each([
    ['top', true],
    ['bottom', false],
    ['side', false],
  ] as const)('is read from the placement %s as %s', async (placement, expected) => {
    mockPlacement = placement;

    const { result } = await renderHook(() => useIsTabBarAtTop());

    expect(result.current).toBe(expected);
  });
});
