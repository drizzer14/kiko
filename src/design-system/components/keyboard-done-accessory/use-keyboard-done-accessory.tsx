import { useTranslation } from 'react-i18next';
import { type ReactElement, useId } from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable } from 'react-native';

import Box from '../box';
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
};

// The single source of the native "Done" keyboard accessory shared by every
// Kiko input (the shared TextField and the holding/account/category name
// field). On iOS it renders a real input-accessory TOOLBAR above the keyboard:
// an elevated bar (top hairline separator + `surfaceHigh` fill, styled in
// keyboard-done-accessory.styles) with a trailing `Pressable` Done — accent,
// semibold — that dismisses via `Keyboard.dismiss()`, so the whole app presents
// one identical Done on EVERY input, text and numeric alike. RN's core
// `<Button>` (used before) cannot carry a background/weight, hence the
// `Pressable` + DS `Text`. `useId()` gives each caller its own accessory id so
// a screen with several fields never shares (and iOS never flags a duplicate)
// `nativeID`. Off iOS it returns no id and no element.
export const useKeyboardDoneAccessory = (): KeyboardDoneAccessory => {
  const { t } = useTranslation();
  const accessoryViewID = useId();

  if (Platform.OS !== 'ios') {
    return { inputAccessoryViewID: undefined, accessory: null };
  }

  return {
    inputAccessoryViewID: accessoryViewID,
    accessory: (
      <InputAccessoryView nativeID={accessoryViewID}>
        <Box style={styles.accessoryContainer}>
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
