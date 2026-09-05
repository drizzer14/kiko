import { type FC, useState } from 'react';
import { Pressable } from 'react-native';

import Box from '../../design-system/components/box';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import IconPickerModal from '../settings/icon-picker-modal';

import type { IconEditorProps } from './icon-editor.props';
import { styles } from './icon-editor.styles';

// The leading icon affordance shared by the account/holding create forms and
// their edit (detail) screens: an optional field caption (`label`) above a
// bordered, tappable chip that renders the row's stored SF Symbol (or a
// kind/type-derived fallback when unset) and opens the shared IconPickerModal.
// Rendering the caption here means the create forms and the edit screens reuse
// one identical labelled block instead of each wrapping the chip in their own
// caption. Selecting a swatch persists it through `onSelect`; the picker also
// offers a Remove control (via the modal's `onRemove`) whenever a custom icon is
// currently set, which clears it back to the fallback.
const IconEditor: FC<IconEditorProps> = ({
  icon,
  fallbackIcon,
  iconColor,
  label,
  iconAccessibilityLabel,
  onSelect,
  onRemove,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const displayIcon = icon ?? fallbackIcon;
  const toggleLabel =
    iconAccessibilityLabel ?? (label !== undefined ? `Change ${label}` : 'Change icon');
  // Remove is offered only when a custom icon is set AND the caller opted into
  // it by supplying a handler — a mandatory-icon row (a category) omits it.
  const removable = icon != null && onRemove !== undefined;

  const handleSelect = (next: string): void => {
    setPickerOpen(false);
    onSelect(next);
  };

  const handleRemove = (): void => {
    setPickerOpen(false);
    onRemove?.();
  };

  return (
    <Box gap={1}>
      {label !== undefined && (
        <Text variant="caption" tone="textSecondary">
          {label}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={toggleLabel}
        accessibilityState={{ expanded: pickerOpen }}
        onPress={() => setPickerOpen(true)}
        style={styles.iconChip}
      >
        <SymbolIcon
          name={displayIcon}
          tone="textSecondary"
          color={iconColor}
          accessibilityLabel={`Icon ${displayIcon}`}
        />
      </Pressable>

      <IconPickerModal
        visible={pickerOpen}
        selectedIcon={displayIcon}
        onSelect={handleSelect}
        onRemove={removable ? handleRemove : undefined}
        onDismiss={() => setPickerOpen(false)}
      />
    </Box>
  );
};

export default IconEditor;
