import type { FC } from 'react';

import SyncStatusLine from '../sync-status-line';
import { styles } from '../account-detail.styles';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import ClipboardTextField from '../clipboard-text-field';

import type { TokenConnectFieldProps } from './token-connect-field.props';

// The shared "notice + secure token field + explicit Connect button + live
// status line" shape common to `BunqConnectField`, `PrivatbankConnectField`,
// and `StarlingConnectField` — three bank connect surfaces that all ask for
// ONE secure token/API key with the identical Connect/status affordance, so
// this is the ONE place that composes the notice, `ClipboardTextField`, and
// the Connect button + `SyncStatusLine` row, rather than three near-identical
// hand-rolled copies. Each bank field still owns its own state, validation,
// and connect logic (and, unlike this component, is NOT presentational) —
// only the shared render shape moved here.
const TokenConnectField: FC<TokenConnectFieldProps> = ({
  notice,
  label,
  value,
  onChangeText,
  placeholder,
  pasteAccessibilityLabel,
  connectLabel,
  onConnectPress,
  connectDisabled,
  status,
}) => (
  <Box gap={3}>
    <Text variant="body" tone="textSecondary">
      {notice}
    </Text>

    <ClipboardTextField
      label={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      pasteAccessibilityLabel={pasteAccessibilityLabel}
      secureTextEntry
    />

    <Box direction="row" gap={2} style={styles.statusLine}>
      <Button
        variant="secondaryTonal"
        size="small"
        fullWidth={false}
        onPress={onConnectPress}
        disabled={connectDisabled}
        icon="lock"
      >
        {connectLabel}
      </Button>

      <SyncStatusLine status={status} />
    </Box>
  </Box>
);

export default TokenConnectField;
