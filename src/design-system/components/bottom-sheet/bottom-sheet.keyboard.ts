// The pure math behind the sheet's keyboard-aware lift, kept free of any
// reanimated shared value so it is unit-tested with plain numbers (the same
// "extract decision/threshold math into pure, synchronously-testable
// functions" convention `bottom-sheet.gesture.ts` follows for the
// drag-to-dismiss threshold). The component wires this into a
// `useAnimatedStyle` alongside the live `useAnimatedKeyboard()` height.

/**
 * The sheet's own vertical lift while a keyboard is showing: the KEYS' own
 * height, not the raw keyboard frame height. On iOS, `keyboardWillChangeFrame`'s
 * `endCoordinates` (what `bottom-sheet.component.tsx` reads into its
 * `keyboardHeight` shared value) covers the WHOLE keyboard, including any
 * attached `InputAccessoryView` — the floating "Done" pill strip
 * (`keyboard-done-accessory.tsx`) that sits directly above the real keys.
 * Lifting the sheet by that full height puts the sheet's own bottom edge at
 * the TOP of the accessory strip, leaving the strip's transparent container
 * between the sheet and the keys — the dark modal scrim behind the sheet (see
 * `bottom-sheet.component.tsx`'s scrim) shows straight through it as a solid
 * black band (device bug, builds 17/18). Subtracting the accessory's own
 * fixed height (`KEYBOARD_ACCESSORY_HEIGHT`,
 * `keyboard-done-accessory.styles.ts`) instead lands the sheet's bottom edge
 * at the BOTTOM of the strip — the real top of the keys — so the accessory
 * now floats directly over the sheet's own glass instead of over the scrim
 * (see `resolveKeyboardAwareBottomPadding` for the matching padding fix that
 * makes the sheet's glass actually reach that far down). Clamped at 0: mid
 * open-animation, `keyboardHeight` ramps up from 0 and is briefly smaller
 * than the fixed accessory height, and the sheet must not lift (let alone
 * overshoot negative) before the keyboard has actually grown past it.
 */
export const resolveKeyboardLift = (keyboardHeight: number, accessoryHeight: number): number => {
  'worklet';

  return Math.max(0, keyboardHeight - accessoryHeight);
};

/**
 * The sheet's own 66% `MAX_HEIGHT_RATIO` cap (see `bottom-sheet.component.tsx`),
 * measured against the CURRENTLY VISIBLE window height — the full window
 * height minus the sheet's own live lift (`resolveKeyboardLift`'s result, the
 * keys' height, not the raw keyboard frame) — instead of the full window
 * height alone. A shrinking search-result list (or any other sheet content)
 * must still fit entirely above the keys that have pushed the sheet's own
 * anchor point up, not just get capped against a window height that no
 * longer reflects what is actually visible above the sheet's new bottom edge.
 *
 * With no keyboard shown (`keyboardLift` 0) this reduces to exactly the
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
  keyboardLift: number,
  ratio: number,
  callerMaxHeight: number | undefined,
): number => {
  'worklet';

  const dynamicRatioCap = (windowHeight - keyboardLift) * ratio;

  return callerMaxHeight === undefined
    ? dynamicRatioCap
    : Math.min(callerMaxHeight, dynamicRatioCap);
};

/**
 * The sheet's own bottom padding while a keyboard is showing: the keyboard
 * accessory's own fixed height (`accessoryHeight`, `KEYBOARD_ACCESSORY_HEIGHT`
 * in `keyboard-done-accessory.styles.ts`) MINUS `basePadding`. `resolveKeyboardLift`
 * lands the sheet's bottom edge at the BOTTOM of the accessory strip (the
 * real top of the keys), so the strip's own height must sit BEHIND the
 * sheet's own last content row, filled with the sheet's glass, or the dark
 * modal scrim shows through the accessory's transparent container as a black
 * band (device bug, builds 17/18).
 *
 * Setting this padding to the FULL `accessoryHeight` (build 19's first pass)
 * still read wrong on device: EVERY sheet's content also carries its own
 * fixed `CONTENT_BOTTOM_PADDING_STEP` buffer beneath its last row
 * (`bottom-sheet.styles.ts`'s `scrollContent`/`box`), which is the exact SAME
 * `SHEET_PADDING_STEP` token as `basePadding` here (see that file's own "one
 * base step" doc) — that buffer STACKS underneath this outer padding, so the
 * content's bottom edge ended up sitting `accessoryHeight + basePadding`
 * above the sheet's edge, not `accessoryHeight`. That left a gap above the
 * Done pill nearly 3x the pill's own gap below it to the keys (user device
 * feedback). Subtracting `basePadding` here cancels that stacked buffer out:
 * the outer padding plus the always-present inner buffer together total
 * exactly `accessoryHeight`, so the content's bottom edge lands exactly at
 * the accessory strip's OWN top edge — which, since the strip's internal
 * layout is itself symmetric (`ACCESSORY_VERTICAL_PADDING_STEP` above and
 * below the pill), makes the visible gap above the pill match the gap below
 * it. Clamped at 0 (never a negative `paddingBottom`) for the degenerate case
 * where a redesigned accessory ever became shorter than the base step.
 *
 * With no keyboard shown (`keyboardHeight` 0) this reduces to exactly the
 * original padding — a no-op for every one of the app's keyboard-less
 * sheets, the same guarantee `resolveKeyboardAwareMaxHeight` makes for the
 * height cap above.
 */
export const resolveKeyboardAwareBottomPadding = (
  basePadding: number,
  bottomInset: number,
  keyboardHeight: number,
  accessoryHeight: number,
): number => {
  'worklet';

  return keyboardHeight > 0
    ? Math.max(0, accessoryHeight - basePadding)
    : basePadding + bottomInset;
};
