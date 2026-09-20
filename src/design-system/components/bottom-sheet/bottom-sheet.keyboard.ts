// The pure math behind the sheet's keyboard-aware lift, kept free of any
// reanimated shared value so it is unit-tested with plain numbers (the same
// "extract decision/threshold math into pure, synchronously-testable
// functions" convention `bottom-sheet.gesture.ts` follows for the
// drag-to-dismiss threshold). The component wires this into a
// `useAnimatedStyle` alongside the live `useAnimatedKeyboard()` height.

/**
 * The sheet's own 66% `MAX_HEIGHT_RATIO` cap (see `bottom-sheet.component.tsx`),
 * measured against the CURRENTLY VISIBLE window height — the full window
 * height minus the live keyboard height — instead of the full window height
 * alone. A shrinking search-result list (or any other sheet content) must
 * still fit entirely above a keyboard that has pushed the visible area up,
 * not just get capped against a window height that no longer reflects what
 * is actually visible.
 *
 * With no keyboard shown (`keyboardHeight` 0) this reduces to exactly the
 * original, keyboard-unaware cap — a no-op for every one of the app's
 * keyboard-less sheets (date-field, filter-menu, confirm-sheet, and every
 * other of the 12+ consumers with no focusable input inside them).
 *
 * `callerMaxHeight` (a call site's own `maxHeight` prop) can still only
 * TIGHTEN the resolved cap further, never loosen it past the (keyboard-aware)
 * ratio ceiling — the same rule the keyboard-less cap already followed.
 */
export const resolveKeyboardAwareMaxHeight = (
  windowHeight: number,
  keyboardHeight: number,
  ratio: number,
  callerMaxHeight: number | undefined,
): number => {
  'worklet';

  const dynamicRatioCap = (windowHeight - keyboardHeight) * ratio;

  return callerMaxHeight === undefined
    ? dynamicRatioCap
    : Math.min(callerMaxHeight, dynamicRatioCap);
};

/**
 * The sheet's own bottom padding while a keyboard is showing: the base
 * padding step ALONE, dropping the bottom safe-area inset. The inset exists
 * so the sheet's last row clears the home indicator, a concern that never
 * applies once the keyboard is up (the keyboard already covers the home
 * indicator itself) — keeping the inset stacked on top of the sheet's own
 * content while the sheet also sits on top of the keyboard measured as a
 * ~34pt redundant slice of the empty band between the sheet's last row and
 * the keyboard's floating Done pill (confirmed on an iOS 27 sim Release
 * build: sheet bottom padding 50pt — the base 16pt step plus this 34pt
 * inset — versus the accessory's own 8pt top gap, so the inset was the
 * dominant contributor). With no keyboard shown (`keyboardHeight` 0) this
 * reduces to exactly the original padding — a no-op for every one of the
 * app's keyboard-less sheets, the same guarantee `resolveKeyboardAwareMaxHeight`
 * makes for the height cap above.
 */
export const resolveKeyboardAwareBottomPadding = (
  basePadding: number,
  bottomInset: number,
  keyboardHeight: number,
): number => {
  'worklet';

  return keyboardHeight > 0 ? basePadding : basePadding + bottomInset;
};
