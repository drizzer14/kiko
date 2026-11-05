import {
  buildCategoryDisplayMap,
  resolveCategoryDisplay,
  resolveCategoryKey,
} from '@kiko/categories/category-display';
import { Money } from '@kiko/currency/money';
import { canConvert } from '@kiko/rates/net-worth-view';
import type { Currency } from '@kiko/currency/currency';
import { type RateTable, convert } from '@kiko/rates/conversion';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { compareText, type RecurringSeries } from '@kiko/recurring/detection';

type ChargeRow = {
  id: string;
  amountMinorUnits: number;
  currency: Currency;
  category: string | null;
};

type RecurringGroupsInput = {
  shown: readonly RecurringSeries[];
  rows: readonly ChargeRow[];
  categories: readonly { key: string; title: string; icon: string; color: string | null }[];
  defaultCategoryKey: string;
  baseCurrency: Currency;
  rateTable: RateTable;
};

// Within a group: the newest last charge first, then the merchant key, then the series id. Never
// by amount, which one group can hold in several currencies.
export const newestChargeFirst = (left: RecurringSeries, right: RecurringSeries): number =>
  right.lastChargeTime - left.lastChargeTime ||
  compareText(left.merchantKey, right.merchantKey) ||
  compareText(left.id, right.id);

// The charges are debits, so a series has paid the negation of their sum. A row of another
// currency is skipped: the group key of a series holds its currency, so none should be there.
export const paidSoFarOf = (series: RecurringSeries, rows: readonly ChargeRow[]): Money => {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const minorUnits = series.chargeIds.reduce((sum, chargeId) => {
    const row = rowById.get(chargeId);

    return row?.currency === series.currency ? sum - row.amountMinorUnits : sum;
  }, 0);

  return Money.of(series.currency, minorUnits);
};

export const recurringGroupsOf = ({
  shown,
  rows,
  categories,
  defaultCategoryKey,
  baseCurrency,
  rateTable,
}: RecurringGroupsInput) => {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const displayByKey = buildCategoryDisplayMap(categories);
  // The newest charge's category is the first id of `chargeIds` found in the rows. A series none
  // of whose rows is read takes the same fold as a row with no category.
  const categoryKeyOf = (series: RecurringSeries): string =>
    resolveCategoryKey(
      series.chargeIds.map((chargeId) => rowById.get(chargeId)).find((row) => row !== undefined)
        ?.category ?? null,
      displayByKey,
      defaultCategoryKey,
    );
  const ordered = [...shown].sort(newestChargeFirst);
  const inGroupOrder = [
    ...ordered.filter(({ isStopped }) => !isStopped),
    ...ordered.filter(({ isStopped }) => isStopped),
  ];
  // Only the default key can be outside the categories read: every other key resolves through it.
  const keys = [
    ...categories.map(({ key }) => key),
    ...(displayByKey.has(defaultCategoryKey) ? [] : [defaultCategoryKey]),
  ];
  const groups = keys.flatMap((key) => {
    const series = inGroupOrder.filter((entry) => categoryKeyOf(entry) === key);

    if (series.length === 0) {
      return [];
    }

    const display = resolveCategoryDisplay(key, displayByKey, defaultCategoryKey);
    // One conversion per series sum, never per row, so a group total equals the sum of what it
    // holds. A currency with no rate is left out of the totals and its series stays listed.
    const total = series.reduce(
      (sum, entry) => {
        const paid = paidSoFarOf(entry, rows);

        return canConvert(paid.currency, baseCurrency, rateTable)
          ? sum.add(convert(paid, baseCurrency, rateTable))
          : sum;
      },
      Money.of(baseCurrency, 0),
    );

    return [
      {
        key,
        title: display.title,
        icon: display.icon,
        color: resolveCategoryColor(display.color, key),
        series,
        total,
      },
    ];
  });

  return {
    groups,
    total:
      groups.length > 0
        ? groups.reduce((sum, group) => sum.add(group.total), Money.of(baseCurrency, 0))
        : undefined,
  };
};
