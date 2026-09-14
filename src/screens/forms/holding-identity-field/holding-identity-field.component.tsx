import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../../../design-system/components/box';
import FieldLabel from '../../../design-system/components/field-label';
import IconEditor from '../../../design-system/components/icon-editor';
import { useKeyboardDoneAccessory } from '../../../design-system/components/keyboard-done-accessory';

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
  icons,
  icon,
  fallbackIcon,
  name,
  onChangeName,
  onSelectIcon,
  onRemoveIcon,
  nameAccessibilityLabel,
  iconAccessibilityLabel,
  iconColor,
  onEndEditingName,
  onFocus,
  namePlaceholder,
  autoFocus = false,
  captioned = true,
  required,
}) => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const nameLabel = t('forms.fields.name');
  // The same native Done keyboard accessory every other Kiko input carries, so
  // this name field dismisses the keyboard identically. `keyboardAppearance`
  // keeps the system keyboard's own chrome matching the accessory bar's fill
  // (see the hook's own doc comment).
  const { inputAccessoryViewID, accessory, keyboardAppearance } = useKeyboardDoneAccessory();

  return (
    <Box direction="row" gap={3} style={captioned ? styles.container : styles.containerBare}>
      <IconEditor
        icons={icons}
        label={captioned ? t('forms.fields.icon') : undefined}
        iconAccessibilityLabel={iconAccessibilityLabel}
        icon={icon}
        fallbackIcon={fallbackIcon}
        iconColor={iconColor}
        onSelect={onSelectIcon}
        onRemove={onRemoveIcon}
      />

      <Box gap={1} style={styles.nameBlock}>
        {captioned && <FieldLabel label={nameLabel} required={required} />}

        <TextInput
          accessibilityLabel={nameAccessibilityLabel ?? nameLabel}
          autoFocus={autoFocus}
          value={name}
          onChangeText={onChangeName}
          onEndEditing={onEndEditingName}
          onFocus={onFocus}
          placeholder={namePlaceholder}
          placeholderTextColor={theme.colors.textSecondary}
          returnKeyType="done"
          inputAccessoryViewID={inputAccessoryViewID}
          keyboardAppearance={keyboardAppearance}
          style={styles.nameField}
        />
      </Box>

      {accessory}
    </Box>
  );
};

export default HoldingIdentityField;
