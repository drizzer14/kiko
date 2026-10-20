import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';
import type { HorizontalSizeClass, LayoutMode } from '@kiko/display-regions';
import { PaneContext, paneContextOf } from '@kiko/design-system/pane-context';

import '@kiko/design-system/unistyles';

import { styles } from './screen.styles';
import { useContentCap } from './use-pane-screen';

const mockUseLayoutMode = jest.fn((): LayoutMode => 'single');
const mockUseDisplayRegions = jest.fn((): { horizontalSizeClass: HorizontalSizeClass } => ({
  horizontalSizeClass: 'compact',
}));

const mockUseIsLargeWindow = jest.fn((): boolean => false);

jest.mock('@kiko/display-regions', () => ({
  useLayoutMode: () => mockUseLayoutMode(),
  useDisplayRegions: () => mockUseDisplayRegions(),
  useIsLargeWindow: () => mockUseIsLargeWindow(),
}));

const isLargeWindowOf = (width: number, height: number): boolean => {
  const actual = jest.requireActual('@kiko/display-regions') as {
    isLargeWindow: (sizeClass: 'regular', width: number, height: number) => boolean;
  };

  return actual.isLargeWindow('regular', width, height);
};

const inPane = ({ children }: { children: ReactNode }) => (
  <PaneContext.Provider value={paneContextOf('columns', 'companion')}>
    {children}
  </PaneContext.Provider>
);

describe('useContentCap', () => {
  beforeEach(() => {
    mockUseLayoutMode.mockReturnValue('single');
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'compact' });
    mockUseIsLargeWindow.mockReturnValue(false);
  });

  it.each([
    ['columns', 951, 669],
    ['rows', 669, 951],
  ] as const)(
    'caps the content in a pane of a %s window that is not large (%i x %i)',
    async (mode, width, height) => {
      mockUseLayoutMode.mockReturnValue(mode);
      mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });
      mockUseIsLargeWindow.mockReturnValue(isLargeWindowOf(width, height));

      const { result } = await renderHook(() => useContentCap(), { wrapper: inPane });

      expect(result.current).toBe(styles.paneCap);
    },
  );

  it('leaves the content of a pane on a large window uncapped', async () => {
    mockUseLayoutMode.mockReturnValue('columns');
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });
    mockUseIsLargeWindow.mockReturnValue(isLargeWindowOf(1376, 1032));

    const { result } = await renderHook(() => useContentCap(), { wrapper: inPane });

    expect(result.current).toBeUndefined();
  });

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

  it('leaves the content of a single pane on a compact window uncapped', async () => {
    const { result } = await renderHook(() => useContentCap());

    expect(result.current).toBeUndefined();
  });
});
