import {
  type CategoryDisplay,
  resolveCategoryDisplay,
  resolveCategoryKey,
} from '../../categories/category-display';
import { Money } from '../../currency/money';
import { canConvert } from '../../rates/net-worth-view';
import type { Currency } from '../../currency/currency';
import { chartSeriesDark } from '../../design-system/palette';
import { convert, type RateTable } from '../../rates/conversion';
import type { HoldingRow, TransactionRow } from '../../db/schema';

/**
 * A transaction as the spending breakdown needs it: its stored `category` key,
 * its signed `amountMinorUnits`, and the currency those minor units are in. The
 * amount's currency is the parent HOLDING's currency (a transaction row has no
 * currency of its own), so the caller joins it in before building.
 */
export type BreakdownTransaction = Pick<
  TransactionRow,
  | 'id'
  | 'category'
  | 'amountMinorUnits'
  | 'mcc'
  | 'counterIban'
  | 'description'
  | 'exchangeCounterpartHoldingId'
  | 'changeGroupId'
> & {
  currency: HoldingRow['currency'];
};

/**
 * One pie slice of spending. `amount` is the category's total SPENDING in the
 * BASE currency's minor units (a positive magnitude, so the legend can rebuild a
 * `Money`); `share` is that amount over the total of all returned slices, in
 * `[0, 1]`. `key` is the stable category slug; `title`/`icon` are its resolved
 * display; `color` is the category's stored color when set, else its stable
 * categorical-palette hue (see resolveCategoryColor).
 */
export type CategorySlice = {
  key: string;
  title: string;
  icon: string;
  amount: number;
  share: number;
  color: string;
};

/**
 * The stable palette hue for a category. A category MAY carry a stored color
 * (`categories.color` — see `schema.ts`), but when it does not, a category's
 * swatch is drawn deterministically from the shared `chartSeries` categorical
 * palette by hashing its key. The same key always lands on the same hue,
 * regardless of which other categories are present, so an uncolored slice's
 * color stays put as the filter toggles other categories in and out. See
 * `resolveCategoryColor` below for how a stored color, when present, wins over
 * this fallback.
 */
export const categoryColor = (key: string): string => {
  const chartSeries = chartSeriesDark;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }

  return chartSeries[hash % chartSeries.length];
};

/**
 * A category's EFFECTIVE chart color — the category analog of resolveEntityColor
 * (design-system/entity-tint.ts). A stored `#RRGGBB` hex wins; otherwise fall
 * back to the stable per-key palette hash, so an uncolored category renders
 * exactly as it did before category colors existed. Guards a stored empty string
 * (which `??` would let through and a bad hex would leak downstream) the same way
 * resolveEntityColor does.
 */
export const resolveCategoryColor = (
  storedColor: string | null | undefined,
  key: string,
): string =>
  typeof storedColor === 'string' && /^#[0-9a-f]{6}$/i.test(storedColor)
    ? storedColor
    : categoryColor(key);

// The normalized grouping key for a transaction's category: lowercased, with a
// null/empty category AND a slug the display map cannot resolve both folding
// into the DEFAULT category key. This is the same fold `resolveCategoryKey`
// (categories/category-display.ts) applies for Home's filter chips — keeping an
// unresolvable slug as its own bucket produced several wedges all labelled with
// the default's title, in different palette hues, because
// `resolveCategoryDisplay` had already folded the TITLE while this kept the KEY.
// One fold, one place.
const groupKey = (
  category: string | null,
  byKey: ReadonlyMap<string, CategoryDisplay>,
  defaultKey: string,
): string => resolveCategoryKey(category, byKey, defaultKey);

// Sum the POSITIVE change-returns per group so a split payment's category is
// netted by its change. Returns are same-currency as their payment for v1,
// so this sums raw minor units in the payment's own currency.
// Shared shape with category-trend's own per-group return sum.
export const sumReturnsByGroup = (
  transactions: readonly Pick<BreakdownTransaction, 'changeGroupId' | 'amountMinorUnits'>[],
): Map<string, number> => {
  const returnsByGroup = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.changeGroupId != null && transaction.amountMinorUnits > 0) {
      const running = returnsByGroup.get(transaction.changeGroupId) ?? 0;
      returnsByGroup.set(transaction.changeGroupId, running + transaction.amountMinorUnits);
    }
  }

  return returnsByGroup;
};

