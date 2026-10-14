import type {
  NativeStackHeaderItemButton,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type { TFunction } from 'i18next';
import {
  DEFAULT_CATEGORY_KEY,
  DEFAULT_CATEGORY_SYMBOL,
  SET_DEFAULT_CATEGORY_SYMBOL,
} from '@kiko/categories/category-display';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import type { TimeClock } from '@kiko/dates';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@kiko/currency/format';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import type { TextInputInstance } from 'react-native';
import { categoriesRepo } from '@kiko/categories/repo';
import Text from '@kiko/design-system/components/text';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { Currency } from '@kiko/currency/currency';
import { useTimeClock } from '@kiko/i18n/use-time-clock';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import Divider from '@kiko/design-system/components/divider';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import ColorPicker from '@kiko/design-system/components/color-picker';
import LoadingState from '@kiko/design-system/components/loading-state';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { type CategoryRuleRow, useDataReady, useLiveQuery } from '@kiko/db';
import { isSameCategory, prepareRules } from '@kiko/categories/category-rules';
import { useFormHeaderItems } from '@kiko/screens/forms/use-form-header-items';
import { resolveDefaultCategoryTitle } from '@kiko/i18n/default-category-title';
import { KIKO_CATEGORIES_ICONS } from '@kiko/design-system/components/icon-pools';
import { type FC, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import HoldingIdentityField from '@kiko/design-system/components/holding-identity-field';

import RuleCard from './rule-card';
import { type RuleRow, ruleRows, ruleSummary } from './rule-summary';

type CategoryFormScreenProps = NativeStackScreenProps<SettingsStackParamList, 'CategoryForm'>;

// A rule that can not be read has nothing to open, and no rows: its summary is the note saying so.
type RuleLine = { id: string; rows?: RuleRow[]; summary: string; isReadable: boolean };

// A new category starts on the generic category glyph, the one the Categories footer "Add category"
// button leads with.
const DEFAULT_ICON = genericEntitySymbol.category;

// Stands in for the key of a category that does not exist yet, so the colour picker has a hue to
// ring on open. It only drives the preview: a colour the user did not tap is stored as none.
const NEW_CATEGORY_PREVIEW_KEY = 'new-category';

// The same money text the rest of the app shows, so a rule's amount reads like a transaction's.
const formatRuleAmount = (minorUnits: number, currency: Currency): string =>
  formatMoney(Money.of(currency, minorUnits), activeLocale());

// The category's rules in the order that decides which one wins, the strongest first; a rule that
// can not be read never wins, so it goes last.
const ruleLinesOf = (
  rules: readonly CategoryRuleRow[],
  categoryKey: string,
  t: TFunction,
  clock: TimeClock,
): RuleLine[] => {
  const prepared = prepareRules(rules);
  const belongs = (rule: { category: string }): boolean =>
    isSameCategory(rule.category, categoryKey);

  return [
    ...prepared.ordered.filter(belongs).map((rule) => {
      // The line is read off the rows, so it can not say anything the table does not.
      const rows = ruleRows(rule.displayMatchers, { t, clock, formatAmount: formatRuleAmount });

      return { id: rule.id, rows, summary: ruleSummary(rows), isReadable: true };
    }),
    ...prepared.unreadable.filter(belongs).map((rule) => ({
      id: rule.id,
      summary: t('categoryPage.unreadableRule'),
      isReadable: false,
    })),
  ];
};

type CategoryEdits = { name: string; icon: string; color: string | null };

// Writes what the user changed from the values the form was seeded with, each through its own repo
// write. The live row is not the baseline: a restore can change it under the open form, and a field
// the user never touched must not be written back from the form. The seeded name is the shown
// title, so a seeded default left alone is not a rename. The colour picker cannot clear a colour,
// so a null colour means none was picked.
const saveEdits = async (
  categoryKey: string,
  seed: CategoryEdits,
  edits: CategoryEdits,
): Promise<void> => {
  if (edits.name !== seed.name) {
    await categoriesRepo.updateTitle(categoryKey, edits.name);
  }

  if (edits.icon !== seed.icon) {
    await categoriesRepo.updateIcon(categoryKey, edits.icon);
  }

  if (edits.color !== null && edits.color !== seed.color) {
    await categoriesRepo.updateColor(categoryKey, edits.color);
  }
};

// The category screen, for a new category (no `categoryKey`) and for one that exists: name, icon
// and colour, and for an existing one its rules below with the button that adds one. Saving a new
// category opens its own screen in place of the form, where rules can be added; saving an edit goes
// back. The rule editor is pushed on top, so what was typed here is still there on return.
const CategoryFormScreen: FC<CategoryFormScreenProps> = ({ navigation, route }) => {
  const { categoryKey } = route.params;
  const isEdit = categoryKey !== undefined;
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const clock = useTimeClock();
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
  // What the form was seeded with: Save writes only the fields the user moved away from it.
  const seed = useRef<CategoryEdits | undefined>(undefined);

  // Uncached: a form seeds its fields from this read, so it must not start from a cached row that
  // may be one read old.
  const {
    data: categories,
    isLoading: categoriesLoading,
    isFresh: categoriesFresh,
  } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);
  const { data: rules, isLoading: rulesLoading } = useLiveQuery(
    categoryRulesRepo.allQuery(),
    ['category_rules'],
    isEdit,
    { cached: true },
  );
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    isEdit,
    { cached: true },
  );
  const isReady = useDataReady(categoriesLoading, rulesLoading, settingsLoading);
  const editingCategory = categories.find((row) => row.key === categoryKey);
  // An existing category shows its screen only once every read has landed and the category is in
  // them; until then its fields are not mounted and Save waits.
  const hasCategory = editingCategory !== undefined;
  const isLoadingCategory = isEdit && (!isReady || !hasCategory);
  const displayName = foldMap(maybe(editingCategory), (row) =>
    resolveDefaultCategoryTitle(row.key, row.title),
  );
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;
  const isDefault = categoryKey === defaultCategoryKey;
  const lines = useMemo(
    () => foldMap(maybe(categoryKey), (key) => ruleLinesOf(rules, key, t, clock)) ?? [],
    [rules, categoryKey, t, clock],
  );

  const trimmedName = name.trim();
  const previewColor = resolveCategoryColor(
    color,
    categoryKey ?? (trimmedName || NEW_CATEGORY_PREVIEW_KEY),
  );

  // The stack leaves an existing category's title empty so the raw route name never shows; the
  // category's own name fills it once it is read. A new category keeps the stack's "New Category".
  useLayoutEffect(() => {
    if (displayName !== undefined) {
      navigation.setOptions({ title: displayName });
    }
  }, [navigation, displayName]);

  // Seeded once, so a later live-query emission cannot replace what the user is typing.
  useEffect(() => {
    if (seed.current !== undefined || editingCategory === undefined) {
      return;
    }

    const seeded = {
      name: resolveDefaultCategoryTitle(editingCategory.key, editingCategory.title),
      icon: editingCategory.icon,
      color: editingCategory.color,
    };

    seed.current = seeded;
    setName(seeded.name);
    setIcon(seeded.icon);
    setColor(seeded.color);
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

  // A category deleted elsewhere (a restore) leaves nothing to show. Only the fresh read can say
  // so: a failed read applies no rows and is never fresh, and its empty result does not mean the
  // category is gone.
  useEffect(() => {
    if (isEdit && isReady && categoriesFresh && editingCategory === undefined) {
      navigation.goBack();
    }
  }, [navigation, isEdit, isReady, categoriesFresh, editingCategory]);

  const save = async (): Promise<void> => {
    if (trimmedName === '') {
      setAttemptedSave(true);

      return;
    }

    try {
      if (isEdit) {
        if (editingCategory !== undefined && seed.current !== undefined) {
          await saveEdits(editingCategory.key, seed.current, { name: trimmedName, icon, color });
          navigation.goBack();
        }

        return;
      }

      const createdKey = await categoriesRepo.create({ title: trimmedName, icon, color });

      navigation.replace('CategoryForm', { categoryKey: createdKey });
    } catch {
      // A failed write must not vanish silently: keep the form open and say so.
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
    }
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  // The star waits for the settings read: before it, the default would fall back to the seeded one
  // and could show the wrong state. It waits for the category row too, so a category the screen
  // could not read is never written as the default. It writes at once, not on Save, and a category
  // that does not exist yet has no key to write. Adjacent bar items share one glass capsule on
  // iOS 26+, which would read the star and Save as one control, so neither shares its background.
  const starLabel = t(isDefault ? 'categoryPage.isDefault' : 'categoryPage.setAsDefault');
  const extraItems = useMemo<NativeStackHeaderItemButton[] | undefined>(
    () =>
      categoryKey !== undefined && isReady && hasCategory
        ? [
            {
              type: 'button',
              label: starLabel,
              accessibilityLabel: starLabel,
              icon: {
                type: 'sfSymbol',
                name: isDefault ? DEFAULT_CATEGORY_SYMBOL : SET_DEFAULT_CATEGORY_SYMBOL,
              },
              tintColor: theme.colors.textPrimary,
              sharesBackground: false,
              // The default category is the state, not an action: the filled star only shows it.
              disabled: isDefault,
              onPress: () => settingsRepo.setDefaultCategoryKey(categoryKey),
            },
          ]
        : undefined,
    [categoryKey, isReady, hasCategory, isDefault, starLabel, theme.colors.textPrimary],
  );

  useFormHeaderItems({
    navigation,
    onSave,
    hasSave: true,
    isSaving: isSubmitting || isLoadingCategory,
    extraItems,
  });

  if (isLoadingCategory) {
    return (
      <Screen scroll>
        <LoadingState testID="category-form-loading" />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      footer={
        isEdit ? (
          <Button
            variant="secondaryTonal"
            onPress={() => navigation.navigate('CategoryRuleForm', { categoryKey })}
            icon={genericEntitySymbol.rule}
          >
            {t('categoryPage.addRule')}
          </Button>
        ) : undefined
      }
    >
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

        {isEdit && (
          <>
            <Divider testID="form-divider" />

            <Box gap={3}>
              <Text variant="heading">{t('categoryPage.rulesHeading')}</Text>

              {lines.length === 0 ? (
                <Text variant="caption" tone="textSecondary">
                  {t('categoryPage.emptyRules')}
                </Text>
              ) : (
                <Box gap={4}>
                  {lines.map((line) => (
                    <RuleCard
                      key={line.id}
                      rows={line.rows}
                      summary={line.summary}
                      onPress={
                        line.isReadable
                          ? () =>
                              navigation.navigate('CategoryRuleForm', {
                                categoryKey,
                                ruleId: line.id,
                              })
                          : undefined
                      }
                      onDelete={() => categoryRulesRepo.deleteRule(line.id)}
                    />
                  ))}
                </Box>
              )}
            </Box>
          </>
        )}
      </Box>
    </Screen>
  );
};

export default CategoryFormScreen;
