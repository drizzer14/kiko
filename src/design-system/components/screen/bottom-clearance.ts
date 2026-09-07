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
 * Clamped at 0: on a device whose bottom inset alone exceeds the bar height,
 * the SafeAreaView's reservation is already the full, correct clearance and
 * nothing more is needed.
 */
export const resolveBottomClearance = (tabBarHeight: number, insetBottom: number): number =>
  Math.max(tabBarHeight - insetBottom, 0);
