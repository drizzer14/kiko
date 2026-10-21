import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { useTopBarBand } from './use-top-bar-band';

const mockUseTabBarEdge = jest.fn((): 'top' | 'bottom' | 'leading' | 'trailing' | 'none' => 'top');
const mockUseVerticalBarEdge = jest.fn((): 'leading' | 'trailing' | 'none' => 'none');
jest.mock('@kiko/display-regions', () => ({
  useTabBarEdge: () => mockUseTabBarEdge(),
  useVerticalBarEdge: () => mockUseVerticalBarEdge(),
}));

jest.mock('react-native-bottom-tabs', () => ({ useBottomTabBarHeight: () => 64 }));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 1376, height: 1032, scale: 2, fontScale: 1 }),
}));

const withTopInset =
  (top: number) =>
  ({ children }: { children: ReactNode }) => (
    <SafeAreaInsetsContext.Provider value={{ top, right: 0, bottom: 0, left: 0 }}>
      {children}
    </SafeAreaInsetsContext.Provider>
  );

describe('useTopBarBand', () => {
  beforeEach(() => {
    mockUseTabBarEdge.mockReturnValue('top');
    mockUseVerticalBarEdge.mockReturnValue('none');
  });

  it.each([
    [32, 76],
    [10, 54],
  ])(
    'is the inset plus the 44 pt pill under a top tab bar: inset %d gives %d',
    async (inset, band) => {
      const { result } = await renderHook(() => useTopBarBand(), { wrapper: withTopInset(inset) });

      expect(result.current).toBe(band);
    },
  );

  it.each([
    ['bottom', 'none'],
    ['none', 'trailing'],
    ['none', 'leading'],
  ] as const)(
    'is zero under a %s tab bar with vertical bar edge %s, whatever the inset',
    async (tabBarEdge, verticalBarEdge) => {
      mockUseTabBarEdge.mockReturnValue(tabBarEdge);
      mockUseVerticalBarEdge.mockReturnValue(verticalBarEdge);

      const { result } = await renderHook(() => useTopBarBand(), { wrapper: withTopInset(32) });

      expect(result.current).toBe(0);
    },
  );
});
