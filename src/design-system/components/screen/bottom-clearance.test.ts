import { resolveBottomClearance } from './bottom-clearance';

describe('resolveBottomClearance', () => {
  describe('a bottom bar', () => {
    it('subtracts the inset the SafeAreaView already reserves', () => {
      expect(resolveBottomClearance(80, 34, 'bottom')).toBe(46);
    });

    it('clamps to zero when the inset alone exceeds the bar', () => {
      expect(resolveBottomClearance(20, 34, 'bottom')).toBe(0);
    });

    it('is the full bar height with no inset', () => {
      expect(resolveBottomClearance(80, 0, 'bottom')).toBe(80);
    });

    it('keeps the ordinary bar on the shortest window, 83 of 844 points', () => {
      expect(resolveBottomClearance(83, 34, 'bottom')).toBe(49);
    });

    it('keeps 62 under a bottom bar, 72 over 10 (375x563)', () => {
      expect(resolveBottomClearance(72, 10, 'bottom')).toBe(62);
    });

    it('keeps 57 under a bottom bar, 77 over 20 (Slide Over)', () => {
      expect(resolveBottomClearance(77, 20, 'bottom')).toBe(57);
    });

    it("keeps tbh - inset under the Duo inner portrait's bottom bar", () => {
      expect(resolveBottomClearance(83, 20, 'bottom')).toBe(63);
    });
  });

  describe('a top bar', () => {
    it('is zero under a top bar, 64 pt reported over a 20 pt inset (Pro 13-inch full screen; was 44)', () => {
      expect(resolveBottomClearance(64, 20, 'top')).toBe(0);
    });

    it('is zero under a top bar, 72 over 10 (Stage Manager half; was 62)', () => {
      expect(resolveBottomClearance(72, 10, 'top')).toBe(0);
    });
  });

  describe('a side bar', () => {
    it('is zero beside a side bar, whatever the reported tab-bar height', () => {
      expect(resolveBottomClearance(678, 34, 'side')).toBe(0);
      expect(resolveBottomClearance(80, 34, 'side')).toBe(0);
      expect(resolveBottomClearance(0, 34, 'side')).toBe(0);
    });
  });
});
