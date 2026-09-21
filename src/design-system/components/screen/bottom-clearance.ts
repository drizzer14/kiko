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
 * `isSidebarMode` (see `isSidebarTabBarMode`, `sidebar-mode.ts`) — when the
 * native tab bar renders as a right-edge sidebar (a regular-width scene, e.g.
 * the iPhone Duo primary panel or a landscape Plus/Max-class iPhone), it
 * misreports its own height as the FULL WINDOW HEIGHT rather than a short
 * bar (confirmed: 678pt on a 678pt-tall window). `tabBarHeight` is therefore
 * UNTRUSTED in sidebar mode and ignored entirely: there is no floating
 * bottom bar to clear at all in that mode, so the correct extra clearance is
 * ZERO — the SafeAreaView's own bottom-inset reservation is already the
 * full, correct clearance, exactly the same invariant the ordinary zero-clamp
 * below already documents, just reached through a reliable signal instead of
 * the accidental `tabBarHeight <= insetBottom` case (which the bug's real
 * numbers, 678 > 34, never triggers).
 *
 * Clamped at 0 in bottom-bar mode too: on a device whose bottom inset alone
 * exceeds the bar height, the SafeAreaView's reservation is already the
 * full, correct clearance and nothing more is needed.
 */
export const resolveBottomClearance = (
  tabBarHeight: number,
  insetBottom: number,
  isSidebarMode: boolean,
): number => {
  if (isSidebarMode) {
    return 0;
  }

  return Math.max(tabBarHeight - insetBottom, 0);
};
