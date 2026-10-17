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

jest.mock('@kiko/display-regions', () => ({
  useLayoutMode: () => mockUseLayoutMode(),
  useDisplayRegions: () => mockUseDisplayRegions(),
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
  });

  it('caps the content in a pane', async () => {
    mockUseLayoutMode.mockReturnValue('columns');
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });

    const { result } = await renderHook(() => useContentCap(), { wrapper: inPane });

    expect(result.current).toBe(styles.paneCap);
  });

  it('caps the content of a single pane on a regular window', async () => {
    mockUseDisplayRegions.mockReturnValue({ horizontalSizeClass: 'regular' });

    const { result } = await renderHook(() => useContentCap());

    expect(result.current).toBe(styles.paneCap);
  });

  it('leaves the content of a single pane on a compact window uncapped', async () => {
    const { result } = await renderHook(() => useContentCap());

    expect(result.current).toBeUndefined();
  });
});
