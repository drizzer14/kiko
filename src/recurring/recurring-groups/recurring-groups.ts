import {
  buildCategoryDisplayMap,
  resolveCategoryDisplay,
  resolveCategoryKey,
} from '@kiko/categories/category-display';
import { Money } from '@kiko/currency/money';
import { canConvert } from '@kiko/rates/net-worth-view';
import type { Currency } from '@kiko/currency/currency';
import type { ColorScheme } from '@kiko/design-system/palette';
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
  scheme: ColorScheme;
};

export type RecurringGroup = {
  key: string;
  title: string;
  icon: string;
  color: string;
  series: RecurringSeries[];
  total: Money;
};

// Within a group: the newest last charge first, then the merchant key, then the series id. Never
// by amount, which one group can hold in several currencies.
const newestChargeFirst = (left: RecurringSeries, right: RecurringSeries): number =>
  right.lastChargeTime - left.lastChargeTime ||
  compareText(left.merchantKey, right.merchantKey) ||
  compareText(left.id, right.id);

// The charges are debits, so a series has paid the negation of their sum. A row of another
// currency is skipped: the group key of a series holds its currency, so none should be there.
const paidFromRowsById = (series: RecurringSeries, rowById: ReadonlyMap<string, ChargeRow>) => {
  const minorUnits = series.chargeIds.reduce((sum, chargeId) => {
    const row = rowById.get(chargeId);

    return row?.currency === series.currency ? sum - row.amountMinorUnits : sum;
  }, 0);

  return Money.of(series.currency, minorUnits);
};

export const paidSoFarOf = (series: RecurringSeries, rows: readonly ChargeRow[]): Money =>
  paidFromRowsById(series, new Map(rows.map((row) => [row.id, row])));

export const recurringGroupsOf = ({
  shown,
  rows,
  categories,
  defaultCategoryKey,
  baseCurrency,
  rateTable,
  scheme,
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
  // Each series is resolved once; pushing in `inGroupOrder` keeps that order inside every group.
  const seriesByKey = new Map<string, RecurringSeries[]>();

  for (const entry of inGroupOrder) {
    const key = categoryKeyOf(entry);

    const inKey = seriesByKey.get(key);

    if (inKey === undefined) {
      seriesByKey.set(key, [entry]);
    } else {
      inKey.push(entry);
    }
  }

  const groups = keys.flatMap((key): RecurringGroup[] => {
    const series = seriesByKey.get(key) ?? [];

    if (series.length === 0) {
      return [];
    }

    const display = resolveCategoryDisplay(key, displayByKey, defaultCategoryKey);
    // One conversion per series, so a group total equals the sum of what it holds. A currency
    // with no rate is left out of the totals and its series stays listed.
    const total = series.reduce(
      (sum, entry) => {
        const last = Money.of(entry.currency, entry.lastChargeAmountMinorUnits);

        return canConvert(last.currency, baseCurrency, rateTable)
          ? sum.add(convert(last, baseCurrency, rateTable))
          : sum;
      },
      Money.of(baseCurrency, 0),
    );

    return [
      {
        key,
        title: display.title,
        icon: display.icon,
        color: resolveCategoryColor(display.color, key, scheme),
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
