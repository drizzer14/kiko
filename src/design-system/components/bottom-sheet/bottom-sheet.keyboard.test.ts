import {
  resolveKeyboardAwareBottomPadding,
  resolveKeyboardAwareMaxHeight,
  resolveKeyboardLift,
} from './bottom-sheet.keyboard';

const WINDOW_HEIGHT = 900;
const RATIO = 0.66;

describe('resolveKeyboardLift', () => {
  it('is zero with no keyboard shown', () => {
    expect(resolveKeyboardLift(0, 60)).toBe(0);
  });

  it('lifts by the keyboard height minus the accessory strip height, not the full keyboard height', () => {
    // `endCoordinates`-derived keyboard height (300) INCLUDES the accessory
    // strip (60) sitting above the real keys — lifting the sheet's bottom
    // edge to the TOP of the keys (not the top of the accessory) means
    // subtracting the accessory's own height from the raw keyboard height.
    expect(resolveKeyboardLift(300, 60)).toBe(240);
  });

  it('clamps at zero rather than going negative when the keyboard has not yet grown past the accessory height', () => {
    // Mid-animation, `keyboardHeight` ramps up from 0 — while it is still
    // smaller than the fixed accessory strip, the sheet must not yet lift at
    // all (never a negative translateY offset).
    expect(resolveKeyboardLift(40, 60)).toBe(0);
  });
});

describe('resolveKeyboardAwareMaxHeight', () => {
  it('is a no-op with no keyboard shown, matching the plain ratio cap', () => {
    expect(resolveKeyboardAwareMaxHeight(WINDOW_HEIGHT, 0, RATIO, undefined)).toBe(
      WINDOW_HEIGHT * RATIO,
    );
  });

  it('is a no-op with no keyboard shown even when a call site tightens maxHeight', () => {
    const tighterCap = WINDOW_HEIGHT * 0.3;
    expect(resolveKeyboardAwareMaxHeight(WINDOW_HEIGHT, 0, RATIO, tighterCap)).toBe(tighterCap);
  });

  it('is a no-op with no keyboard shown even when a call site loosens maxHeight past the ratio cap', () => {
    const looserCap = WINDOW_HEIGHT * 0.9;
    expect(resolveKeyboardAwareMaxHeight(WINDOW_HEIGHT, 0, RATIO, looserCap)).toBe(
      WINDOW_HEIGHT * RATIO,
    );
  });

  it('shrinks the ratio cap to the keyboard-reduced window height while the keyboard is up', () => {
    const keyboardHeight = 300;
    expect(resolveKeyboardAwareMaxHeight(WINDOW_HEIGHT, keyboardHeight, RATIO, undefined)).toBe(
      (WINDOW_HEIGHT - keyboardHeight) * RATIO,
    );
  });

  it('still honors a call-site cap tighter than the keyboard-reduced ratio cap', () => {
    const keyboardHeight = 300;
    const tighterCap = 50;
    expect(resolveKeyboardAwareMaxHeight(WINDOW_HEIGHT, keyboardHeight, RATIO, tighterCap)).toBe(
      tighterCap,
    );
  });

  it('clamps a call-site cap looser than the keyboard-reduced ratio cap down to it', () => {
    const keyboardHeight = 300;
    const looserCap = WINDOW_HEIGHT * 0.9;
    expect(resolveKeyboardAwareMaxHeight(WINDOW_HEIGHT, keyboardHeight, RATIO, looserCap)).toBe(
      (WINDOW_HEIGHT - keyboardHeight) * RATIO,
    );
  });
});

const BASE_PADDING = 16;
const BOTTOM_INSET = 34;
const ACCESSORY_HEIGHT = 60;

describe('resolveKeyboardAwareBottomPadding', () => {
  it('is a no-op with no keyboard shown, keeping the base step plus the safe-area inset', () => {
    expect(resolveKeyboardAwareBottomPadding(BASE_PADDING, BOTTOM_INSET, 0, ACCESSORY_HEIGHT)).toBe(
      BASE_PADDING + BOTTOM_INSET,
    );
  });

  // Build 19's first pass set the padding to the FULL accessory height —
  // still wrong: every sheet's content ALSO carries its own fixed
  // `CONTENT_BOTTOM_PADDING_STEP` buffer beneath the last row (the SAME
  // `SHEET_PADDING_STEP` token as `basePadding` here — see
  // `bottom-sheet.styles.ts`'s own "one base step" doc), which stacks UNDER
  // this outer padding. Subtracting `basePadding` here cancels that stacked
  // buffer out, so the OUTER padding plus the inner content buffer together
  // total exactly `accessoryHeight` — landing the content's bottom edge
  // exactly at the TOP of the accessory strip, which is what makes the gap
  // above the Done pill (content-bottom -> pill-top) match the pill's own
  // fixed gap below it (pill-bottom -> keys), instead of reading nearly 3x
  // larger (user device feedback).
  it('grows the bottom padding to the accessory strip height MINUS the base step, so it cancels the content buffer stacked beneath it', () => {
    expect(
      resolveKeyboardAwareBottomPadding(BASE_PADDING, BOTTOM_INSET, 300, ACCESSORY_HEIGHT),
    ).toBe(ACCESSORY_HEIGHT - BASE_PADDING);
  });

  it('applies the same padding for any nonzero keyboard height, not just a specific threshold', () => {
    expect(resolveKeyboardAwareBottomPadding(BASE_PADDING, BOTTOM_INSET, 1, ACCESSORY_HEIGHT)).toBe(
      ACCESSORY_HEIGHT - BASE_PADDING,
    );
  });

  it('clamps at zero rather than going negative when the accessory height is smaller than the base step', () => {
    const tinyAccessoryHeight = 4;
    expect(
      resolveKeyboardAwareBottomPadding(BASE_PADDING, BOTTOM_INSET, 300, tinyAccessoryHeight),
    ).toBe(0);
  });
});
