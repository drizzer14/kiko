import type { VerticalBarEdge } from '@kiko/display-regions';

// The fraction of window height a native BOTTOM tab bar can plausibly reach. A real bottom tab bar
// tops out well under this even at the largest Dynamic Type size and on the shortest current
// iPhone window (~667pt, ~83pt bar = ~12%). A tab bar that reports its own FULL frame height
// (678 of 678 on the Duo primary panel, 100%) sits far above it.
const IMPLAUSIBLE_TAB_BAR_HEIGHT_FRACTION = 0.5;

/**
 * The clearance a view that owns the screen's true bottom edge must add ABOVE
 * the safe-area inset, so its last row clears the floating native glass tab
 * bar exactly once.
 *
 * The enclosing `SafeAreaView` already reserves `insetBottom` as its own
 * padding, so a consumer that adds the full `tabBarHeight` on top of it
 * double-counts the inset. Home did exactly that — 80 + 16 + 34 = 130 pt of
 * dead space under the last transaction, against 96 pt on every other screen —
 * because it opts out of `Screen`'s own bottom handling with `bleedBottom` and
 * computed its own clearance. This function is the ONE place that arithmetic
 * lives, shared by `Screen` and by every `bleedBottom` child.
 *
 * `verticalBarEdge` (`useVerticalBarEdge`, from the system's own trait) is
 * `leading` or `trailing` when the system places the tab bar as a vertical
 * bar (a regular-width scene, e.g. the iPhone Duo's inner window). Then there
 * is no floating bottom bar to clear at all, the reported `tabBarHeight` is
 * untrusted and ignored, and the correct extra clearance is ZERO: the
 * SafeAreaView's own bottom-inset reservation is already the full clearance.
 *
 * With `none`, a tab bar that reports an implausible fraction of the window
 * height (the same misreport) is clamped to zero too, as a guard for a
 * window where the trait and the bar disagree.
 *
 * Clamped at 0 in bottom-bar mode too: on a device whose bottom inset alone
 * exceeds the bar height, the SafeAreaView's reservation is already the
 * full, correct clearance and nothing more is needed.
 */
export const resolveBottomClearance = (
  tabBarHeight: number,
  insetBottom: number,
  verticalBarEdge: VerticalBarEdge,
  windowHeight: number,
): number => {
  const isImplausibleTabBarHeight =
    windowHeight > 0 && tabBarHeight / windowHeight > IMPLAUSIBLE_TAB_BAR_HEIGHT_FRACTION;

  if (verticalBarEdge !== 'none' || isImplausibleTabBarHeight) {
    return 0;
  }

  return Math.max(tabBarHeight - insetBottom, 0);
};
