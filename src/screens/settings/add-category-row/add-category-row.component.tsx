import { type FC, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import { categoriesRepo } from '../../../repositories/categories.repo';
import IconPickerModal from '../icon-picker-modal';
import { styles } from './add-category-row.styles';

// The default icon a new category starts with — a neutral grid glyph from the
// curated picker pool, so the chip renders a valid symbol before the user picks.
const DEFAULT_ICON = 'square.grid.2x2';

// The inline "Add category" row pinned below the category list. Collapsed, it is
// a single tappable row; expanded, it reveals an icon-picker chip, a name field,
// and a Save/Cancel action pair. Save inserts the category and clears the form
// (the new row then appears through the list's existing live query); Cancel
// collapses the form back so the action is never a dead end.
const AddCategoryRow: FC = () => {
  const { theme } = useUnistyles();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [pickerOpen, setPickerOpen] = useState(false);

  const trimmedName = name.trim();
  // Save enables the moment a non-empty (non-whitespace) name is entered.
  const canSave = trimmedName !== '';

  // Reset the form to its pristine state and collapse it — shared by a
  // successful save and an explicit Cancel.
  const collapse = (): void => {
    setName('');
    setIcon(DEFAULT_ICON);
    setExpanded(false);
  };

  const save = async (): Promise<void> => {
    if (!canSave) {
      return;
    }

    await categoriesRepo.create({ title: trimmedName, icon });
    collapse();
  };

  const selectIcon = (nextIcon: string): void => {
    setIcon(nextIcon);
    setPickerOpen(false);
  };

  if (!expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add category"
        onPress={() => setExpanded(true)}
      >
        <Box direction="row" gap={3} style={styles.addRow}>
          <SymbolIcon name="plus" tone="textPrimary" />

          <Text variant="body" tone="textSecondary">
            Add category
          </Text>
        </Box>
      </Pressable>
    );
  }

  return (
    <Box gap={3} style={styles.form}>
      <Box direction="row" gap={3} style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose new category icon"
          accessibilityState={{ expanded: pickerOpen }}
          onPress={() => setPickerOpen(true)}
          style={styles.iconChip}
        >
          <SymbolIcon name={icon} tone="textSecondary" />
        </Pressable>

        {/* A bare, unlabelled input — like the category rows above it — so the
            name field lines up cleanly with the leading icon chip rather than
            being pushed down by a field label. */}
        <TextInput
          accessibilityLabel="Name"
          value={name}
          onChangeText={setName}
          placeholder="Category name"
          placeholderTextColor={theme.colors.textSecondary}
          style={[
            styles.input,
            { color: theme.colors.textPrimary, borderColor: theme.colors.border },
          ]}
        />
      </Box>

      <Box direction="row" gap={3}>
        <Box style={styles.action}>
          <Button variant="secondary" onPress={collapse}>
            Cancel
          </Button>
        </Box>

        <Box style={styles.action}>
          <Button onPress={save} disabled={!canSave}>
            Save
          </Button>
        </Box>
      </Box>

      <IconPickerModal
        visible={pickerOpen}
        selectedIcon={icon}
        onSelect={selectIcon}
        onDismiss={() => setPickerOpen(false)}
      />
    </Box>
  );
};

export default AddCategoryRow;