// A payment's spend magnitude (positive minor units) after subtracting its own
// group's summed positive returns. A non-split row (`changeGroupId` nullish —
// `null` or `undefined`) nets nothing, so its magnitude is the bare
// `-amountMinorUnits`. Shared shape with category-trend's own netting.
export const netMagnitudeOf = (
  transaction: Pick<BreakdownTransaction, 'changeGroupId' | 'amountMinorUnits'>,
  returnsByGroup: ReadonlyMap<string, number>,
): number => {
  const returned =
    transaction.changeGroupId != null ? (returnsByGroup.get(transaction.changeGroupId) ?? 0) : 0;

  return -transaction.amountMinorUnits - returned;
};

/**
 * Build one pie slice per spending category for the "Spending by Category"
 * chart. Only EXPENSES count: a transaction with a negative `amountMinorUnits`
 * is spending (its magnitude is added), while a non-negative amount (income or a
 * zero adjustment) is ignored entirely. Each expense is converted to the base
 * currency at the current `rateTable`; the guard silently drops any transaction
 * whose currency has no rate (so one unconvertible row never voids its
 * category). Categories listed in `excludedCategories` are dropped before the
 * shares are computed, so the visible slices always reshare to ~1. Individual
 * rows listed in `excludedTransactionIds` (e.g. the debit leg of an internal
 * transfer — the credit leg is already ignored as income) are dropped by id. A
 * null/empty category — or one whose slug `categoryDisplay` cannot resolve —
 * folds into `defaultCategoryKey` (a `categories.key` read from settings at the
 * call site, never hardcoded here), so uncategorized spending merges into the
 * default's slice. Empty categories are excluded and the rest are sorted by
 * amount descending.
 */
export const buildCategoryBreakdown = (input: {
  transactions: BreakdownTransaction[];
  categoryDisplay: ReadonlyMap<string, CategoryDisplay>;
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  excludedCategories?: ReadonlySet<string>;
  excludedTransactionIds?: ReadonlySet<string>;
}): CategorySlice[] => {
  const {
    transactions,
    categoryDisplay,
    rateTable,
    baseCurrency,
    defaultCategoryKey,
    excludedCategories,
    excludedTransactionIds,
  } = input;
  const excluded = excludedCategories ?? new Set<string>();
  const excludedIds = excludedTransactionIds ?? new Set<string>();

  // Per category key: the running spend total (base minor units) plus a
  // representative raw category value, so the display resolves off the same key
  // the Home screen stored rather than a re-derived label.
  const totals = new Map<string, { amount: number; representative: string | null }>();
  const returnsByGroup = sumReturnsByGroup(transactions);

  for (const transaction of transactions) {
    if (transaction.amountMinorUnits >= 0) {
      continue;
    }
    if (excludedIds.has(transaction.id)) {
      continue;
    }
    if (!canConvert(transaction.currency, baseCurrency, rateTable)) {
      continue;
    }

    const key = groupKey(transaction.category, categoryDisplay, defaultCategoryKey);
    if (excluded.has(key)) {
      continue;
    }

    const netMagnitude = netMagnitudeOf(transaction, returnsByGroup);

    if (netMagnitude <= 0) {
      continue;
    }

    const spend = convert(
      Money.of(transaction.currency, netMagnitude),
      baseCurrency,
      rateTable,
    ).minorUnits;

    const entry = totals.get(key) ?? { amount: 0, representative: transaction.category };
    entry.amount += spend;
    totals.set(key, entry);
  }

  const slices = Array.from(totals.entries())
    .map(([key, { amount, representative }]) => {
      const display = resolveCategoryDisplay(representative, categoryDisplay, defaultCategoryKey);

      return {
        key,
        title: display.title,
        icon: display.icon,
        amount,
        color: resolveCategoryColor(display.color, key),
      };
    })
    .filter((slice) => slice.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);

  return slices.map((slice) => {
    return { ...slice, share: total === 0 ? 0 : slice.amount / total };
  });
};
