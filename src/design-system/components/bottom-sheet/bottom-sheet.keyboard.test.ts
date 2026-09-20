import { resolveKeyboardAwareMaxHeight } from './bottom-sheet.keyboard';

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
