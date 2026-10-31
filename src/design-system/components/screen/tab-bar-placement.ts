import { match } from 'ts-pattern';
import type { TabBarEdge, VerticalBarEdge } from '@kiko/display-regions';

export type TabBarPlacement = 'top' | 'bottom' | 'side';

// The fraction of window height a native BOTTOM tab bar can plausibly reach. A real bottom tab bar
// tops out well under this even at the largest Dynamic Type size and on the shortest current
// iPhone window (~667pt, ~83pt bar = ~12%). A tab bar that reports its own FULL frame height
// (678 of 678 on the Duo primary panel, 100%) sits far above it.
const IMPLAUSIBLE_TAB_BAR_HEIGHT_FRACTION = 0.5;

/**
 * Where the tab bar sits in this window, from the native read of the bar's real frame
 * (`useTabBarEdge`), never from the size class: the Duo's inner portrait window is regular and
 * still has its bar at the bottom.
 *
 * `leading` and `trailing` are a side bar. `bottom` and `none` (an old binary, no bar found yet:
 * the read says nothing) share today's rule: a vertical bar edge from the system's own trait, or
 * an implausible bar height (the Duo misreport), is a side bar, anything else is a bottom bar. A
 * native `bottom` comes from a controller bar that may claim a bottom frame, so it never
 * overrides the system's vertical-bar trait (the Duo's inner landscape window).
 */
export const tabBarPlacementOf = (
  tabBarEdge: TabBarEdge,
  verticalBarEdge: VerticalBarEdge,
  tabBarHeight: number,
  windowHeight: number,
): TabBarPlacement => {
  const isImplausibleTabBarHeight =
    windowHeight > 0 && tabBarHeight / windowHeight > IMPLAUSIBLE_TAB_BAR_HEIGHT_FRACTION;
  const bottomOrSide = (): TabBarPlacement =>
    verticalBarEdge !== 'none' || isImplausibleTabBarHeight ? 'side' : 'bottom';

  return match(tabBarEdge)
    .with('top', (): TabBarPlacement => 'top')
    .with('leading', 'trailing', (): TabBarPlacement => 'side')
    .with('bottom', 'none', bottomOrSide)
    .exhaustive();
};
