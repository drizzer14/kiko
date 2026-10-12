import { match } from 'ts-pattern';
import { View } from 'react-native';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { categoriesRepo } from '@kiko/categories/repo';
import { id, useDataReady, useLiveQuery } from '@kiko/db';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import Divider from '@kiko/design-system/components/divider';
import FieldError from '@kiko/design-system/components/field-error';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import LoadingState from '@kiko/design-system/components/loading-state';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import { useScrollToField } from '@kiko/design-system/use-scroll-to-field';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { categoryKeyOf, prepareRules } from '@kiko/categories/category-rules';
import { type FC, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  type MatcherDraft,
  type MatcherDraftError,
  emptyMatcherDraft,
  toMatcherDrafts,
} from './rule-draft';
import MatcherRow from './matcher-row';
import RuleRewriteSheet from './rule-rewrite-sheet';
import { type RefusalTarget, type RefusedRule, useSaveRule } from './use-save-rule';

type CategoryRuleFormScreenProps = NativeStackScreenProps<
  SettingsStackParamList,
  'CategoryRuleForm'
>;

// A row keeps its key while rows around it come and go, so it keeps what was typed in it.
type DraftRow = { key: string; draft: MatcherDraft };

const keyedRow = (draft: MatcherDraft): DraftRow => ({ key: id(), draft });

const rowErrorMessage = (error: MatcherDraftError | undefined, t: TFunction): string | undefined =>
  foldMap(maybe(error), (kind) =>
    match(kind)
      .with('errorName', () => t('ruleForm.errorName'))
      .with('errorAmount', () => t('ruleForm.errorAmount'))
      .exhaustive(),
  );

const ruleErrorMessage = (
  refusal: RefusedRule,
  categoryTitleOf: (key: string) => string,
  t: TFunction,
): string =>
  match(refusal)
    .with({ kind: 'noMatchers' }, () => t('ruleForm.errorNoMatchers'))
    .with({ kind: 'neverMatches', conflict: 'time' }, () => t('ruleForm.errorNeverMatchesTime'))
    .with({ kind: 'neverMatches', conflict: 'other' }, () => t('ruleForm.errorNeverMatches'))
    .with({ kind: 'duplicate' }, ({ category }) =>
      t('ruleForm.errorDuplicate', { category: categoryTitleOf(category) }),
    )
    .exhaustive();

