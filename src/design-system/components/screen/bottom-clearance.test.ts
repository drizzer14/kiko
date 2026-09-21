import { resolveBottomClearance } from './bottom-clearance';

describe('resolveBottomClearance', () => {
  describe('bottom-bar mode (isSidebarMode = false)', () => {
    it('subtracts the inset the SafeAreaView already reserves', () => {
      expect(resolveBottomClearance(80, 34, false)).toBe(46);
    });

    it('clamps to zero when the inset alone exceeds the bar', () => {
      expect(resolveBottomClearance(20, 34, false)).toBe(0);
    });

    it('is the full bar height with no inset', () => {
      expect(resolveBottomClearance(80, 0, false)).toBe(80);
    });
  });

  describe('sidebar mode (isSidebarMode = true)', () => {
    it('ignores the poisoned full-window-height tab bar and adds ZERO extra clearance — the exact measured Duo geometry', () => {
      // 678 - 34 = 644 would be the bug (a ~676pt footer covering the
      // screen). There is no floating bottom bar to clear in sidebar mode —
      // the SafeAreaView's own bottom-inset reservation is already the
      // full, correct clearance, exactly the existing zero-clamp's own
      // documented invariant, just reached via a reliable signal instead of
      // an accidental `tabBarHeight <= insetBottom`.
      expect(resolveBottomClearance(678, 34, true)).toBe(0);
    });

    it('adds zero clearance regardless of how implausible the reported tab-bar height is', () => {
      expect(resolveBottomClearance(999_999, 34, true)).toBe(0);
      expect(resolveBottomClearance(0, 34, true)).toBe(0);
    });
  });
});
