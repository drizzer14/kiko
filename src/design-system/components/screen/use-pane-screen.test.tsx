import type { ReactNode } from 'react';
import { darkTheme } from '@kiko/design-system/theme';
import { renderHook } from '@testing-library/react-native';
import type { HorizontalSizeClass, LayoutMode, TabBarEdge } from '@kiko/display-regions';
import { PaneContext, PaneWidthContext, paneContextOf } from '@kiko/design-system/pane-context';

import '@kiko/design-system/unistyles';

import { styles } from './screen.styles';
import { useContentCap, usePaneContentWidth } from './use-pane-screen';

const mockUseLayoutMode = jest.fn((): LayoutMode => 'single');
const mockUseDisplayRegions = jest.fn((): { horizontalSizeClass: HorizontalSizeClass } => ({
  horizontalSizeClass: 'compact',
}));
const mockUseTabBarEdge = jest.fn((): TabBarEdge => 'none');

jest.mock('@kiko/display-regions', () => ({
  useLayoutMode: () => mockUseLayoutMode(),
  useDisplayRegions: () => mockUseDisplayRegions(),
  useTabBarEdge: () => mockUseTabBarEdge(),
  useVerticalBarEdge: () => 'none',
}));

jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => 64,
}));

const inPane = ({ children }: { children: ReactNode }) => (
  <PaneContext.Provider value={paneContextOf('columns', 'companion')}>
    {children}
  </PaneContext.Provider>
);

describe('useContentCap', () => {
  beforeEach(() => {
    mockUseLayoutMode.mockReturnValue('single');
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'compact' });
    mockUseTabBarEdge.mockReturnValue('none');
  });

  it.each([
    ['the Duo inner landscape window', 'columns', 'bottom'],
    ['the Duo inner portrait window', 'rows', 'bottom'],
    ['the Duo inner landscape window with no bar found', 'columns', 'none'],
    ['a regular window with a side bar', 'columns', 'leading'],
  ] as const)('caps the content in a pane of %s', async (_name, mode, tabBarEdge) => {
    mockUseLayoutMode.mockReturnValue(mode);
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });
    mockUseTabBarEdge.mockReturnValue(tabBarEdge);

    const { result } = await renderHook(() => useContentCap(), { wrapper: inPane });

    expect(result.current).toBe(styles.paneCap);
  });

  it.each([
    ['a column split (a 13-inch iPad in landscape, a small Stage Manager 1032 x 683)', 'columns'],
    ['a small Stage Manager row split (683 x 909)', 'rows'],
  ] as const)(
    'leaves the content of a pane of %s uncapped when the tab bar is at the top',
    async (_name, mode) => {
      mockUseLayoutMode.mockReturnValue(mode);
      mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });
      mockUseTabBarEdge.mockReturnValue('top');

      const { result } = await renderHook(() => useContentCap(), { wrapper: inPane });

      expect(result.current).toBeUndefined();
    },
  );

  it('caps the content in a pane on a compact window', async () => {
    mockUseLayoutMode.mockReturnValue('columns');

    const { result } = await renderHook(() => useContentCap(), { wrapper: inPane });

    expect(result.current).toBe(styles.paneCap);
  });

  it('caps the content of a single pane on a regular window', async () => {
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });

    const { result } = await renderHook(() => useContentCap());

    expect(result.current).toBe(styles.paneCap);
  });

  // The panes follow the settled mode, which lags the live one by a settle delay: a screen not yet
  // in a pane must keep its cap while the live mode already reads split.
  it.each<LayoutMode>(['single', 'columns', 'rows'])(
    'caps the content outside a pane on a regular window while the live mode reads %s',
    async (mode) => {
      mockUseLayoutMode.mockReturnValue(mode);
      mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });

      const { result } = await renderHook(() => useContentCap());

      expect(result.current).toBe(styles.paneCap);
    },
  );

  it('caps the content outside a pane on a regular window with the tab bar at the top', async () => {
    mockUseLayoutMode.mockReturnValue('columns');
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });
    mockUseTabBarEdge.mockReturnValue('top');

    const { result } = await renderHook(() => useContentCap());

    expect(result.current).toBe(styles.paneCap);
  });

  it('leaves the content of a single pane on a compact window uncapped', async () => {
    const { result } = await renderHook(() => useContentCap());

    expect(result.current).toBeUndefined();
  });
});

describe('usePaneContentWidth', () => {
  const inPaneOfWidth =
    (paneWidth: number) =>
    ({ children }: { children: ReactNode }) => (
      <PaneContext.Provider value={paneContextOf('columns', 'companion')}>
        <PaneWidthContext.Provider value={paneWidth}>{children}</PaneWidthContext.Provider>
      </PaneContext.Provider>
    );

  beforeEach(() => {
    mockUseLayoutMode.mockReturnValue('columns');
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });
    mockUseTabBarEdge.mockReturnValue('none');
  });

  it.each([
    ['a leading side bar', 'leading', 687.5, darkTheme.layout.paneMaxWidth],
    ['a trailing side bar', 'trailing', 687.5, darkTheme.layout.paneMaxWidth],
    ['no bar read', 'none', 687.5, darkTheme.layout.paneMaxWidth],
    ['a bottom bar', 'bottom', 687.5, darkTheme.layout.paneMaxWidth],
    ['a side bar, in a pane under the cap', 'leading', 371.5, 371.5],
    ['a top bar', 'top', 687.5, 687.5],
    ['a top bar, in a narrow pane', 'top', 371.5, 371.5],
  ] as const)(
    'is the pane width limited by the cap with %s',
    async (_name, tabBarEdge, paneWidth, expected) => {
      mockUseTabBarEdge.mockReturnValue(tabBarEdge);

      const { result } = await renderHook(() => usePaneContentWidth(), {
        wrapper: inPaneOfWidth(paneWidth),
      });

      expect(result.current).toBe(expected);
    },
  );

  it('is null outside a pane', async () => {
    const { result } = await renderHook(() => usePaneContentWidth());

    expect(result.current).toBeNull();
  });
});
