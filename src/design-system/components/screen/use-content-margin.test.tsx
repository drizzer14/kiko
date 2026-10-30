import type { ReactNode } from 'react';
import { darkTheme } from '@kiko/design-system/theme';
import { renderHook } from '@testing-library/react-native';
import { PaneContext, paneContextOf } from '@kiko/design-system/pane-context';

import '@kiko/design-system/unistyles';

import { useContentMargin, useContentMarginFor } from './use-content-margin';

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
    ['leading', 'none', 64, 678, 4],
    ['trailing', 'none', 64, 669, 4],
    ['bottom', 'leading', 64, 900, 4],
    ['bottom', 'none', 678, 678, 4],
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

describe('useContentMarginFor', () => {
  it.each([
    ['top', 'none', 64, 1032, true, 4],
    ['bottom', 'none', 72, 563, true, 4],
    ['leading', 'none', 64, 678, true, 5],
    ['trailing', 'none', 64, 669, true, 5],
    ['bottom', 'leading', 64, 900, true, 5],
    ['bottom', 'none', 678, 678, true, 5],
    ['leading', 'none', 64, 678, false, 4],
    ['bottom', 'none', 678, 678, false, 4],
  ] as const)(
    'reads native edge %s, vertical bar edge %s, bar %d of window %d, split %s as the spacing step %d',
    async (tabBarEdge, verticalBarEdge, tabBarHeight, windowHeight, isSplit, step) => {
      mockUseTabBarEdge.mockReturnValue(tabBarEdge);
      mockUseVerticalBarEdge.mockReturnValue(verticalBarEdge);
      mockTabBarHeight = tabBarHeight;
      mockWindowHeight = windowHeight;

      const { result } = await renderHook(() => useContentMarginFor(isSplit));

      expect(result.current).toBe(darkTheme.spacing(step));
    },
  );
});

describe('useContentMargin in a pane', () => {
  it('is the side-bar step 5 in a split pane beside a side bar, the base step 4 under a top bar', async () => {
    mockTabBarHeight = 64;
    mockWindowHeight = 669;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PaneContext.Provider value={paneContextOf('columns', 'primary')}>
        {children}
      </PaneContext.Provider>
    );

    mockUseTabBarEdge.mockReturnValue('trailing');
    const beside = await renderHook(() => useContentMargin(), { wrapper });

    mockUseTabBarEdge.mockReturnValue('top');
    const under = await renderHook(() => useContentMargin(), { wrapper });

    expect(beside.result.current).toBe(darkTheme.spacing(5));
    expect(under.result.current).toBe(darkTheme.spacing(4));
  });
});
