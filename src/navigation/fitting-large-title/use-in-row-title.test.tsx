import type { FC, ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';
import { PaneContext, type PaneName, paneContextOf } from '@kiko/design-system/pane-context';

import { useInRowTitle } from './use-in-row-title';

type BarEdge = 'leading' | 'trailing' | 'none';

const mockUseVerticalBarEdge = jest.fn((): BarEdge => 'none');
jest.mock('@kiko/display-regions', () => ({
  useVerticalBarEdge: () => mockUseVerticalBarEdge(),
}));

const inPane =
  (mode: 'columns' | 'rows', pane: PaneName): FC<{ children: ReactNode }> =>
  ({ children }) => (
    <PaneContext.Provider value={paneContextOf(mode, pane)}>{children}</PaneContext.Provider>
  );

describe('useInRowTitle', () => {
  // Only the left pane of a side-by-side split beside a trailing side bar, where the right pane's
  // native bar already carries its title in the row.
  it.each([
    ['columns', 'companion', 'trailing', true],
    ['columns', 'companion', 'leading', false],
    ['columns', 'companion', 'none', false],
    ['columns', 'primary', 'trailing', false],
    ['columns', 'primary', 'leading', false],
    ['columns', 'primary', 'none', false],
    ['rows', 'companion', 'trailing', false],
    ['rows', 'companion', 'leading', false],
    ['rows', 'companion', 'none', false],
    ['rows', 'primary', 'trailing', false],
    ['rows', 'primary', 'leading', false],
    ['rows', 'primary', 'none', false],
  ] as const)('in the %s %s pane beside a %s bar is %s', async (mode, pane, edge, expected) => {
    mockUseVerticalBarEdge.mockReturnValue(edge);

    const { result } = await renderHook(() => useInRowTitle(), { wrapper: inPane(mode, pane) });

    expect(result.current).toBe(expected);
  });

  it.each(['trailing', 'leading', 'none'] as const)(
    'is false on a single page (no pane) beside a %s bar',
    async (edge) => {
      mockUseVerticalBarEdge.mockReturnValue(edge);

      const { result } = await renderHook(() => useInRowTitle());

      expect(result.current).toBe(false);
    },
  );
});
