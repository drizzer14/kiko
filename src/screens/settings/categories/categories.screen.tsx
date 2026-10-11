import { type FC, useMemo } from 'react';
import Sortable from 'react-native-sortables';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import { categoriesRepo } from '@kiko/categories/repo';
import type { ScrollViewInstance } from 'react-native';
import { useAnimatedRef } from 'react-native-reanimated';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import { onGridDragEnd } from '@kiko/design-system/grid-interaction';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import LoadingState from '@kiko/design-system/components/loading-state';
import { categoryDeleteNoticeOf } from '@kiko/categories/delete-notice';
import { DEFAULT_CATEGORY_KEY } from '@kiko/categories/category-display';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { useGridLiftGuard } from '@kiko/design-system/use-grid-lift-guard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';
import { resolveDefaultCategoryTitle } from '@kiko/i18n/default-category-title';
import { type CategoryRow, type CategoryRuleRow, useDataReady, useLiveQuery } from '@kiko/db';

import CategoryCard from './category-card';

type CategoriesScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Categories'>;

const styles = StyleSheet.create(() => ({
  // The footer's "Add category" button spans the full footer width so it reads as the row's
  // dominant action and keeps an easy-to-hit tap target, as the Accounts footer does.
  addCategoryButton: {
    width: '100%',
  },
}));

const categoryKeyExtractor = (category: CategoryRow): string => category.key;

// Counted case-insensitively, the way a category delete removes the rules, so the number on a
// card is the number the delete confirm names.
const ruleCountsByCategory = (rules: readonly CategoryRuleRow[]): Map<string, number> => {
  const counts = new Map<string, number>();

  for (const rule of rules) {
    const key = rule.category.toLowerCase();

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
};

// The Categories settings sub-screen: a single-column, drag-to-reorder list of category cards laid
// out like the Accounts list. A tap opens the category's page, a still hold offers the delete (not
// on the default category, which is the catch-all), and the footer adds a category.
const CategoriesScreen: FC<CategoriesScreenProps> = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
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
  // The blank list, and a "No rules" caption, must never render while a query is still on its own
  // first load (kiko-architecture's useLiveQuery consumer rule).
  const isReady = useDataReady(categoriesLoading, rulesLoading, settingsLoading);
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;
  const ruleCounts = useMemo(() => ruleCountsByCategory(rules), [rules]);
  // A card keeps its own key, so only the card a hold lifted skips its page on release.
  const { onDragStart, onActiveItemDropped, openUnlessLifted } = useGridLiftGuard();
  // The scroll view's ref, shared with the grid so a drag near an edge scrolls the list.
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();

  const renderCategoryCard = ({ item }: { item: CategoryRow }) => {
    const isDefault = item.key === defaultCategoryKey;
    // A seeded default is named by its translated title everywhere, the menu's confirm included.
    const displayName = resolveDefaultCategoryTitle(item.key, item.title);

    return (
      <CardContextMenu
        name={displayName}
        deletable={!isDefault}
        deleteMessage={() => categoryDeleteNoticeOf(item.key, t)}
        onDelete={() => categoriesRepo.delete(item.key)}
      >
        <CategoryCard
          title={displayName}
          icon={item.icon}
          color={resolveCategoryColor(item.color, item.key)}
          ruleCount={ruleCounts.get(item.key.toLowerCase()) ?? 0}
          isDefault={isDefault}
          onPress={openUnlessLifted(item.key, () =>
            navigation.navigate('CategoryDetail', { categoryKey: item.key }),
          )}
        />
      </CardContextMenu>
    );
  };

  if (!isReady) {
    // The SAME Screen mode/props as the ready branch below, so the scroll view iOS walks to drive
    // the large-title collapse exists from the very first render.
    return (
      <Screen scroll scrollableRef={scrollableRef}>
        <LoadingState testID="categories-loading" />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      scrollableRef={scrollableRef}
      footer={
        <Box testID="add-category-footer" style={styles.addCategoryButton}>
          <Button
            variant="primary"
            onPress={() => navigation.navigate('CategoryForm', {})}
            icon={genericEntitySymbol.category}
          >
            {t('categories.addCategory')}
          </Button>
        </Box>
      }
    >
      {/* A hold that moves reorders (through the shared `onGridDragEnd`, which persists only a
          real move); a hold that stays still opens the delete menu; a quick tap opens the page.
          A drag persists the whole order from the rows on screen, so it never starts from the
          cached, possibly one-read-old order. */}
      <Sortable.Grid
        data={categories}
        sortEnabled={categoriesFresh}
        activeItemScale={1.03}
        columns={1}
        overDrag="vertical"
        rowGap={theme.spacing(4)}
        scrollableRef={scrollableRef}
        autoScrollActivationOffset={75}
        keyExtractor={categoryKeyExtractor}
        renderItem={renderCategoryCard}
        onDragStart={onDragStart}
        onActiveItemDropped={onActiveItemDropped}
        onDragEnd={({ fromIndex, toIndex, indexToKey }) =>
          onGridDragEnd({ fromIndex, toIndex, indexToKey }, categoriesRepo.reorder)
        }
      />
    </Screen>
  );
};

export default CategoriesScreen;
