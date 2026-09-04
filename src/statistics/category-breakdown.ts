import { resolveCategoryDisplay } from '../categories/category-display';
import type { Currency } from '../currency/currency';
import { Money } from '../currency/money';
import type { HoldingRow, TransactionRow } from '../db/schema';
import { darkTheme } from '../design-system/theme';
import { convert, type RateTable } from '../rates/conversion';
import { canConvert } from '../rates/net-worth-view';

// The grouping key a null/empty category folds into. Kept distinct from any real
// category slug so uncategorized spending is one stable slice (and one stable
// color) rather than scattering.
const UNCATEGORIZED_KEY = 'uncategorized';

const { chartSeries } = darkTheme.colors;

/**
 * A transaction as the spending breakdown needs it: its stored `category` key,
 * its signed `amountMinorUnits`, and the currency those minor units are in. The
 * amount's currency is the parent HOLDING's currency (a transaction row has no
 * currency of its own), so the caller joins it in before building.
 */
export type BreakdownTransaction = Pick<TransactionRow, 'category' | 'amountMinorUnits'> & {
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

// The normalized grouping key for a transaction's category: lowercased to match
// `resolveCategoryDisplay`'s own lookup convention, with null/empty folding into
// the shared uncategorized bucket.
const groupKey = (category: string | null): string => category?.toLowerCase() || UNCATEGORIZED_KEY;

/**
 * Build one pie slice per spending category for the "Spending by Category"
 * chart. Only EXPENSES count: a transaction with a negative `amountMinorUnits`
 * is spending (its magnitude is added), while a non-negative amount (income or a
 * zero adjustment) is ignored entirely. Each expense is converted to the base
 * currency at the current `rateTable`; the guard silently drops any transaction
 * whose currency has no rate (so one unconvertible row never voids its
 * category). Categories listed in `excludedCategories` are dropped before the
 * shares are computed, so the visible slices always reshare to ~1. Empty
 * categories are excluded and the rest are sorted by amount descending.
 */
export const buildCategoryBreakdown = (input: {
  transactions: BreakdownTransaction[];
  categoryDisplay: ReadonlyMap<string, { title: string; icon: string; color: string | null }>;
  rateTable: RateTable;
  baseCurrency: Currency;
  excludedCategories?: ReadonlySet<string>;
}): CategorySlice[] => {
  const { transactions, categoryDisplay, rateTable, baseCurrency, excludedCategories } = input;
  const excluded = excludedCategories ?? new Set<string>();

  // Per category key: the running spend total (base minor units) plus a
  // representative raw category value, so the display resolves off the same key
  // the Home screen stored rather than a re-derived label.
  const totals = new Map<string, { amount: number; representative: string | null }>();

  for (const transaction of transactions) {
    if (transaction.amountMinorUnits >= 0) {
      continue;
    }
    if (!canConvert(transaction.currency, baseCurrency, rateTable)) {
      continue;
    }

    const key = groupKey(transaction.category);
    if (excluded.has(key)) {
      continue;
    }

    const spend = convert(
      Money.of(transaction.currency, -transaction.amountMinorUnits),
      baseCurrency,
      rateTable,
    ).minorUnits;

    const entry = totals.get(key) ?? { amount: 0, representative: transaction.category };
    entry.amount += spend;
    totals.set(key, entry);
  }

  const slices = Array.from(totals.entries())
    .map(([key, { amount, representative }]) => {
      const display = resolveCategoryDisplay(representative, categoryDisplay);

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

  return slices.map((slice) => ({ ...slice, share: total === 0 ? 0 : slice.amount / total }));
};
