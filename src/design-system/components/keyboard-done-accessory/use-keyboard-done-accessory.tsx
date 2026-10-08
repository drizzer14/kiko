import { useTranslation } from 'react-i18next';
import { type ReactElement, useId } from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable } from 'react-native';

import Box from '../box';
import Text from '../text';
import GlassSurface from '../glass-surface';

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
  // system keyboard's OWN chrome (key caps, QuickType bar) on the same dark
  // styling `accessory`'s glass pill is designed against, rather than the
  // two drifting independently. Returned from this SAME hook (not a
  // separate constant each caller re-imports) so an input can never render
  // the accessory without also matching its own keyboard's visual style.
  // `undefined` off iOS, mirroring `inputAccessoryViewID` above.
  keyboardAppearance: 'dark' | undefined;
};

// The single source of the native "Done" keyboard accessory shared by every
// Kiko input (the shared TextField and the holding/account/category name
// field). On iOS it renders a real input-accessory view above the keyboard:
// a COMPACT, floating, pill-shaped glass Done button — not a full-width bar
// — right-aligned with a gap above the keyboard, that dismisses via
// `Keyboard.dismiss()`, so the whole app presents one identical Done on EVERY
// input, text and numeric alike. RN's core `<Button>` cannot carry a
// background/weight, hence the `Pressable` + DS `Text` + `GlassSurface`.
// `useId()` gives each caller its own accessory id so a screen with several
// fields never shares (and iOS never flags a duplicate) `nativeID`. The
// returned `keyboardAppearance` (see its own doc comment above) keeps the
// system keyboard on the same dark styling this accessory is designed
// against — pass it straight to the same input's `keyboardAppearance` prop.
// Off iOS it returns no id, no element, and no keyboardAppearance.
//
// The accessory is a compact pill that sizes to fit its own label
// (`styles.doneButton`'s padding, no stretch to full width), floats clear of
// the keyboard with a padding-driven gap (`styles.accessoryContainer`), and
// carries a white (`textPrimary`) label — see
// `keyboard-done-accessory.styles.ts` for the full geometry writeup.
// `GlassSurface`'s `material` variant (the same one `BottomSheet` uses for
// its own card) is the Liquid Glass response to Apple's HIG "Virtual
// keyboards" guidance ("apply Liquid Glass to the view that contains your
// controls" above the keyboard), painted as a small capsule
// (`radius="full"`) with a `bordered` hairline edge for legibility since the
// pill has no opaque/pinned backdrop of its own. Paint order in the JSX
// below matters:
// `doneGlass` renders FIRST (behind, filling the Pressable's own bounds),
// the Done label SECOND (always on top).
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
          <Pressable
            accessibilityRole="button"
            onPress={Keyboard.dismiss}
            style={styles.doneButton}
          >
            <GlassSurface
              material
              bordered
              radius="full"
              style={styles.doneGlass}
              testID="keyboard-done-accessory-glass"
            />

            <Text tone="textPrimary" style={styles.doneLabel}>
              {t('common.done')}
            </Text>
          </Pressable>
        </Box>
      </InputAccessoryView>
    ),
  };
};
