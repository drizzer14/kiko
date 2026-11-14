type FooterLine = {
  bottomClearance: number;
  safeAreaBottom: number;
  sideBarInset: number | undefined;
  footerGap: number;
};

/**
 * How far above the window's bottom a floating footer's lowest button edge sits: the side bar
 * platter's inset when there is one, else the safe-area inset the screen reserves, the gap and the
 * tab-bar clearance. The one place the footer line is computed, so a control that sits level with
 * the footer's buttons reads it here.
 */
export const floatingFooterBottom = ({
  bottomClearance,
  safeAreaBottom,
  sideBarInset,
  footerGap,
}: FooterLine): number => sideBarInset ?? safeAreaBottom + footerGap + bottomClearance;
