import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';
import { HeaderHeightContext } from '@react-navigation/elements';
import { PaneContext, paneContextOf } from '@kiko/design-system/pane-context';

import '@kiko/design-system/unistyles';

import { useTopClearance } from './use-top-clearance';

let mockTabBarHeight = 64;
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => mockTabBarHeight,
}));

let mockWindowWidth = 1376;
let mockWindowHeight = 1032;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWindowWidth, height: mockWindowHeight, scale: 2, fontScale: 1 }),
}));

const mockUseTabBarEdge = jest.fn((): 'top' | 'bottom' | 'leading' | 'trailing' | 'none' => 'top');
const mockUseVerticalBarEdge = jest.fn((): 'leading' | 'trailing' | 'none' => 'none');
jest.mock('@kiko/display-regions', () => ({
  useTabBarEdge: () => mockUseTabBarEdge(),
  useVerticalBarEdge: () => mockUseVerticalBarEdge(),
}));

const inPane =
  (mode: 'columns' | 'rows', pane: 'companion' | 'primary') =>
  ({ children }: { children: ReactNode }) => (
    <PaneContext.Provider value={paneContextOf(mode, pane)}>{children}</PaneContext.Provider>
  );

const withHeader =
  (headerHeight: number) =>
  ({ children }: { children: ReactNode }) => (
    <HeaderHeightContext.Provider value={headerHeight}>{children}</HeaderHeightContext.Provider>
  );

describe('useTopClearance', () => {
  beforeEach(() => {
    mockUseTabBarEdge.mockReturnValue('top');
    mockUseVerticalBarEdge.mockReturnValue('none');
    mockTabBarHeight = 64;
    mockWindowWidth = 1376;
    mockWindowHeight = 1032;
  });

  it('is the 44 pt pill under a top tab bar outside a pane, 1376x1032', async () => {
    const { result } = await renderHook(() => useTopClearance());

    expect(result.current).toBe(44);
  });

  it.each([
    ['columns', 'primary'],
    ['columns', 'companion'],
    ['rows', 'companion'],
  ] as const)(
    'is the pill in a %s %s pane, which reaches the top of the window',
    async (mode, pane) => {
      const { result } = await renderHook(() => useTopClearance(), {
        wrapper: inPane(mode, pane),
      });

      expect(result.current).toBe(44);
    },
  );

  it('is zero in the pane below the other one, which has no tab bar over it', async () => {
    const { result } = await renderHook(() => useTopClearance(), {
      wrapper: inPane('rows', 'primary'),
    });

    expect(result.current).toBe(0);
  });

  it('is zero under a bottom tab bar on a regular 669x951 window (Duo inner portrait)', async () => {
    mockUseTabBarEdge.mockReturnValue('bottom');
    mockTabBarHeight = 83;
    mockWindowWidth = 669;
    mockWindowHeight = 951;

    const { result } = await renderHook(() => useTopClearance());

    expect(result.current).toBe(0);
  });

  it('is zero under a bottom tab bar on the compact 375x563 window', async () => {
    mockUseTabBarEdge.mockReturnValue('bottom');
    mockTabBarHeight = 72;
    mockWindowWidth = 375;
    mockWindowHeight = 563;

    const { result } = await renderHook(() => useTopClearance());

    expect(result.current).toBe(0);
  });

  it('is zero when a native header is shown, which already clears the bar', async () => {
    const { result } = await renderHook(() => useTopClearance(), {
      wrapper: withHeader(96),
    });

    expect(result.current).toBe(0);
  });
});
