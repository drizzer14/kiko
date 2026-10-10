import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import Clipboard from '@react-native-clipboard/clipboard';

import Box from '../box';
import Button from '../button';
import TextField from '../text-field';
import FieldError from '../field-error';
import FieldLabel from '../field-label';

import { styles } from './clipboard-text-field.styles';
import type { ClipboardTextFieldProps } from './clipboard-text-field.props';

// The shared "labeled text field with a trailing paste-icon Button" row: the
// Monobank token field, the crypto wallet address field, and both legs of the
// Binance API key/secret entry all need the identical field + clipboard-read
// affordance, so this is the ONE place that pairs a `TextField` with the
// paste-icon-only ghost `Button` convention (see `kiko-design-system`) rather
// than four near-identical hand-rolled copies.
//
// The caption renders through `FieldLabel` ABOVE the row and the validation
// message through `FieldError` BELOW it, all in this component's OWN
// `Box gap={1}` (the same 4pt gap `TextField` applies between its own label,
// input and error), and `TextField` itself renders with NO `label` and NO
// `error` prop. If `TextField` owned the caption or the error line, it would be
// part of the row's cross-axis box, so any `alignItems`/`alignSelf` on the row
// would center or bottom-anchor the button against (label + gap + input +
// error) together, not the 44pt input box alone — landing the icon visibly off
// the input's true center (and, on an error, dropping it below the input).
// Splitting both out removes that ambiguity structurally instead of nudging a
// numeric offset (a magic-number fragility). The row between them is
// just [`TextField` (`flex: 1`), the paste button's wrapper `Box`],
// `alignItems: 'center'` (`styles.inputRow`) — both children are
// fixed-height boxes with nothing else inside either, so Yoga centers the
// button's own box exactly on the input's box, with no coordinate to get
// wrong. The wrapper `Box` (`styles.pasteButtonWrapper`) is still required:
// without it, `Button`'s own `size="small"` sets `alignSelf: 'flex-start'`
// (button.styles.ts), which would win over the row's `alignItems: 'center'`
// in Yoga and pin the button to the row's cross-axis start instead.
//
// `TextField`'s own `accessibilityLabel` prop defaults to its `label` prop
// (text-field.component.tsx) — since this field is not given a `label` at
// all, that default would resolve to `undefined` if left unset, silently
// dropping the accessible name VoiceOver reads for the input.
// `accessibilityLabel={label}` below is therefore required, not optional,
// because the caption lives outside `TextField`.
const ClipboardTextField: FC<ClipboardTextFieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  pasteAccessibilityLabel,
  secureTextEntry,
  error,
}) => {
  const { theme } = useUnistyles();
  const hasError = error !== undefined && error !== '';

  const handlePaste = (): void => {
    // A failed clipboard read leaves the field unchanged, which is the right outcome.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(no recovery)
    Clipboard.getString().then((clipboardValue) => {
      onChangeText(clipboardValue.trim());
    });
  };

  return (
    <Box gap={1}>
      <FieldLabel label={label} invalid={hasError} />

      <Box direction="row" gap={1} style={styles.inputRow}>
        <Box style={styles.tokenFieldColumn}>
          <TextField
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            secureTextEntry={secureTextEntry}
            accessibilityLabel={label}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Box>

        <Box style={styles.pasteButtonWrapper}>
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

      {hasError && <FieldError message={error} />}
    </Box>
  );
};

export default ClipboardTextField;
