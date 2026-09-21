import { isSidebarTabBarMode } from './sidebar-mode';

describe('isSidebarTabBarMode', () => {
  it('detects the exact measured Duo primary-panel geometry (implausible tab-bar height AND a nonzero right inset)', () => {
    expect(isSidebarTabBarMode(678, 678, 0, 84)).toBe(true);
  });

  it('is false for an ordinary bottom-tab-bar iPhone', () => {
    expect(isSidebarTabBarMode(80, 844, 0, 0)).toBe(false);
  });

  it('is true from an implausible tab-bar height alone, even with zero insets', () => {
    expect(isSidebarTabBarMode(500, 678, 0, 0)).toBe(true);
  });

  it('is true from a nonzero horizontal inset alone, even with a plausible tab-bar height', () => {
    // A landscape Plus/Max-class iPhone: regular width, so the OS could move
    // the tab bar to a sidebar even where a shorter bar height still gets
    // reported correctly — the inset signal alone must still catch it.
    expect(isSidebarTabBarMode(60, 926, 0, 20)).toBe(true);
  });

  it('does not divide by zero or false-positive on a zero window height', () => {
    expect(isSidebarTabBarMode(0, 0, 0, 0)).toBe(false);
  });

  it('is false right at the implausibility threshold boundary (not strictly greater)', () => {
    expect(isSidebarTabBarMode(339, 678, 0, 0)).toBe(false);
  });
});
