import { resolveBottomClearance } from './bottom-clearance';

describe('resolveBottomClearance', () => {
  describe('no vertical bar (verticalBarEdge = none)', () => {
    it('subtracts the inset the SafeAreaView already reserves', () => {
      expect(resolveBottomClearance(80, 34, 'none', 844)).toBe(46);
    });

    it('clamps to zero when the inset alone exceeds the bar', () => {
      expect(resolveBottomClearance(20, 34, 'none', 844)).toBe(0);
    });

    it('is the full bar height with no inset', () => {
      expect(resolveBottomClearance(80, 0, 'none', 844)).toBe(80);
    });

    it('keeps the ordinary bar on the shortest window, 83 of 844 points', () => {
      expect(resolveBottomClearance(83, 34, 'none', 844)).toBe(49);
    });

    it('clamps an implausible full-window-height bar to zero, 678 of 678 points', () => {
      // 678 - 34 = 644 would be a ~676pt footer covering the screen.
      expect(resolveBottomClearance(678, 34, 'none', 678)).toBe(0);
    });

    it('keeps a bar at exactly half the window, the plausible limit', () => {
      expect(resolveBottomClearance(300, 0, 'none', 600)).toBe(300);
    });

    it('trusts the bar height while the window height is not known yet', () => {
      expect(resolveBottomClearance(80, 34, 'none', 0)).toBe(46);
    });
  });

  describe.each(['leading', 'trailing'] as const)('a vertical bar on the %s edge', (edge) => {
    it('adds zero clearance, whatever the reported tab-bar height', () => {
      expect(resolveBottomClearance(678, 34, edge, 678)).toBe(0);
      expect(resolveBottomClearance(80, 34, edge, 844)).toBe(0);
      expect(resolveBottomClearance(0, 34, edge, 844)).toBe(0);
    });
  });
});
