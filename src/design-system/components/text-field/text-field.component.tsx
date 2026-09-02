import type { FC } from 'react';
import { TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Box from '../box';
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
}) => {
  const { theme } = useUnistyles();

  return (
    <Box gap={1}>
      <Text variant="caption" tone="textSecondary">
        {label}
      </Text>

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
        style={[styles.input, editable === false && styles.inputDisabled]}
      />
    </Box>
  );
};

export default TextField;
