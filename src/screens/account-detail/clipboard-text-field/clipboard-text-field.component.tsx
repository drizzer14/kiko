import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import Clipboard from '@react-native-clipboard/clipboard';

import { styles } from '../account-detail.styles';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import TextField from '../../../design-system/components/text-field';

import type { ClipboardTextFieldProps } from './clipboard-text-field.props';

// The shared "labeled text field with a trailing paste-icon Button" row: the
// Monobank token field, the crypto wallet address field, and both legs of the
// Binance API key/secret entry all need the identical field + clipboard-read
// affordance, so this is the ONE place that pairs a `TextField` with the
// paste-icon-only ghost `Button` convention (see `kiko-design-system`) rather
// than four near-identical hand-rolled copies. The trailing Button is wrapped
// in a bare `Box` (no props): `Button`'s `size="small"` sets its own
// `alignSelf: 'flex-start'` (button.styles.ts), which — left unwrapped — wins
// over the parent row's `alignItems: 'flex-end'` in Yoga and pins the button to
// the row's TOP (level with the field's caption) instead of bottom-anchoring it
// against the TextField's input box. The wrapper has no `alignSelf` of its own,
// so it inherits `fieldRow`'s `alignItems: 'flex-end'` instead.
const ClipboardTextField: FC<ClipboardTextFieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  pasteAccessibilityLabel,
  secureTextEntry,
}) => {
  const { theme } = useUnistyles();

  const handlePaste = (): void => {
    Clipboard.getString().then((clipboardValue) => {
      onChangeText(clipboardValue.trim());
    });
  };

  return (
    <Box direction="row" gap={3} style={styles.fieldRow}>
      <Box style={styles.tokenFieldColumn}>
        <TextField
          label={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          secureTextEntry={secureTextEntry}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Box>

      <Box>
        <Button
          variant="ghost"
          size="small"
          fullWidth={false}
          icon="document.on.clipboard"
          textColor={theme.colors.textSecondary}
          accessibilityLabel={pasteAccessibilityLabel}
          onPress={handlePaste}
        />
      </Box>
    </Box>
  );
};

export default ClipboardTextField;
