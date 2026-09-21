// The fraction of window height a native BOTTOM tab bar can plausibly reach.
// A real bottom tab bar tops out well under this even at the largest Dynamic
// Type size and on the shortest current iPhone window (~667pt, ~83pt bar =
// ~12%). The sidebar misreport is the tab bar's FULL frame height — measured
// 678/678 = 100% on the Duo primary panel. This threshold sits with wide
// margin above the former and wide margin below the latter, so it never
// misfires on ordinary bottom-bar geometry. See the duo-adaptive design doc
// and this plan's "Design decision" section for the full justification.
const IMPLAUSIBLE_TAB_BAR_HEIGHT_FRACTION = 0.5;

// The single, shared "is the native tab bar NOT at the bottom" signal.
// `Screen`'s bottom-clearance/horizontal-padding math and the Home
// AddTransactionFab both key off this ONE function so they can never
// disagree about which mode the app is in.
//
// True when EITHER: the reported tab-bar height is an implausible fraction
// of the window height (the sidebar misreport itself), OR a nonzero
// horizontal safe-area inset is present (only possible at a regular
// horizontal size class — the same trait that moves the tab bar to a
// sidebar in the first place, on the Duo primary panel and on a landscape
// Plus/Max-class iPhone alike). Either signal alone is sufficient; both are
// expected to co-occur on a real regular-width scene.
export const isSidebarTabBarMode = (
  tabBarHeight: number,
  windowHeight: number,
  insetLeft: number,
  insetRight: number,
): boolean => {
  const isImplausibleTabBarHeight =
    windowHeight > 0 && tabBarHeight / windowHeight > IMPLAUSIBLE_TAB_BAR_HEIGHT_FRACTION;
  const hasHorizontalInset = insetLeft > 0 || insetRight > 0;

  return isImplausibleTabBarHeight || hasHorizontalInset;
};
