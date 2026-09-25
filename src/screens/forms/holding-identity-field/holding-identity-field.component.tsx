import type { FC } from 'react';
import { TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../../../design-system/components/box';
import FieldError from '../../../design-system/components/field-error';
import FieldLabel from '../../../design-system/components/field-label';
import IconEditor from '../../../design-system/components/icon-editor';
import { deriveFieldTestID } from '../../../design-system/derive-field-test-id';
import { useKeyboardDoneAccessory } from '../../../design-system/components/keyboard-done-accessory';

import { styles } from './holding-identity-field.styles';
import type { HoldingIdentityFieldProps } from './holding-identity-field.props';

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
  nameInputRef,
  captioned = true,
  required,
  error,
  testID,
}) => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const nameLabel = t('forms.fields.name');
  // A defined, non-empty `error` IS the invalid signal — same contract as
  // TextField's own `hasError` (see text-field.component.tsx).
  const hasError = error !== undefined && error !== '';
  // The same native Done keyboard accessory every other Kiko input carries, so
  // this name field dismisses the keyboard identically. `keyboardAppearance`
  // keeps the system keyboard's own chrome matching the accessory bar's fill
  // (see the hook's own doc comment).
  const { inputAccessoryViewID, accessory, keyboardAppearance } = useKeyboardDoneAccessory();

  return (
    <Box gap={1} testID={testID}>
      {/* The error renders BELOW this whole row (icon + name), never inside
        the name column beside it — Option A's composite-row rule:
        reserving/reflowing height INSIDE the name column would grow that
        column alone, and since
        `container`'s `alignItems: 'flex-end'` bottom-aligns the icon chip
        against the name column's own bottom edge, the icon would shift
        every time the message mounts/unmounts. Keeping the error OUTSIDE
        the row entirely means the row's own height — and the icon's
        position within it — never changes. */}
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
          {captioned && <FieldLabel label={nameLabel} required={required} invalid={hasError} />}

          <TextInput
            ref={nameInputRef}
            accessibilityLabel={nameAccessibilityLabel ?? nameLabel}
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
      </Box>

      {/* REFLOW, not reserve (Option A): no error node while valid, so a bare
        (uncaptioned) row and a valid captioned row both take no extra space.
        Only rendered when captioned — a dense list row never validates. The
        `nameFieldError` offset shifts the message right by the icon chip's
        width + gap, so it aligns under the
        name input rather than flush-left under the icon. */}
      {captioned && hasError && (
        <Box style={styles.nameFieldError}>
          <FieldError message={error} testID={deriveFieldTestID(testID, 'error')} />
        </Box>
      )}

      {accessory}
    </Box>
  );
};

export default HoldingIdentityField;
