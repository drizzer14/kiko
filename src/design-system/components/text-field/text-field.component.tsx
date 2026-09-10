import type { FC } from 'react';
import { TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import FieldLabel from '../field-label';
import Text from '../text';

import type { TextFieldProps } from './text-field.props';
import { styles } from './text-field.styles';

const TextField: FC<TextFieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
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
  // An empty string (a currency not yet known) is treated the same as no
  // suffix, so those callers render exactly as a plain field.
  const hasSuffix = suffix !== undefined && suffix !== '';

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
    <Box gap={1}>
      <FieldLabel label={label} required={required} />

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
  );
};

export default TextField;
