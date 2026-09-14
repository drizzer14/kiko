import type { FC } from 'react';
import { TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Text from '../text';
import FieldLabel from '../field-label';
import { useKeyboardDoneAccessory } from '../keyboard-done-accessory';

import { styles } from './text-field.styles';
import type { TextFieldProps } from './text-field.props';

// iOS numeric keyboards (`decimal-pad` / `number-pad`) render no return key, so
// a `returnKeyType='done'` default is a no-op on them — they rely solely on the
// InputAccessoryView Done below. Every other keyboard has a return key we can
// label. This list only steers the returnKeyType default; the Done accessory
// itself is unconditional (see below).
const RETURN_KEYLESS_KEYBOARD_TYPES = ['decimal-pad', 'number-pad'];

const TextField: FC<TextFieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  returnKeyType,
  editable = true,
  accessibilityLabel = label,
  autoCapitalize,
  autoCorrect,
  multiline,
  secureTextEntry,
  suffix,
  required,
}) => {
  const { theme } = useUnistyles();
  // The native Done keyboard accessory, shared with every other Kiko input.
  // Unconditional on iOS (text and numeric alike); `inputAccessoryViewID` is
  // this field's own id (or `undefined` off iOS). `keyboardAppearance` keeps
  // the SYSTEM keyboard's own chrome matching this same hook's accessory bar
  // fill (see the hook's own doc comment).
  const { inputAccessoryViewID, accessory, keyboardAppearance } = useKeyboardDoneAccessory();
  // An empty string (a currency not yet known) is treated the same as no
  // suffix, so those callers render exactly as a plain field.
  const hasSuffix = suffix !== undefined && suffix !== '';

  // Give inputs that HAVE a return key a `done` return key by default, as a
  // secondary dismiss affordance beside the accessory — but never override a
  // return key the caller chose (e.g. a `search` field), and never set one on a
  // return-keyless numeric keyboard where it would do nothing.
  const resolvedReturnKeyType =
    returnKeyType ??
    (keyboardType !== undefined && RETURN_KEYLESS_KEYBOARD_TYPES.includes(keyboardType)
      ? undefined
      : 'done');

  // The input itself is identical whether or not a suffix renders; only its
  // trailing padding grows (so the caret never slides under the glyph), and it
  // is either returned bare or wrapped with the pinned suffix slot below.
  const input = (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textSecondary}
      keyboardType={keyboardType}
      returnKeyType={resolvedReturnKeyType}
      inputAccessoryViewID={inputAccessoryViewID}
      keyboardAppearance={keyboardAppearance}
      editable={editable}
      accessibilityLabel={accessibilityLabel}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      multiline={multiline}
      secureTextEntry={secureTextEntry}
      style={[
        styles.input,
        editable === false && styles.inputDisabled,
        hasSuffix && styles.inputWithSuffix,
      ]}
    />
  );

  return (
    <>
      <Box gap={1}>
        {label !== undefined && <FieldLabel label={label} required={required} />}

        {hasSuffix ? (
          <Box style={styles.suffixContainer}>
            {input}

            <Box style={styles.suffixSlot}>
              <Text tone="textSecondary">{suffix}</Text>
            </Box>
          </Box>
        ) : (
          input
        )}
      </Box>

      {accessory}
    </>
  );
};

export default TextField;
