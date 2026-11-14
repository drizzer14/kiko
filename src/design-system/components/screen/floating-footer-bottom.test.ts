import { floatingFooterBottom } from './floating-footer-bottom';

describe('floatingFooterBottom', () => {
  it('is the side bar inset when one is set, whatever the other terms are', () => {
    expect(
      floatingFooterBottom({
        bottomClearance: 49,
        safeAreaBottom: 34,
        sideBarInset: 24,
        footerGap: 16,
      }),
    ).toBe(24);
  });

  it('is the safe area, the gap and the clearance when no side bar inset is set', () => {
    expect(
      floatingFooterBottom({
        bottomClearance: 49,
        safeAreaBottom: 34,
        sideBarInset: undefined,
        footerGap: 16,
      }),
    ).toBe(34 + 16 + 49);
  });
});
