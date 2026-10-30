import { useVerticalBarEdge } from '@kiko/display-regions';
import { usePaneContext } from '@kiko/design-system/pane-context';

/**
 * Whether the screen is the left pane of a side-by-side split beside a trailing side bar. There
 * the native bar of the right pane carries its title in the bar's own row, while the left pane's
 * bar keeps the classic two-row large title (measured on the Surface Duo, look-build-3). The left
 * pane matches the right one by showing its own title in the row instead. Only the `companion`
 * pane of `columns` has no window edge on its right (`PANES` in pane-context.ts), so a null pane
 * (one page), the primary pane and the `rows` panes never qualify.
 */
export const useInRowTitle = (): boolean => {
  const pane = usePaneContext();
  const verticalBarEdge = useVerticalBarEdge();

  return pane?.edges.right === false && verticalBarEdge === 'trailing';
};
