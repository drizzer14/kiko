// The font scale from which a row of text beside a control stacks. React Native's own table
// (`RCTUtils.mm`) maps the largest regular text size, xxxLarge, to 1.353, which stays a row, and
// the first accessibility size, AX1, to 1.786, which stacks. 28 / 17 (about 1.647) lies between
// them, so each side is clear of the threshold by a margin that a rounding of the scale cannot
// cross.
export const STACK_FONT_SCALE = 28 / 17;
