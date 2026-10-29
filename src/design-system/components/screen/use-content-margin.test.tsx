import { darkTheme } from '@kiko/design-system/theme';
import { renderHook } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';

import { useContentMargin } from './use-content-margin';

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

describe('useContentMargin', () => {
  it.each([
    ['top', 'none', 64, 1032, 4],
    ['bottom', 'none', 72, 563, 4],
    ['none', 'none', 0, 844, 4],
    ['leading', 'none', 64, 678, 5],
    ['trailing', 'none', 64, 669, 5],
    ['bottom', 'leading', 64, 900, 5],
    ['bottom', 'none', 678, 678, 5],
  ] as const)(
    'reads native edge %s, vertical bar edge %s, bar %d of window %d as the spacing step %d',
    async (tabBarEdge, verticalBarEdge, tabBarHeight, windowHeight, step) => {
      mockUseTabBarEdge.mockReturnValue(tabBarEdge);
      mockUseVerticalBarEdge.mockReturnValue(verticalBarEdge);
      mockTabBarHeight = tabBarHeight;
      mockWindowHeight = windowHeight;

      const { result } = await renderHook(() => useContentMargin());

      expect(result.current).toBe(darkTheme.spacing(step));
    },
  );
});
