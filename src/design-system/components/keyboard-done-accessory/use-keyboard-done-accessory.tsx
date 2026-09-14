import { useTranslation } from 'react-i18next';
import { type ReactElement, useId } from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable } from 'react-native';

import Box from '../box';
import GlassSurface from '../glass-surface';
import Text from '../text';

import { styles } from './keyboard-done-accessory.styles';

type KeyboardDoneAccessory = {
  // Pass to the input's `inputAccessoryViewID` to link it to this accessory.
  // `undefined` off iOS (`InputAccessoryView` is iOS-only), so the input links
  // to nothing there.
  inputAccessoryViewID: string | undefined;
  // Render this alongside the input (it self-hosts in an `InputAccessoryView`,
  // so its position in the tree does not matter). `null` off iOS.
  accessory: ReactElement | null;
  // Pass to the SAME input's own `keyboardAppearance` prop. Kiko is
  // dark-only (see the `kiko-design-system` skill's "Dark-only theme"
  // section) — there is no light theme to ever match — so this is always
  // the literal `'dark'`, never left to the OS default, which keeps the
  // system keyboard's OWN chrome (key caps, QuickType bar) visually
  // consistent with `accessory`'s `keyboardAccessoryBackground` fill
  // (`theme.ts`) rather than the two drifting independently. Returned from
  // this SAME hook (not a separate constant each caller re-imports) so an
  // input can never render the accessory without also matching its own
  // keyboard's visual style. `undefined` off iOS, mirroring
  // `inputAccessoryViewID` above.
  keyboardAppearance: 'dark' | undefined;
};

// The single source of the native "Done" keyboard accessory shared by every
// Kiko input (the shared TextField and the holding/account/category name
// field). On iOS it renders a real input-accessory TOOLBAR above the keyboard:
// a bar that reads as PART OF the keyboard directly below it, with a
// trailing `Pressable` Done — accent, semibold — that dismisses via
// `Keyboard.dismiss()`, so the whole app presents one identical Done on EVERY
// input, text and numeric alike. RN's core `<Button>` (used before) cannot
// carry a background/weight, hence the `Pressable` + DS `Text`. `useId()`
// gives each caller its own accessory id so a screen with several fields
// never shares (and iOS never flags a duplicate) `nativeID`. The returned
// `keyboardAppearance` (see its own doc comment above) keeps the SYSTEM
// keyboard's chrome matching this bar's fill — pass it straight to the same
// input's `keyboardAppearance` prop. Off iOS it returns no id, no element, and
// no keyboardAppearance.
//
// MATERIAL + GEOMETRY (review, 2026-09-14, addendum): the bar's background is
// now a real Liquid Glass `GlassSurface material` overlay
// (`styles.accessoryGlass`), per Apple's own HIG "Virtual keyboards" guidance
// to apply Liquid Glass to a view containing controls placed above the
// keyboard — see `keyboard-done-accessory.styles.ts`'s `accessoryContainer`
// doc comment for the full citation, the solid-fallback layering that
// guards against a blank first paint in this still-novel `InputAccessoryView`
// native host, and the bottom-corner-radius fix for the gap a flat rectangle
// otherwise leaves against the keyboard's own rounded top corners. Paint
// order in the JSX below matters: `accessoryGlass` renders FIRST (behind, on
// top of the container's own solid `backgroundColor`), the Done `Pressable`
// SECOND (always on top of both).
export const useKeyboardDoneAccessory = (): KeyboardDoneAccessory => {
  const { t } = useTranslation();
  const accessoryViewID = useId();

  if (Platform.OS !== 'ios') {
    return { inputAccessoryViewID: undefined, accessory: null, keyboardAppearance: undefined };
  }

  return {
    inputAccessoryViewID: accessoryViewID,
    keyboardAppearance: 'dark',
    accessory: (
      <InputAccessoryView nativeID={accessoryViewID}>
        <Box testID="keyboard-done-accessory" style={styles.accessoryContainer}>
          <GlassSurface
            material
            radius="lg"
            style={styles.accessoryGlass}
            testID="keyboard-done-accessory-glass"
          />

          <Pressable
            accessibilityRole="button"
            onPress={Keyboard.dismiss}
            style={styles.doneButton}
          >
            <Text tone="accent" style={styles.doneLabel}>
              {t('common.done')}
            </Text>
          </Pressable>
        </Box>
      </InputAccessoryView>
    ),
  };
};
