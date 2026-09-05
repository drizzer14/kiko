import type { Currency } from '../currency/currency';
import { Money } from '../currency/money';
import type { HoldingRow } from '../db/schema';
import { type HoldingType, holdingTypes } from '../holdings/holding-type';
import { holdingValue } from '../holdings/holding-value';
import { convert, type RateTable } from '../rates/conversion';
import { canConvert } from '../rates/net-worth-view';

/** A holding as the by-type bar needs it: its type plus its convertible value. */
export type BreakdownHolding = Pick<
  HoldingRow,
  'type' | 'currency' | 'balanceMinorUnits' | 'metadata'
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
 */
export const buildTypeBreakdown = (input: {
  holdings: BreakdownHolding[];
  rateTable: RateTable;
  baseCurrency: Currency;
  now: number;
}): TypeSlice[] => {
  const { holdings, rateTable, baseCurrency, now } = input;

  return holdingTypes
    .map((type) => {
      const total = holdings
        .filter(
          (holding) =>
            holding.type === type && canConvert(holding.currency, baseCurrency, rateTable),
        )
        .reduce(
          (sum, holding) => sum.add(convert(holdingValue(holding, now), baseCurrency, rateTable)),
          Money.of(baseCurrency, 0),
        );

      return { type, amount: total.minorUnits };
    })
    .filter((slice) => slice.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
};
