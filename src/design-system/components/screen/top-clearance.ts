import type { TabBarPlacement } from './tab-bar-placement';

// Measured on the iPad: the floating top bar's bottom edge sits this far below the safe-area top
// inset (76 pt at a 32 pt inset, 54 pt at a 10 pt inset). The reported `tabBarHeight` (64, 72,
// 77) is not the pill, so it would start content 20 to 28 pt below the bar.
const TOP_TAB_BAR_PILL_HEIGHT = 44;

/**
 * The clearance a headerless screen adds BELOW the safe-area inset, so its content starts under the
 * floating top tab bar instead of scrolling under the glass. The enclosing `SafeAreaView` reserves
 * only the inset, so the pill is the whole remainder. A `bottom` or `side` bar leaves the top edge
 * free: zero, which keeps every iPhone and Duo window as it is.
 */
export const resolveTopClearance = (placement: TabBarPlacement): number =>
  placement === 'top' ? TOP_TAB_BAR_PILL_HEIGHT : 0;
