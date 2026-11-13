import {
  type CategoryDisplay,
  resolveCategoryDisplay,
  resolveCategoryKey,
} from '@kiko/categories/category-display';
import type { ComponentProps } from 'react';
import type { ColorScheme } from '@kiko/design-system/palette';
import type { HoldingType } from '@kiko/holdings/holding-type';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { isTimeExemptHoldingType } from '@kiko/holdings/holding-descriptor';
import type TransactionCard from '@kiko/design-system/components/transaction-card';
import { formatDate, formatDateTime, formatTime, type TimeClock } from '@kiko/dates';

// What a row has to give for its card: the same five fields for a Home row and a cell row.
// `holdingType` is null when the row's holding is not known.
type CardPropsSource = {
  category: string | null;
  accountName: string;
  holdingType: HoldingType | null;
  loanHoldingId: string | null;
  time: number;
};

type CardPropsContext = {
  // Names the part of a loan payment (interest, fee); it takes the category title's place in the
  // footer.
  loanPartLabel?: string;
  categoryByKey: ReadonlyMap<string, CategoryDisplay>;
  defaultCategoryKey: string;
  scheme: ColorScheme;
  clock: TimeClock;
  // 'time' is Home's time of day under a date heading; 'dateTime' is for a list with no heading.
  trailing: 'time' | 'dateTime';
};

// Only what is derived from the row. The caller passes `title`, `money` and the rest itself.
type TransactionCardDerivedProps = Pick<
  ComponentProps<typeof TransactionCard>,
  | 'categoryIcon'
  | 'categoryIconColor'
  | 'categoryAccessibilityLabel'
  | 'footerMeta'
  | 'footerTrailing'
  | 'loanLinked'
>;

const isTimedHolding = (holdingType: HoldingType | null): boolean =>
  holdingType !== null && !isTimeExemptHoldingType(holdingType);

const trailingOf = (
  { holdingType, time }: CardPropsSource,
  { clock, trailing }: CardPropsContext,
): string | undefined => {
  const timed = isTimedHolding(holdingType);

  if (trailing === 'time') {
    return timed ? formatTime(time, clock) : undefined;
  }

  return timed ? formatDateTime(time, clock) : formatDate(time);
};

export const transactionCardPropsOf = (
  source: CardPropsSource,
  context: CardPropsContext,
): TransactionCardDerivedProps => {
  const { categoryByKey, defaultCategoryKey, scheme, loanPartLabel } = context;
  const category = resolveCategoryDisplay(source.category, categoryByKey, defaultCategoryKey);
  // The icon colour must hash on the SAME resolved key as the category's filter chip: the raw
  // slug of an unknown category would paint one category in two hues.
  const key = resolveCategoryKey(source.category, categoryByKey, defaultCategoryKey);

  return {
    categoryIcon: category.icon,
    categoryIconColor: resolveCategoryColor(category.color, key, scheme),
    categoryAccessibilityLabel: category.title,
    footerMeta: `${source.accountName} · ${loanPartLabel ?? category.title}`,
    footerTrailing: trailingOf(source, context),
    loanLinked: source.loanHoldingId !== null,
  };
};
