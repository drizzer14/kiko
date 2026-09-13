import { type ReactElement, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InputAccessoryView, Keyboard, Platform } from 'react-native';

import Box from '../box';

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
// field). On iOS it shows a plain react-native core `<Button>` — the default
// system look, no custom styling — above the keyboard that dismisses it via
// `Keyboard.dismiss()`, so the whole app presents one identical Done on EVERY
// input, text and numeric alike. `useId()` gives each caller its own accessory
// id so a screen with several fields never shares (and iOS never flags a
// duplicate) `nativeID`. Off iOS it returns no id and no element.
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
          <Button title={t('common.done')} onPress={Keyboard.dismiss} />
        </Box>
      </InputAccessoryView>
    ),
  };
};
