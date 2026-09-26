import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { holdingsRepo } from '@kiko/holdings/repo';
import { costBasisMinorAt } from '@kiko/holdings/lots';
import type { PriceBook } from '@kiko/prices/price-book';
import type { PricedHolding } from '@kiko/holdings/priced-value';
import { ownedMoney, WHOLE_SHARE } from '@kiko/holdings/ownership';
import type { ValuableHolding } from '@kiko/holdings/holding-value';

import { flat, type HoldingValueBreakdown } from '../breakdown-parts';
import type { HoldingDescriptor, PricedSpec } from '../holding-descriptor.d';

/** Dispatches to the spec's own `value`, or `null` when there is no spec. */
const pricedValueOrNull = (
  spec: PricedSpec | null,
  holding: PricedHolding,
  book: PriceBook,
  instant: number,
): Money | null => foldMap(maybe(spec), (found) => found.value(holding, book, instant)) ?? null;

/** The whole asset's value and cost basis, before any ownership share. */
type PricedWholeParts = { value: Money; cost: Money };

/**
 * The whole asset's value and cost basis at `now`, or null when the metadata
 * has no lots. Falls back to `costBasisMinorAt` when the priced value is
 * null, or when its currency disagrees with `holding.currency` (an
 * invalid/restore-only row) — never surfaced under the wrong currency label.
 */
export const pricedWholeParts = (
  spec: PricedSpec,
  holding: ValuableHolding,
  now: number,
  book: PriceBook,
): PricedWholeParts | null => {
  const lots = spec.lots(holding.metadata);

  if (lots === undefined) {
    return null;
  }
  const { currency } = holding;
  const cost = Money.of(currency, costBasisMinorAt(lots, now));
  const pricedMoney = pricedValueOrNull(spec, holding, book, now);
  const usesPricedMoney = pricedMoney !== null && pricedMoney.currency === currency;

  return { value: usesPricedMoney ? pricedMoney : cost, cost };
};

// `principalOrCost` is always the cost basis; interest/tax stay zero. The
// value and the cost are each the whole asset's scaled once by the share
// owned at `now`, so the gain is the owned gain.
const pricedBreakdown = (
  spec: PricedSpec,
  holding: ValuableHolding,
  now: number,
  book: PriceBook,
): HoldingValueBreakdown => {
  const whole = pricedWholeParts(spec, holding, now, book);

  if (whole === null) {
    return flat(holding.currency, holdingsRepo.balanceOf(holding).minorUnits);
  }
  const share = spec.share?.(holding.metadata, now) ?? WHOLE_SHARE;
  const value = ownedMoney(whole.value, share);
  const zero = Money.of(holding.currency, 0);

  return {
    gross: value,
    principalOrCost: ownedMoney(whole.cost, share),
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
