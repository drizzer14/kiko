import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import type { TimeClock } from '@kiko/dates';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@kiko/currency/format';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import { categoriesRepo } from '@kiko/categories/repo';
import Text from '@kiko/design-system/components/text';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { Currency } from '@kiko/currency/currency';
import { useTimeClock } from '@kiko/i18n/use-time-clock';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { prepareRules } from '@kiko/categories/category-rules';
import { editBarItem } from '@kiko/design-system/edit-bar-item';
import { type FC, useEffect, useLayoutEffect, useMemo } from 'react';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import LoadingState from '@kiko/design-system/components/loading-state';
import { DEFAULT_CATEGORY_KEY } from '@kiko/categories/category-display';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';
import { type CategoryRuleRow, useDataReady, useLiveQuery } from '@kiko/db';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { resolveDefaultCategoryTitle } from '@kiko/i18n/default-category-title';

import RuleCard from './rule-card';
import { ruleSummary } from './rule-summary';

type CategoryDetailScreenProps = NativeStackScreenProps<SettingsStackParamList, 'CategoryDetail'>;

type RuleLine = { id: string; title: string };

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
  const lowercaseKey = categoryKey.toLowerCase();
  const prepared = prepareRules(rules);
  const belongs = (rule: { category: string }): boolean =>
    rule.category.toLowerCase() === lowercaseKey;

  return [
    ...prepared.ordered.filter(belongs).map((rule) => ({
      id: rule.id,
      title: ruleSummary(rule.displayMatchers, { t, clock, formatAmount: formatRuleAmount }),
    })),
    ...prepared.unreadable.filter(belongs).map((rule) => ({
      id: rule.id,
      title: t('categoryPage.unreadableRule'),
    })),
  ];
};

// A category's page: its rules as cards in priority order, and the row that makes it the default.
// Editing the category is the header's Edit.
const CategoryDetailScreen: FC<CategoryDetailScreenProps> = ({ navigation, route }) => {
  const { categoryKey } = route.params;
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const clock = useTimeClock();
  const {
    data: categories,
    isLoading: categoriesLoading,
    isFresh: categoriesFresh,
  } = useLiveQuery(categoriesRepo.allQuery(), ['categories'], true, { cached: true });
  const { data: rules, isLoading: rulesLoading } = useLiveQuery(
    categoryRulesRepo.allQuery(),
    ['category_rules'],
    true,
    { cached: true },
  );
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    true,
    { cached: true },
  );
  const isReady = useDataReady(categoriesLoading, rulesLoading, settingsLoading);
  const category = categories.find((row) => row.key === categoryKey);
  const displayName = foldMap(maybe(category), (row) =>
    resolveDefaultCategoryTitle(row.key, row.title),
  );
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;
  const lines = useMemo(
    () => ruleLinesOf(rules, categoryKey, t, clock),
    [rules, categoryKey, t, clock],
  );

  useLayoutEffect(() => {
    if (displayName === undefined) {
      return;
    }

    navigation.setOptions({
      title: displayName,
      unstable_headerRightItems: () => [
        editBarItem({
          label: t('common.edit'),
          tintColor: theme.colors.textPrimary,
          onPress: () => navigation.navigate('CategoryForm', { categoryKey }),
        }),
      ],
    });
  }, [navigation, displayName, categoryKey, t, theme.colors.textPrimary]);

  // A category deleted elsewhere (a restore) leaves nothing to show. Only the fresh read can say
  // so: a cached one may be a read old and not hold a category that was just created.
  useEffect(() => {
    if (isReady && categoriesFresh && category === undefined) {
      navigation.goBack();
    }
  }, [navigation, isReady, categoriesFresh, category]);

  if (!isReady || category === undefined) {
    return (
      <Screen scroll>
        <LoadingState testID="category-detail-loading" />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Box gap={4}>
        <Box gap={3}>
          <Text variant="heading">{t('categoryPage.rulesHeading')}</Text>

          {lines.length === 0 ? (
            <Text tone="textSecondary">{t('categories.noRules')}</Text>
          ) : (
            <Box gap={4}>
              {lines.map((line) => (
                <RuleCard
                  key={line.id}
                  title={line.title}
                  onDelete={() => categoryRulesRepo.deleteRule(line.id)}
                />
              ))}
            </Box>
          )}
        </Box>

        {category.key !== defaultCategoryKey && (
          <Button
            variant="secondaryTonal"
            icon="star"
            onPress={() => settingsRepo.setDefaultCategoryKey(category.key)}
          >
            {t('categoryPage.setAsDefault')}
          </Button>
        )}
      </Box>
    </Screen>
  );
};

export default CategoryDetailScreen;
