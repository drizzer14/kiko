import maybe, { foldMap } from 'fnts/maybe';

import { costBasisMinorAt } from '../../lots';
import { Money } from '../../../currency/money';
import type { PricedHolding } from '../../priced-value';
import type { ValuableHolding } from '../../holding-value';
import type { PriceBook } from '../../../prices/price-book';
import { flat, type HoldingValueBreakdown } from '../breakdown-parts';
import type { HoldingDescriptor, PricedSpec } from '../holding-descriptor.d';

/**
 * Dispatches to the spec's own `valueMinor` with no id guard here: whether a
 * missing `id` matters is per-spec — `property_item` reads its own
 * `holding:<id>` instrument and must guard it itself, `metal` reads a SHARED
 * instrument and needs no id at all.
 */
export const pricedValueOrNull = (
  spec: PricedSpec | null,
  holding: PricedHolding,
  book: PriceBook,
  instant: number,
): number | null =>
  foldMap(maybe(spec), (found) => found.valueMinor(holding, book, instant)) ?? null;

// A priced holding's gross/net are its `pricedValueOrNull` (a `PriceBook`
// lookup), falling back to its lots' cost basis when there is no stored price
// point yet — never 0. `principalOrCost` is ALWAYS the cost basis (not the
// priced value), so the holding-detail breakdown can show a live gain/loss
// against it. It never accrues interest or withholds tax, so both stay zero.
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
  const valueMinor = pricedValueOrNull(spec, holding, book, now) ?? costBasisMinor;
  const zero = Money.of(currency, 0);

  return {
    gross: Money.of(currency, valueMinor),
    principalOrCost: Money.of(currency, costBasisMinor),
    interest: zero,
    tax: zero,
    net: Money.of(currency, valueMinor),
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
