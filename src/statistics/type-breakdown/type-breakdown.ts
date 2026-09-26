import type { HoldingRow } from '@kiko/db';
import { holdingDescriptor } from '@kiko/holdings/holding-descriptor';

import { Money } from '../../currency/money';
import { canConvert } from '../../rates/net-worth-view';
import type { Currency } from '../../currency/currency';
import { holdingValue } from '../../holdings/holding-value';
import { convert, type RateTable } from '../../rates/conversion';
import { EMPTY_PRICE_BOOK, type PriceBook } from '../../prices/price-book';
import { type HoldingType, holdingTypes } from '../../holdings/holding-type';

/** A holding as the by-type bar needs it: its type plus its convertible value. */
export type BreakdownHolding = Pick<
  HoldingRow,
  'type' | 'currency' | 'balanceMinorUnits' | 'metadata' | 'id'
>;

/**
 * One bar: a holding type and its total current value in the BASE currency's
 * minor units (so the bar's label can rebuild a `Money`), matching the account
 * pie's minor-unit `amount` convention.
 */
export type TypeSlice = { type: HoldingType; amount: number };

/**
 * Build one entry per holding TYPE for the by-type bar chart. Each type's value
 * is the sum of the CURRENT value of all its holdings converted to the base
 * currency at the current `rateTable`; the guard silently drops any holding with
 * no rate (so one unconvertible holding never voids the rest of its type).
 * Types that total zero — including those whose only holdings are unconvertible —
 * are excluded, and the remaining entries are sorted by amount descending.
 *
 * A debt-side type (only `loan` today — `holdingDescriptor(type).side`) is
 * excluded outright: this bar is an ASSET breakdown, and a debt's own held
 * value is NEGATIVE (`holding-value.ts`), so it has its own
 * "Debts" total elsewhere on Statistics (`buildDebtTotal`,
 * `account-contribution.ts`) rather than showing up here as a negative bar.
 * The bar is assets-only PER HOLDING, the same rule `buildAccountContribution`'s
 * pie already follows: a NON-loan holding in debit (e.g. a credit card) is
 * dropped BEFORE the per-type sum, not netted into it — it can never reduce
 * a positive holding of the same type, only ever be absent.
 */
export const buildTypeBreakdown = (input: {
  holdings: BreakdownHolding[];
  rateTable: RateTable;
  baseCurrency: Currency;
  now: number;
  book?: PriceBook;
}): TypeSlice[] => {
  const { holdings, rateTable, baseCurrency, now, book = EMPTY_PRICE_BOOK } = input;

  return holdingTypes
    .filter((type) => holdingDescriptor(type).side === 'asset')
    .map((type) => {
      const total = holdings
        .filter(
          (holding) =>
            holding.type === type && canConvert(holding.currency, baseCurrency, rateTable),
        )
        .map((holding) => convert(holdingValue(holding, now, book), baseCurrency, rateTable))
        .filter((money) => money.minorUnits > 0)
        .reduce((sum, money) => sum.add(money), Money.of(baseCurrency, 0));

      return { type, amount: total.minorUnits };
    })
    .filter((slice) => slice.amount > 0)
    .sort((a, b) => b.amount - a.amount);
};
