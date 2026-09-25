import maybe, { foldMap } from 'fnts/maybe';

import { costBasisMinorAt } from '../../lots';
import { Money } from '../../../currency/money';
import type { PricedHolding } from '../../priced-value';
import type { ValuableHolding } from '../../holding-value';
import type { PriceBook } from '../../../prices/price-book';
import { flat, type HoldingValueBreakdown } from '../breakdown-parts';
import type { HoldingDescriptor, PricedSpec } from '../holding-descriptor.d';

/** Dispatches to the spec's own `value`, or `null` when there is no spec. */
const pricedValueOrNull = (
  spec: PricedSpec | null,
  holding: PricedHolding,
  book: PriceBook,
  instant: number,
): Money | null => foldMap(maybe(spec), (found) => found.value(holding, book, instant)) ?? null;

// Falls back to `costBasisMinorAt` when the priced value is null, or when its
// currency disagrees with `holding.currency` (an invalid/restore-only row) —
// never surfaced under the wrong currency label. `principalOrCost` is always
// the cost basis; interest/tax stay zero.
const pricedBreakdown = (
  spec: PricedSpec,
  holding: ValuableHolding,
  now: number,
  book: PriceBook,
): HoldingValueBreakdown => {
  const lots = spec.lots(holding.metadata);
  if (lots === undefined) {
    return flat(holding.currency, holding.balanceMinorUnits);
  }
  const { currency } = holding;
  const costBasisMinor = costBasisMinorAt(lots, now);
  const pricedMoney = pricedValueOrNull(spec, holding, book, now);
  const usesPricedMoney = pricedMoney !== null && pricedMoney.currency === currency;
  const value = usesPricedMoney ? pricedMoney : Money.of(currency, costBasisMinor);
  const zero = Money.of(currency, 0);

  return {
    gross: value,
    principalOrCost: Money.of(currency, costBasisMinor),
    interest: zero,
    tax: zero,
    net: value,
  };
};

/**
 * Builds a PriceBook-valued descriptor (`property_item`, `metal`) so its
 * `breakdown` is tied to its own `priced` spec BY CONSTRUCTION — a per-type
 * file can no longer pass a `priced` spec that its `breakdown` reads a
 * different one from.
 */
export const pricedDescriptor = (
  spec: PricedSpec,
  rest: Omit<HoldingDescriptor, 'priced' | 'breakdown'>,
): HoldingDescriptor => ({
  ...rest,
  priced: spec,
  breakdown: (holding, now, book) => pricedBreakdown(spec, holding, now, book),
});
