import type { FC } from 'react';
import { TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import IconEditor from '../../icon-editor';

import type { HoldingIdentityFieldProps } from './holding-identity-field.props';
import { styles } from './holding-identity-field.styles';

// An icon chip beside a labelled name field — the shared identity control used
// by the holding create form and detail header, the account create form, and
// the category rows so every one of them presents one identical block instead
// of hand-wrapping an icon chip next to a text input (and inheriting the same
// chip-taller-than-input height bug). Presentational: the caller owns the state
// and the persist wiring (continuous on the create forms, commit-on-blur on the
// detail/category rename). `captioned` (default true) renders the "Icon"/"Name"
// field labels for the form treatment; a dense list row passes `false` for a
// bare, vertically-centered pair.
const HoldingIdentityField: FC<HoldingIdentityFieldProps> = ({
  icon,
  fallbackIcon,
  name,
  onChangeName,
  onSelectIcon,
  onRemoveIcon,
  nameAccessibilityLabel = 'Name',
  iconAccessibilityLabel,
  iconColor,
  onEndEditingName,
  namePlaceholder,
  autoFocus = false,
  captioned = true,
}) => {
  const { theme } = useUnistyles();

  return (
    <Box direction="row" gap={3} style={captioned ? styles.container : styles.containerBare}>
      <IconEditor
        label={captioned ? 'Icon' : undefined}
        iconAccessibilityLabel={iconAccessibilityLabel}
        icon={icon}
        fallbackIcon={fallbackIcon}
        iconColor={iconColor}
        onSelect={onSelectIcon}
        onRemove={onRemoveIcon}
      />

      <Box gap={1} style={styles.nameBlock}>
        {captioned && (
          <Text variant="caption" tone="textSecondary">
            Name
          </Text>
        )}

        <TextInput
          accessibilityLabel={nameAccessibilityLabel}
          autoFocus={autoFocus}
          value={name}
          onChangeText={onChangeName}
          onEndEditing={onEndEditingName}
          placeholder={namePlaceholder}
          placeholderTextColor={theme.colors.textSecondary}
          style={styles.nameField}
        />
      </Box>
    </Box>
  );
};

export default HoldingIdentityField;