// The rule editor, for a new rule of a category (no `ruleId`) and for editing one: a list of
// conditions that must all match. Save validates, then asks about the existing transactions the
// rule would change before it stores anything. A rule is deleted from its card on the category
// page, never from here.
const CategoryRuleFormScreen: FC<CategoryRuleFormScreenProps> = ({ navigation, route }) => {
  const { categoryKey, ruleId } = route.params;
  const isEdit = ruleId !== undefined;
  const { t } = useTranslation();
  // Uncached: the editor seeds its rows from this read, so it must not start from a cached rule
  // that may be one read old.
  const { data: rules, isLoading: rulesLoading } = useLiveQuery(categoryRulesRepo.allQuery(), [
    'category_rules',
  ]);
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories'], true, {
    cached: true,
  });
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    true,
    { cached: true },
  );
  const isReady = useDataReady(rulesLoading, settingsLoading);
  const baseCurrency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const rowViews = useRef<(FieldInstance | null)[]>([]);
  const ruleErrorView = useRef<FieldInstance | null>(null);
  const { scrollableRef, onContentSizeChange, scrollTo } = useScrollToField();
  const categoryTitles = useMemo(() => buildCategoryDisplayMap(categories), [categories]);
  const drafts = useMemo(() => rows.map((row) => row.draft), [rows]);

  const bringIntoView = (target: RefusalTarget): void =>
    scrollTo(
      match(target)
        .with({ kind: 'rule' }, () => ruleErrorView)
        .with({ kind: 'row' }, ({ position }) => ({ current: rowViews.current[position] ?? null }))
        .exhaustive(),
    );

  const { errors, save, sheet } = useSaveRule({
    ruleId: ruleId ?? null,
    categoryKey,
    drafts,
    rules,
    onSaved: () => navigation.goBack(),
    onRefused: bringIntoView,
  });

  // The stack sets the static "New Rule" title; an edit overrides it.
  useLayoutEffect(() => {
    if (isEdit) {
      navigation.setOptions({ title: t('ruleForm.editTitle') });
    }
  }, [isEdit, navigation, t]);

  // Seeded once, so a later live-query emission cannot replace what the user is typing. A rule
  // deleted elsewhere leaves nothing to edit.
  useEffect(() => {
    if (hydrated || !isReady) {
      return;
    }

    if (!isEdit) {
      setRows([keyedRow(emptyMatcherDraft(baseCurrency))]);
      setHydrated(true);

      return;
    }

    const stored = prepareRules(rules).ordered.find((rule) => rule.id === ruleId);

    if (stored === undefined) {
      navigation.goBack();

      return;
    }

    setRows(toMatcherDrafts(stored.displayMatchers, baseCurrency).map(keyedRow));
    setHydrated(true);
  }, [hydrated, isReady, isEdit, rules, ruleId, baseCurrency, navigation]);

  const changeRow = (key: string, fields: Partial<MatcherDraft>): void =>
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, draft: { ...row.draft, ...fields } } : row,
      ),
    );

  const addRow = (): void =>
    setRows((current) => [...current, keyedRow(emptyMatcherDraft(baseCurrency))]);

  const removeRow = (key: string): void =>
    setRows((current) => current.filter((row) => row.key !== key));

  const categoryTitleOf = (key: string): string =>
    categoryTitles.get(categoryKeyOf(key))?.title ?? key;

  if (!isReady || !hydrated) {
    return (
      <Screen scroll>
        <LoadingState testID="category-rule-form-loading" />
      </Screen>
    );
  }

  return (
    <>
      <Screen
        scroll
        scrollableRef={scrollableRef}
        onContentSizeChange={onContentSizeChange}
        footer={
          <Button onPress={save.onPress} disabled={save.isSubmitting}>
            {t('common.save')}
          </Button>
        }
      >
        <Box gap={4}>
          <Text variant="caption" tone="textSecondary">
            {t('ruleForm.allMustMatch')}
          </Text>

          {rows.map((row, position) => (
            <View
              key={row.key}
              ref={(node) => {
                rowViews.current[position] = node;
              }}
            >
              <Box gap={4}>
                {position > 0 && <Divider />}

                <MatcherRow
                  draft={row.draft}
                  position={position}
                  canRemove={rows.length > 1}
                  onChange={(fields) => changeRow(row.key, fields)}
                  onRemove={() => removeRow(row.key)}
                  error={rowErrorMessage(errors.rows.get(position), t)}
                />
              </Box>
            </View>
          ))}

          {/* Always mounted, so a refused Save has a place to scroll to before the error shows. */}
          <View ref={ruleErrorView}>
            {errors.rule !== undefined && (
              <FieldError message={ruleErrorMessage(errors.rule, categoryTitleOf, t)} />
            )}
          </View>

          <Button
            variant="secondaryTonal"
            size="small"
            fullWidth={false}
            icon="plus"
            onPress={addRow}
          >
            {t('ruleForm.addMatcher')}
          </Button>
        </Box>
      </Screen>

      <RuleRewriteSheet
        visible={sheet.visible}
        count={sheet.count}
        onApply={sheet.apply.onPress}
        isApplying={sheet.apply.isSubmitting}
        onKeepNew={sheet.keepNew.onPress}
        isKeepingNew={sheet.keepNew.isSubmitting}
        onDismiss={sheet.onDismiss}
        onClosed={sheet.onClosed}
      />
    </>
  );
};

export default CategoryRuleFormScreen;
