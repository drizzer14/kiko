import type { FC } from 'react';
import { TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Text from '../text';
import SymbolIcon from '../symbol';
import FieldError from '../field-error';
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

// Give inputs that HAVE a return key a `done` return key by default, as a
// secondary dismiss affordance beside the accessory — but never override a
// return key the caller chose (e.g. a `search` field), and never set one on a
// return-keyless numeric keyboard where it would do nothing. Pulled out of the
// component body (rather than an inline `??`/ternary there) to keep
// TextField's own cognitive complexity under the project's Biome threshold.
const resolveReturnKeyType = (
  returnKeyType: TextFieldProps['returnKeyType'],
  keyboardType: TextFieldProps['keyboardType'],
): TextFieldProps['returnKeyType'] => {
  if (returnKeyType !== undefined) {
    return returnKeyType;
  }

  if (keyboardType !== undefined && RETURN_KEYLESS_KEYBOARD_TYPES.includes(keyboardType)) {
    return undefined;
  }

  return 'done';
};

// Derives a nested testID from the field's own outer `testID`, or `undefined`
// when the caller passed none — shared by the error slot and its inline
// message so both stay `undefined`-safe without repeating the ternary inline
// (which would add to TextField's own cognitive complexity).
const deriveTestID = (testID: TextFieldProps['testID'], suffix: string): string | undefined =>
  testID !== undefined ? `${testID}-${suffix}` : undefined;

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
  leadingIcon,
  required,
  onBlur,
  error,
  testID,
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
  // Same empty-safe treatment for the leading icon slot: an unset or empty
  // `leadingIcon` renders exactly as a plain field with no leading glyph.
  const hasLeadingIcon = leadingIcon !== undefined && leadingIcon !== '';
  // Either inset wraps the input in a positioned container (below); a bare
  // field with neither is returned unwrapped, unchanged.
  const hasInset = hasSuffix || hasLeadingIcon;
  // A defined, non-empty `error` IS the invalid signal — there is no separate
  // `invalid` boolean (see text-field.props.d.ts).
  const hasError = error !== undefined && error !== '';

  const resolvedReturnKeyType = resolveReturnKeyType(returnKeyType, keyboardType);

  // The input itself is identical whether or not a suffix renders; only its
  // trailing padding grows (so the caret never slides under the glyph), and it
  // is either returned bare or wrapped with the pinned suffix slot below.
  const input = (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
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
        multiline === true && styles.inputMultiline,
        editable === false && styles.inputDisabled,
        hasSuffix && styles.inputWithSuffix,
        hasLeadingIcon && styles.inputWithLeadingIcon,
        hasError && styles.inputError,
      ]}
    />
  );

  return (
    <>
      <Box gap={1} testID={testID}>
        {label !== undefined && <FieldLabel label={label} required={required} />}

        {hasInset ? (
          <Box style={styles.insetContainer}>
            {leadingIcon !== undefined && leadingIcon !== '' && (
              // Pinned to the leading edge and vertically centered; the reserved
              // `inputWithLeadingIcon` padding keeps the caret clear of it. The
              // slot's `pointerEvents: 'none'` lets a tap in the leading area
              // fall through to focus the input rather than being swallowed.
              <Box style={styles.leadingSlot}>
                <SymbolIcon name={leadingIcon} size={theme.iconSizes.body} />
              </Box>
            )}

            {input}

            {hasSuffix && (
              <Box style={styles.suffixSlot}>
                <Text tone="textSecondary">{suffix}</Text>
              </Box>
            )}
          </Box>
        ) : (
          input
        )}

        {/* Always rendered, whether or not an error is showing, so the
          field's overall height never shifts between valid and invalid. */}
        <Box style={styles.errorSlot} testID={deriveTestID(testID, 'error-slot')}>
          {hasError && <FieldError message={error} testID={deriveTestID(testID, 'error')} />}
        </Box>
      </Box>

      {accessory}
    </>
  );
};

export default TextField;
