import {
  resolveKeyboardAwareBottomPadding,
  resolveKeyboardAwareMaxHeight,
} from './bottom-sheet.keyboard';

const WINDOW_HEIGHT = 900;
const RATIO = 0.66;

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

describe('resolveKeyboardAwareBottomPadding', () => {
  it('is a no-op with no keyboard shown, keeping the base step plus the safe-area inset', () => {
    expect(resolveKeyboardAwareBottomPadding(BASE_PADDING, BOTTOM_INSET, 0)).toBe(
      BASE_PADDING + BOTTOM_INSET,
    );
  });

  it('drops the redundant safe-area inset once the keyboard is shown', () => {
    expect(resolveKeyboardAwareBottomPadding(BASE_PADDING, BOTTOM_INSET, 300)).toBe(BASE_PADDING);
  });

  it('drops the inset for any nonzero keyboard height, not just a specific threshold', () => {
    expect(resolveKeyboardAwareBottomPadding(BASE_PADDING, BOTTOM_INSET, 1)).toBe(BASE_PADDING);
  });
});
