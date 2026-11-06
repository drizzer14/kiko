import { FlatList } from 'react-native';
import { type FC, useMemo } from 'react';
import {
  categoryKeyOf,
  isSameCategory,
  planReviewGroups,
  prepareRules,
  type ReviewGroup,
} from '@kiko/categories/category-rules';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import Screen, {
  useContentCap,
  useContentMargin,
  useScrollIndicatorProps,
  useAutomaticScrollClearance,
} from '@kiko/design-system/components/screen';
import { useDataReady, useLiveQuery } from '@kiko/db';
import { categoriesRepo } from '@kiko/categories/repo';
import LargeTitleHeading, {
  useLargeTitleScroll,
} from '@kiko/design-system/components/large-title-heading';
import { useIsScreenVisible } from '@kiko/navigation/pane-stack';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import EmptyState from '@kiko/design-system/components/empty-state';
import { ruleMoveMessage } from '@kiko/categories/rule-preview-text';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import ConfirmSheet from '@kiko/design-system/components/confirm-sheet';
import LoadingState from '@kiko/design-system/components/loading-state';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';
import { DEFAULT_CATEGORY_KEY } from '@kiko/categories/category-display';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { resolveDefaultCategoryTitle } from '@kiko/i18n/default-category-title';

import ReviewLine from './review-line';
import { styles } from './category-review.styles';
import { useReviewActions } from './use-review-actions';
import CategoryOptionsSheet from './category-options-sheet';
import type { ReviewLineSuggestion } from './review-line/review-line.props';

type CategoryReviewScreenProps = NativeStackScreenProps<SettingsStackParamList, 'CategoryReview'>;

type SuggestedOption = { key: string; title: string; icon: string };

const groupKeyOf = (group: ReviewGroup): string => group.key;

// The group's suggestion with its category as the options sheet lists it. Both come from the same
// categories read, so a suggestion names a listed category; one that is not listed shows no chip.
const lineSuggestionOf = (
  group: ReviewGroup,
  options: readonly SuggestedOption[],
): ReviewLineSuggestion | null =>
  foldMap(maybe(group.suggestion), ({ category, agreeing, total }) =>
    foldMap(
      maybe(options.find(({ key }) => isSameCategory(key, category))),
      ({ key, title, icon }) => ({ key, title, icon, agreeing, total }),
    ),
  ) ?? null;

// The transactions with no category, grouped by name, a line each. The list stays mounted while
// the reads are queued, so the large title tracks it from the first render, and shows the loading
// state in place of its lines, never the empty state.
const CategoryReviewScreen: FC<CategoryReviewScreenProps> = () => {
  const { t } = useTranslation();
  const isVisible = useIsScreenVisible();
  // Paused by visibility, not focus: in a split window a screen can show without being the
  // focused route. Never cached: these reads lead to a write, so a cached row could be one
  // read old.
  const readOptions = { paused: !isVisible };
  const { data: candidates, isLoading: candidatesLoading } = useLiveQuery(
    categoryRulesRepo.reviewCandidateRowsQuery(),
    ['transactions', 'category_rules', 'categories'],
    true,
    readOptions,
  );
  const { data: rules, isLoading: rulesLoading } = useLiveQuery(
    categoryRulesRepo.allQuery(),
    ['category_rules'],
    true,
    readOptions,
  );
  const { data: categories, isLoading: categoriesLoading } = useLiveQuery(
    categoriesRepo.allQuery(),
    ['categories'],
    true,
    readOptions,
  );
  const { data: evidence, isLoading: evidenceLoading } = useLiveQuery(
    categoryRulesRepo.reviewEvidenceQuery(),
    ['transactions', 'category_rules', 'categories'],
    true,
    readOptions,
  );
  const isReady = useDataReady(candidatesLoading, rulesLoading, categoriesLoading, evidenceLoading);
  // Planned only once all four reads have landed: each lands on its own render, and a plan over a
  // half-loaded set is thrown away at once.
  const groups = useMemo(
    () =>
      isReady
        ? planReviewGroups(
            prepareRules(rules),
            candidates,
            new Set(categories.map(({ key }) => categoryKeyOf(key))),
            evidence,
          )
        : [],
    [isReady, candidates, rules, categories, evidence],
  );
  // Every listed row moves into the picked category, and one already in `other` would not, so
  // `other` is not offered.
  const categoryOptions = useMemo(
    () =>
      categories
        .filter(({ key }) => !isSameCategory(key, DEFAULT_CATEGORY_KEY))
        .map((category) => ({
          key: category.key,
          title: resolveDefaultCategoryTitle(category.key, category.title),
          icon: category.icon,
          color: resolveCategoryColor(category.color, category.key),
        })),
    [categories],
  );
  const actions = useReviewActions();
  const headingScrollProps = useLargeTitleScroll();
  const bottomClearance = useAutomaticScrollClearance();
  const contentMargin = useContentMargin();
  const contentCap = useContentCap();
  const scrollIndicatorProps = useScrollIndicatorProps();

  return (
    <Screen bleedTop>
      <FlatList
        data={groups}
        keyExtractor={groupKeyOf}
        renderItem={({ item }) => (
          <ReviewLine
            group={item}
            disabled={actions.isBusy}
            suggestion={lineSuggestionOf(item, categoryOptions)}
            onChoose={actions.choose}
            onAccept={actions.accept}
          />
        )}
        ListHeaderComponent={<LargeTitleHeading />}
        ListEmptyComponent={
          isReady ? (
            <EmptyState
              icon={genericEntitySymbol.category}
              title={t('categoryReview.emptyTitle')}
              message={t('categoryReview.emptyMessage')}
              testID="category-review-empty"
            />
          ) : (
            <LoadingState testID="category-review-loading" />
          )
        }
        {...headingScrollProps}
        contentInsetAdjustmentBehavior="automatic"
        {...scrollIndicatorProps}
        style={styles.list}
        contentContainerStyle={[styles.listContent(bottomClearance, contentMargin), contentCap]}
      />

      <CategoryOptionsSheet
        visible={actions.isOptionsOpen}
        options={categoryOptions}
        onSelect={actions.pick}
        onDismiss={actions.closeOptions}
        onClosed={actions.onOptionsClosed}
      />

      <ConfirmSheet
        visible={actions.isConfirmOpen}
        title={t('categoryRulePreview.confirmTitle')}
        message={foldMap(maybe(actions.pendingConfirm), ({ preview, category }) =>
          ruleMoveMessage(
            preview,
            categoryOptions.find(({ key }) => key === category)?.title ?? category,
            t,
          ),
        )}
        confirmLabel={t('categoryRulePreview.confirm')}
        onConfirm={actions.confirm}
        onCancel={actions.cancelConfirm}
      />
    </Screen>
  );
};

export default CategoryReviewScreen;
