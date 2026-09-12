import { categoriesRepo } from '@kiko/categories/repo';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import GlassSurface from '../../../design-system/components/glass-surface';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import { resolveCategoryColor } from '../../../statistics/category-breakdown';
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
  const { t } = useTranslation();
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

  // The DISPLAY color the form rings/previews — never what persists. `color`
  // stays null until a swatch is tapped (and null is what `create` receives).
  // This is a STABLE DECORATIVE default so a swatch reads as selected from open,
  // matching the accounts form's always-ringed kind default — NOT a prediction
  // of the saved category's hue. `create` stores `key: id()` (a random UUID, see
  // categories.repo.ts / db/id.ts), so the eventual per-key palette fallback
  // hashes that UUID, unrelated to this name-derived preview. Running it off the
  // in-progress name (stable placeholder while empty) only keeps the ring lively
  // as the user types. The picked-color path is faithful: onSelect stores the
  // tapped entityColors hex, which resolveCategoryColor then rings verbatim.
  const previewColor = resolveCategoryColor(color, trimmedName || 'new-category');

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
      <GlassSurface testID="add-category-card" padding={4} bordered bloom>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('categories.addCategory')}
          onPress={() => {
            setExpanded(true);
            onExpand?.();
          }}
        >
          <Box direction="row" gap={3} style={styles.addRow}>
            <SymbolIcon name="plus" tone="textPrimary" />

            <Text variant="body" tone="textPrimary">
              {t('categories.addCategory')}
            </Text>
          </Box>
        </Pressable>
      </GlassSurface>
    );
  }

  return (
    <GlassSurface testID="add-category-card" padding={4} bordered bloom>
      <Box gap={3}>
        {/* The shared identity field in its caption-free (dense list) mode, so
            the icon chip and the name field line up at equal height — matching
            the category rows above. A new category always has an icon, so no
            Remove is offered (no onRemoveIcon). */}
        <HoldingIdentityField
          captioned={false}
          icon={icon}
          fallbackIcon={icon}
          // Live preview: the icon tints to the same resolved color the picker
          // rings — the decorative default until a swatch is picked, then the
          // picked hex — so the chip and the ringed swatch always match.
          iconColor={previewColor}
          iconAccessibilityLabel={t('categories.chooseNewIconLabel')}
          onSelectIcon={setIcon}
          name={name}
          onChangeName={setName}
          namePlaceholder={t('categories.namePlaceholder')}
          // The field mounts only once the form expands, so focusing it on mount
          // fires exactly when the row opens — the keyboard lands straight on the
          // name input without a second tap.
          autoFocus
        />

        {/* value is the resolved DISPLAY color (previewColor), so a swatch is
            ringed from open — a stable decorative default, mirroring the accounts
            form's kind-default ring, not the saved row's eventual hue (that
            hashes a random UUID key). `color` (what persists) stays null until a
            swatch is tapped; onSelect writes the picked hex into it. The prefix
            scopes the swatch a11y labels so they never collide with the per-row
            pickers above (e.g. "New category color yellow"). */}
        <ColorPicker
          label={t('categories.colorLabel')}
          value={previewColor}
          onSelect={setColor}
          accessibilityLabelPrefix={t('categories.newColorPrefix')}
        />

        <Box direction="row" gap={3}>
          <Box style={styles.action}>
            <Button variant="secondary" onPress={collapse}>
              {t('common.cancel')}
            </Button>
          </Box>

          <Box style={styles.action}>
            <Button onPress={save} disabled={!canSave}>
              {t('common.save')}
            </Button>
          </Box>
        </Box>
      </Box>
    </GlassSurface>
  );
};

export default AddCategoryRow;
