import { type FC, useState } from 'react';
import { Pressable } from 'react-native';

import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import GlassSurface from '../../../design-system/components/glass-surface';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import { categoriesRepo } from '../../../repositories/categories.repo';
import ColorPicker from '../../forms/color-picker';
import HoldingIdentityField from '../../forms/holding-identity-field';

import { styles } from './add-category-row.styles';

// The default icon a new category starts with — a neutral grid glyph from the
// curated picker pool, so the chip renders a valid symbol before the user picks.
const DEFAULT_ICON = 'square.grid.2x2';

type AddCategoryRowProps = {
  // Fired the moment the collapsed row expands its form. The Categories screen
  // uses it to scroll its ScrollView to the newly revealed fields (the form is
  // appended below the last category), so the auto-focused name field lands in
  // view rather than under the fold.
  onExpand?: () => void;
};

// The inline "Add category" row pinned below the category list. Collapsed, it is
// a single tappable row; expanded, it reveals an icon-picker chip, a name field,
// and a Save/Cancel action pair. Save inserts the category and clears the form
// (the new row then appears through the list's existing live query); Cancel
// collapses the form back so the action is never a dead end.
const AddCategoryRow: FC<AddCategoryRowProps> = ({ onExpand }) => {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(DEFAULT_ICON);
  // Null until the user taps a swatch — an honest "no color picked yet" that
  // persists as null so the row falls back to the stable per-key palette hash,
  // mirroring accounts/holdings' nullable color.
  const [color, setColor] = useState<string | null>(null);

  const trimmedName = name.trim();
  // Save enables the moment a non-empty (non-whitespace) name is entered.
  const canSave = trimmedName !== '';

  // Reset the form to its pristine state and collapse it — shared by a
  // successful save and an explicit Cancel.
  const collapse = (): void => {
    setName('');
    setIcon(DEFAULT_ICON);
    setColor(null);
    setExpanded(false);
  };

  const save = async (): Promise<void> => {
    if (!canSave) {
      return;
    }

    await categoriesRepo.create({ title: trimmedName, icon, color });
    collapse();
  };

  if (!expanded) {
    return (
      // The collapsed affordance is its own card too — the same GlassSurface
      // treatment as every category card above it — so it reads as the final
      // item in the stack rather than a leftover list row. No gradient: it has
      // no entity color of its own yet.
      <GlassSurface testID="add-category-card" padding={4} bordered>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add category"
          onPress={() => {
            setExpanded(true);
            onExpand?.();
          }}
        >
          <Box direction="row" gap={3} style={styles.addRow}>
            <SymbolIcon name="plus" tone="textPrimary" />

            <Text variant="body" tone="textSecondary">
              Add category
            </Text>
          </Box>
        </Pressable>
      </GlassSurface>
    );
  }

  return (
    <GlassSurface testID="add-category-card" padding={4} bordered>
      <Box gap={3}>
        {/* The shared identity field in its caption-free (dense list) mode, so
            the icon chip and the name field line up at equal height — matching
            the category rows above. A new category always has an icon, so no
            Remove is offered (no onRemoveIcon). */}
        <HoldingIdentityField
          captioned={false}
          icon={icon}
          fallbackIcon={icon}
          // Live preview: once a swatch is picked the icon tints to it (undefined
          // while unset keeps the field's default), mirroring the account form.
          iconColor={color ?? undefined}
          iconAccessibilityLabel="Choose new category icon"
          onSelectIcon={setIcon}
          name={name}
          onChangeName={setName}
          namePlaceholder="Category name"
          // The field mounts only once the form expands, so focusing it on mount
          // fires exactly when the row opens — the keyboard lands straight on the
          // name input without a second tap.
          autoFocus
        />

        {/* value='' until a swatch is tapped, so no swatch is ringed — the honest
            "not picked yet" state, matching the row editor and the icon chip. The
            prefix scopes the swatch a11y labels so they never collide with the
            per-row pickers above (e.g. "New category color yellow"). */}
        <ColorPicker
          label="Color"
          value={color ?? ''}
          onSelect={setColor}
          accessibilityLabelPrefix="New category color"
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
    </GlassSurface>
  );
};

export default AddCategoryRow;
