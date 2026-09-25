import maybe, { foldMap } from 'fnts/maybe';

import { costBasisMinorAt } from '../../lots';
import { Money } from '../../../currency/money';
import type { PricedHolding } from '../../priced-value';
import type { PricedSpec } from '../holding-descriptor.d';
import type { ValuableHolding } from '../../holding-value';
import type { PriceBook } from '../../../prices/price-book';
import { flat, type HoldingValueBreakdown } from '../breakdown-parts';

const isIdentifiedPricedHolding = (
  holding: PricedHolding,
): holding is PricedHolding & { id: string } => holding.id !== undefined;

/**
 * The id guard every PriceBook-valued type shares, ahead of its own
 * `valueMinor`: a holding with no `id` cannot resolve its own price-book
 * instrument key, so it reads as having no stored price point, the same as
 * one with invalid metadata. Kept in this ONE place so every priced type
 * runs the guard identically.
 */
export const pricedValueOrNull = (
  spec: PricedSpec | null,
  holding: PricedHolding,
  book: PriceBook,
  instant: number,
): number | null => {
  if (!isIdentifiedPricedHolding(holding)) {
    return null;
  }
  return foldMap(maybe(spec), (found) => found.valueMinor(holding, book, instant)) ?? null;
};

// A priced holding's gross/net are its `pricedValueOrNull` (a `PriceBook`
// lookup), falling back to its lots' cost basis when there is no stored price
// point yet — never 0. `principalOrCost` is ALWAYS the cost basis (not the
// priced value), so the holding-detail breakdown can show a live gain/loss
// against it. It never accrues interest or withholds tax, so both stay zero.
export const pricedBreakdown = (
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
