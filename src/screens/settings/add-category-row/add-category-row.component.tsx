import { type FC, useState } from 'react';
import { Pressable } from 'react-native';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import { categoriesRepo } from '../../../repositories/categories.repo';
import HoldingIdentityField from '../../forms/holding-identity-field';
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
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(DEFAULT_ICON);

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
      {/* The shared identity field in its caption-free (dense list) mode, so
          the icon chip and the name field line up at equal height — matching
          the category rows above. A new category always has an icon, so no
          Remove is offered (no onRemoveIcon). */}
      <HoldingIdentityField
        captioned={false}
        icon={icon}
        fallbackIcon={icon}
        iconAccessibilityLabel="Choose new category icon"
        onSelectIcon={setIcon}
        name={name}
        onChangeName={setName}
        namePlaceholder="Category name"
      />

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
    </Box>
  );
};

export default AddCategoryRow;
