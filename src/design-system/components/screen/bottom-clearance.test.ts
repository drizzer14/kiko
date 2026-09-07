import { resolveBottomClearance } from './bottom-clearance';

describe('resolveBottomClearance', () => {
  it('subtracts the inset the SafeAreaView already reserves', () => {
    expect(resolveBottomClearance(80, 34)).toBe(46);
  });

  it('clamps to zero when the inset alone exceeds the bar', () => {
    expect(resolveBottomClearance(20, 34)).toBe(0);
  });

  it('is the full bar height with no inset', () => {
    expect(resolveBottomClearance(80, 0)).toBe(80);
  });
});
