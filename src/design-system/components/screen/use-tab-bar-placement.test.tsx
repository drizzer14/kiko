import { renderHook } from '@testing-library/react-native';

import { useTabBarPlacement } from './use-tab-bar-placement';

const mockUseTabBarEdge = jest.fn((): 'top' | 'bottom' | 'leading' | 'trailing' | 'none' => 'none');
const mockUseVerticalBarEdge = jest.fn((): 'leading' | 'trailing' | 'none' => 'none');
jest.mock('@kiko/display-regions', () => ({
  useTabBarEdge: () => mockUseTabBarEdge(),
  useVerticalBarEdge: () => mockUseVerticalBarEdge(),
}));

let mockTabBarHeight = 0;
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => mockTabBarHeight,
}));

let mockWindowHeight = 0;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 0, height: mockWindowHeight, scale: 3, fontScale: 1 }),
}));

describe('useTabBarPlacement', () => {
  it.each([
    ['top', 'none', 64, 1376, 'top'],
    ['bottom', 'none', 72, 563, 'bottom'],
    ['bottom', 'none', 83, 951, 'bottom'],
    ['none', 'trailing', 678, 678, 'side'],
  ] as const)(
    'reads native edge %s, vertical bar edge %s, bar %d of window %d as %s',
    async (tabBarEdge, verticalBarEdge, tabBarHeight, windowHeight, expected) => {
      mockUseTabBarEdge.mockReturnValue(tabBarEdge);
      mockUseVerticalBarEdge.mockReturnValue(verticalBarEdge);
      mockTabBarHeight = tabBarHeight;
      mockWindowHeight = windowHeight;

      const { result } = await renderHook(() => useTabBarPlacement());

      expect(result.current).toBe(expected);
    },
  );
});
