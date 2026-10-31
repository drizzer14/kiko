import { match } from 'ts-pattern';

import type { TabBarPlacement } from './tab-bar-placement';

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
 * `placement` (`useTabBarPlacement`) says where the bar is. Only a `bottom`
 * bar covers the screen's bottom edge. A `top` bar leaves it free, so the
 * correct extra clearance is ZERO: the SafeAreaView's own bottom-inset
 * reservation is already the full clearance.
 *
 * Beside a `side` bar the reported `tabBarHeight` is untrusted and ignored,
 * and the SafeAreaView does NOT reserve the bottom inset (`usePaneScreen`
 * drops its bottom edge so the content runs to the window's bottom). The
 * home-indicator inset is the clearance instead, so a footer or a last row
 * ends exactly one inset above the window's bottom edge.
 *
 * Clamped at 0 in bottom-bar mode too: on a device whose bottom inset alone
 * exceeds the bar height, the SafeAreaView's reservation is already the
 * full, correct clearance and nothing more is needed.
 */
export const resolveBottomClearance = (
  tabBarHeight: number,
  insetBottom: number,
  placement: TabBarPlacement,
): number =>
  match(placement)
    .with('bottom', () => Math.max(tabBarHeight - insetBottom, 0))
    .with('side', () => insetBottom)
    .with('top', () => 0)
    .exhaustive();

/**
 * `resolveBottomClearance` for a scroll view with `contentInsetAdjustmentBehavior="automatic"`
 * (the `Screen` scroll branch, the ledger list of HoldingDetail): the same under a bottom or a top
 * bar, and nothing beside a side bar. There the scroll view reaches the window's bottom, its frame
 * overlaps the home-indicator safe area because the SafeAreaView does not cut it, and UIKit adds
 * that inset to the scroll content itself, so the JS adding it too would count it twice.
 */
export const resolveAutomaticScrollClearance = (
  tabBarHeight: number,
  insetBottom: number,
  placement: TabBarPlacement,
): number =>
  placement === 'side' ? 0 : resolveBottomClearance(tabBarHeight, insetBottom, placement);
