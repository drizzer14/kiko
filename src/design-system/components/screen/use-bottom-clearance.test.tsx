import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';
import { PaneContext, paneContextOf } from '@kiko/design-system/pane-context';

import '@kiko/design-system/unistyles';

import { useBottomClearance } from './use-bottom-clearance';

const MOCK_TAB_BAR_HEIGHT = 80;
const MOCK_BOTTOM_INSET = 34;

let mockTabBarHeight = MOCK_TAB_BAR_HEIGHT;
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => mockTabBarHeight,
}));

let mockWindowHeight = 844;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: mockWindowHeight, scale: 3, fontScale: 1 }),
}));

const mockUseTabBarEdge = jest.fn((): 'top' | 'bottom' | 'leading' | 'trailing' | 'none' => 'none');
const mockUseVerticalBarEdge = jest.fn((): 'leading' | 'trailing' | 'none' => 'none');
jest.mock('@kiko/display-regions', () => ({
  useTabBarEdge: () => mockUseTabBarEdge(),
  useVerticalBarEdge: () => mockUseVerticalBarEdge(),
  useIsLargeWindow: () => false,
}));

let mockBottomInset = MOCK_BOTTOM_INSET;
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: mockBottomInset, left: 0 }),
}));

const inPane =
  (mode: 'columns' | 'rows', pane: 'companion' | 'primary') =>
  ({ children }: { children: ReactNode }) => (
    <PaneContext.Provider value={paneContextOf(mode, pane)}>{children}</PaneContext.Provider>
  );

describe('useBottomClearance', () => {
  beforeEach(() => {
    mockUseTabBarEdge.mockReturnValue('none');
    mockUseVerticalBarEdge.mockReturnValue('none');
    mockTabBarHeight = MOCK_TAB_BAR_HEIGHT;
    mockBottomInset = MOCK_BOTTOM_INSET;
    mockWindowHeight = 844;
  });

  it('is the tab bar height above the bottom inset outside a pane', async () => {
    const { result } = await renderHook(() => useBottomClearance());

    expect(result.current).toBe(MOCK_TAB_BAR_HEIGHT - MOCK_BOTTOM_INSET);
  });

  it.each([
    ['columns', 'companion'],
    ['columns', 'primary'],
    ['rows', 'primary'],
  ] as const)(
    'is the same in a %s %s pane, which reaches the bottom of the window',
    async (mode, pane) => {
      const { result } = await renderHook(() => useBottomClearance(), {
        wrapper: inPane(mode, pane),
      });

      expect(result.current).toBe(MOCK_TAB_BAR_HEIGHT - MOCK_BOTTOM_INSET);
    },
  );

  it('is zero in the pane above the other one, which has no tab bar over it', async () => {
    const { result } = await renderHook(() => useBottomClearance(), {
      wrapper: inPane('rows', 'companion'),
    });

    expect(result.current).toBe(0);
  });

  it('is zero beside a vertical tab bar, in a pane or not', async () => {
    mockUseVerticalBarEdge.mockReturnValue('trailing');

    const { result } = await renderHook(() => useBottomClearance());

    expect(result.current).toBe(0);
  });

  it('is zero under a top tab bar, 64 over 20 on the Pro 13-inch', async () => {
    mockUseTabBarEdge.mockReturnValue('top');
    mockTabBarHeight = 64;
    mockBottomInset = 20;
    mockWindowHeight = 1376;

    const { result } = await renderHook(() => useBottomClearance());

    expect(result.current).toBe(0);
  });

  it('keeps 62 under a bottom tab bar, 72 over 10 on the 375x563 window', async () => {
    mockUseTabBarEdge.mockReturnValue('bottom');
    mockTabBarHeight = 72;
    mockBottomInset = 10;
    mockWindowHeight = 563;

    const { result } = await renderHook(() => useBottomClearance());

    expect(result.current).toBe(62);
  });

  it('keeps tbh - inset under the Duo inner portrait bottom bar', async () => {
    mockUseTabBarEdge.mockReturnValue('bottom');
    mockTabBarHeight = 83;
    mockBottomInset = 20;
    mockWindowHeight = 951;

    const { result } = await renderHook(() => useBottomClearance());

    expect(result.current).toBe(83 - 20);
  });

  it('is zero when the native edge says bottom but the system reports a vertical bar (Duo inner landscape)', async () => {
    mockUseTabBarEdge.mockReturnValue('bottom');
    mockUseVerticalBarEdge.mockReturnValue('trailing');
    mockTabBarHeight = 83;
    mockBottomInset = 20;
    mockWindowHeight = 669;

    const { result } = await renderHook(() => useBottomClearance());

    expect(result.current).toBe(0);
  });

  it('is zero in the pane above the other one even under a bottom tab bar', async () => {
    mockUseTabBarEdge.mockReturnValue('bottom');

    const { result } = await renderHook(() => useBottomClearance(), {
      wrapper: inPane('rows', 'companion'),
    });

    expect(result.current).toBe(0);
  });
});
