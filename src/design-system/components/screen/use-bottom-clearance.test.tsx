import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';
import { PaneContext, paneContextOf } from '@kiko/design-system/pane-context';

import '@kiko/design-system/unistyles';

import { useBottomClearance } from './use-bottom-clearance';

const MOCK_TAB_BAR_HEIGHT = 80;
const MOCK_BOTTOM_INSET = 34;

jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => 80,
}));

const mockUseVerticalBarEdge = jest.fn((): 'leading' | 'trailing' | 'none' => 'none');
jest.mock('@kiko/display-regions', () => ({
  useVerticalBarEdge: () => mockUseVerticalBarEdge(),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

const inPane =
  (mode: 'columns' | 'rows', pane: 'companion' | 'primary') =>
  ({ children }: { children: ReactNode }) => (
    <PaneContext.Provider value={paneContextOf(mode, pane)}>{children}</PaneContext.Provider>
  );

describe('useBottomClearance', () => {
  beforeEach(() => {
    mockUseVerticalBarEdge.mockReturnValue('none');
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
});
