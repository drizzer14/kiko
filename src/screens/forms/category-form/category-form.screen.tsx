import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import type { TextInputInstance } from 'react-native';
import { categoriesRepo } from '@kiko/categories/repo';
import { type CategoryRow, useLiveQuery } from '@kiko/db';
import Screen from '@kiko/design-system/components/screen';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import ColorPicker from '@kiko/design-system/components/color-picker';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFormHeaderItems } from '@kiko/screens/forms/use-form-header-items';
import { resolveDefaultCategoryTitle } from '@kiko/i18n/default-category-title';
import { KIKO_CATEGORIES_ICONS } from '@kiko/design-system/components/icon-pools';
import HoldingIdentityField from '@kiko/design-system/components/holding-identity-field';

type CategoryFormScreenProps = NativeStackScreenProps<SettingsStackParamList, 'CategoryForm'>;

// A new category starts on the generic category glyph, the one the Categories footer "Add category"
// button leads with.
const DEFAULT_ICON = genericEntitySymbol.category;

// Stands in for the key of a category that does not exist yet, so the colour picker has a hue to
// ring on open. It only drives the preview: a colour the user did not tap is stored as none.
const NEW_CATEGORY_PREVIEW_KEY = 'new-category';

// Writes what differs from the stored category, each through its own repo write. A seeded default
// is shown under its translated title, so a name equal to it (or to the stored one) is not a
// rename. The colour picker cannot clear a colour, so a null colour means none was picked.
const saveEdits = async (
  category: CategoryRow,
  edits: { name: string; icon: string; color: string | null },
): Promise<void> => {
  const shownTitle = resolveDefaultCategoryTitle(category.key, category.title);

  if (edits.name !== shownTitle && edits.name !== category.title) {
    await categoriesRepo.updateTitle(category.key, edits.name);
  }

  if (edits.icon !== category.icon) {
    await categoriesRepo.updateIcon(category.key, edits.icon);
  }

  if (edits.color !== null && edits.color !== category.color) {
    await categoriesRepo.updateColor(category.key, edits.color);
  }
};

// The category form, for a new category (no `categoryKey`) and for editing one: name, icon and
// colour. Saving a new category opens its page in place of the form; saving an edit goes back.
const CategoryFormScreen: FC<CategoryFormScreenProps> = ({ navigation, route }) => {
  const { categoryKey } = route.params;
  const isEdit = categoryKey !== undefined;
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(DEFAULT_ICON);
  // Null until the user taps a swatch, or the stored colour of the category being edited.
  const [color, setColor] = useState<string | null>(null);
  // The name-required reason stays hidden until a failed Save press, so a fresh form shows no error
  // before the user has tried to save.
  const [attemptedSave, setAttemptedSave] = useState(false);
  // The name field's ref, so the form can focus it imperatively on mount instead of relying on the
  // native `autoFocus` prop (see HoldingIdentityField's `nameInputRef`).
  const nameInputRef = useRef<TextInputInstance | null>(null);
  const hydrated = useRef(false);

  // Uncached: a form seeds its fields from this read, so it must not start from a cached row that
  // may be one read old.
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);
  const editingCategory = categories.find((row) => row.key === categoryKey);

  const trimmedName = name.trim();
  const previewColor = resolveCategoryColor(
    color,
    categoryKey ?? (trimmedName || NEW_CATEGORY_PREVIEW_KEY),
  );

  // The stack sets the static "New Category" title; an edit overrides it.
  useLayoutEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: t('categoryForm.editTitle') });
    }
  }, [isEdit, navigation, t]);

  // Seeded once, so a later live-query emission cannot replace what the user is typing.
  useEffect(() => {
    if (hydrated.current || editingCategory === undefined) {
      return;
    }

    hydrated.current = true;
    setName(resolveDefaultCategoryTitle(editingCategory.key, editingCategory.title));
    setIcon(editingCategory.icon);
    setColor(editingCategory.color);
  }, [editingCategory]);

  // Deferred to the next frame so the keyboard accessory mounted in the same commit has registered
  // before `.focus()` runs: iOS captures `inputAccessoryView` at that moment.
  useEffect(() => {
    if (isEdit) {
      return;
    }

    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });
  }, [isEdit]);

  const save = async (): Promise<void> => {
    if (trimmedName === '') {
      setAttemptedSave(true);

      return;
    }

    try {
      if (isEdit) {
        if (editingCategory !== undefined) {
          await saveEdits(editingCategory, { name: trimmedName, icon, color });
          navigation.goBack();
        }

        return;
      }

      const createdKey = await categoriesRepo.create({ title: trimmedName, icon, color });

      navigation.replace('CategoryDetail', { categoryKey: createdKey });
    } catch {
      // A failed write must not vanish silently: keep the form open and say so.
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
    }
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  useFormHeaderItems({
    navigation,
    onSave,
    hasSave: true,
    // An edit saves values compared with the stored category, so it waits for that read.
    isSaving: isSubmitting || (isEdit && editingCategory === undefined),
  });

  return (
    <Screen scroll>
      <Box gap={4}>
        <HoldingIdentityField
          icons={KIKO_CATEGORIES_ICONS}
          icon={icon}
          fallbackIcon={icon}
          iconColor={previewColor}
          onSelectIcon={setIcon}
          name={name}
          onChangeName={setName}
          namePlaceholder={t('categories.namePlaceholder')}
          nameInputRef={nameInputRef}
          required
          error={
            attemptedSave && trimmedName === '' ? t('forms.fields.nameRequiredError') : undefined
          }
        />

        <ColorPicker label={t('forms.fields.color')} value={previewColor} onSelect={setColor} />
      </Box>
    </Screen>
  );
};

export default CategoryFormScreen;
