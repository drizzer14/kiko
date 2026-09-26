import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';
import type { TextInputInstance } from 'react-native';
import { categoriesRepo } from '@kiko/categories/repo';
import { type FC, useEffect, useRef, useState } from 'react';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';

import Box from '../../../../design-system/components/box';
import Card from '../../../../design-system/components/card';
import Button from '../../../../design-system/components/button';
import { alertOnCatch } from '../../../../design-system/alert-on-catch';
import FieldError from '../../../../design-system/components/field-error';
import ColorPicker from '../../../../design-system/components/color-picker';
import { useSubmitOnce } from '../../../../design-system/use-submit-once/use-submit-once';
import HoldingIdentityField from '../../../../design-system/components/holding-identity-field';
import { KIKO_CATEGORIES_ICONS } from '../../../../design-system/components/icon-picker-modal/icon-pools';

import { styles } from './add-category-row.styles';

// The default icon a new category starts with — a neutral grid glyph from the
// curated picker pool, so the chip renders a valid symbol before the user picks.
const DEFAULT_ICON = 'tag';

type AddCategoryRowProps = {
  // Runs once the form has saved or been cancelled, so the Categories screen
  // (which owns whether this form is mounted at all — review decision 19)
  // collapses back to its footer "Add category" action.
  onCollapse: () => void;
};

// The "Add category" form. The Categories screen mounts this only while its
// footer action is active, so this component owns no collapsed affordance of
// its own — an icon-picker chip, a name field, and a Save/Cancel action pair,
// always revealed. Save inserts the category and hands back to the screen
// (the new row then appears through the list's existing live query); Cancel
// hands back with nothing persisted.
const AddCategoryRow: FC<AddCategoryRowProps> = ({ onCollapse }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(DEFAULT_ICON);
  // Null until the user taps a swatch — an honest "no color picked yet" that
  // persists as null so the row falls back to the stable per-key palette hash,
  // mirroring accounts/holdings' nullable color.
  const [color, setColor] = useState<string | null>(null);
  // Mirrors account-form's attempted-flag pattern: the name-required reason
  // stays hidden until a failed Save press, so a fresh form shows no error
  // before the user has tried to save — Save is always enabled, never a
  // standing `disabled={!canSave}` gate with no visible reason at all.
  const [attemptedSave, setAttemptedSave] = useState(false);
  // The name field's ref, so the form can focus it imperatively on mount
  // instead of relying on the native `autoFocus` prop — see
  // HoldingIdentityField's `nameInputRef` doc comment for why.
  const nameInputRef = useRef<TextInputInstance | null>(null);

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

  const submit = async (): Promise<void> => {
    // Block submit on an empty (or whitespace-only) name; Save is always
    // enabled now, so this surfaces the name-required reason on press rather
    // than a standing disabled state.
    if (!canSave) {
      setAttemptedSave(true);

      return;
    }

    try {
      await categoriesRepo.create({ title: trimmedName, icon, color });
      onCollapse();
    } catch {
      // A DB write failure (disk full, locked) must not vanish silently — the
      // form was about to hand back with nothing saved. Keep it open and say
      // so, mirroring every other form's established Alert pattern.
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
    }
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(submit);

  // Focus the name field the moment the form mounts. Deferred to the next
  // frame so the sibling keyboard InputAccessoryView (mounted in the same
  // commit as this field) has registered before `.focus()` fires
  // `becomeFirstResponder` — iOS captures `inputAccessoryView` at that exact
  // moment, so a same-commit native `autoFocus` would race it and open the
  // keyboard with no Done accessory.
  useEffect(() => {
    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });
  }, []);

  return (
    <Card testID="add-category-card" padding={4}>
      <Box gap={3}>
        {/* The shared identity field in its caption-free (dense list) mode, so
            the icon chip and the name field line up at equal height — matching
            the category rows above. A new category always has an icon, so no
            Remove is offered (no onRemoveIcon). */}
        <HoldingIdentityField
          icons={KIKO_CATEGORIES_ICONS}
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
          nameInputRef={nameInputRef}
        />

        {/* Dense (captionless) mode never renders HoldingIdentityField's own
            error slot (see its doc comment), so this form renders the shared
            FieldError directly below the row instead — the same REFLOW,
            not-reserve contract every other field uses. */}
        {attemptedSave && !canSave && <FieldError message={t('forms.fields.nameRequiredError')} />}

        {/* value is the resolved DISPLAY color (previewColor), so a swatch is
            ringed from open — a stable decorative default, mirroring the accounts
            form's kind-default ring, not the saved row's eventual hue (that
            hashes a random UUID key). `color` (what persists) stays null until a
            swatch is tapped; onSelect writes the picked hex into it. The prefix
            scopes the swatch a11y labels so they never collide with the per-row
            pickers already on screen. */}
        <ColorPicker
          label={t('categories.colorLabel')}
          value={previewColor}
          onSelect={setColor}
          accessibilityLabelPrefix={t('categories.newColorPrefix')}
        />

        <Box direction="row" gap={3}>
          <Box style={styles.action}>
            {/* The shared red ghost Cancel treatment, the confirm-sheet.component.tsx
                shape — see kiko-design-system's "Component set (Button)". */}
            <Button variant="ghost" textColor={theme.colors.negative} onPress={onCollapse}>
              {t('common.cancel')}
            </Button>
          </Box>

          <Box style={styles.action}>
            <Button onPress={onSave} disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </Box>
        </Box>
      </Box>
    </Card>
  );
};

export default AddCategoryRow;
