import { quantityAt } from '../lots';
import type { HoldingRow } from '../../db/schema';
import type { HoldingType } from '../holding-type';
import { asPropertyMeta } from '../holding-metadata';
import { holdingInstrument } from '../../prices/instrument';
import { multiplyToMinorUnits } from '../../currency/decimal';
import { priceAt, type PriceBook } from '../../prices/price-book';

/**
 * The holding types valued through the `PriceBook` rather than an interest
 * engine or a raw stored balance: currently only `property_item` (its value
 * is `quantityAt(lots, instant)` times the latest price point for its OWN
 * `holding:<id>` instrument — kiko-domain). T17/T26/T35 extend this set as
 * metals and shares land their own priced instrument namespaces.
 */
export const pricedHoldingTypes = ['property_item'] as const satisfies readonly HoldingType[];

export const isPricedHoldingType = (type: HoldingType): boolean =>
  (pricedHoldingTypes as readonly HoldingType[]).includes(type);

/**
 * A holding as `pricedValueMinor` needs it. `id` is optional (mirroring
 * `ValuableHolding` — `src/holdings/holding-value/`) so a synthetic test
 * fixture with no real row still type-checks; a holding with no `id` simply
 * cannot resolve its own `holding:<id>` instrument key, so it is treated the
 * same as one with no stored price point (null).
 */
export type PricedHolding = Pick<HoldingRow, 'type' | 'currency' | 'metadata'> & {
  id?: HoldingRow['id'];
};

/**
 * A priced holding's value, in minor units, at `instant`'s local day:
 * `quantityAt(lots, instant)` times the price point for the holding's own
 * `holding:<id>` instrument at or before that day (`priceAt` — Review Focus
 * 4's local-day convention). Returns `null` when the holding is missing its
 * `id`, carries no valid `lots` metadata, or has no stored price point yet —
 * Review Focus 5: the caller falls back to the lots' cost basis, never 0.
 */
export const pricedValueMinor = (
  holding: PricedHolding,
  book: PriceBook,
  instant: number,
): number | null => {
  if (holding.id === undefined) {
    return null;
  }

  const meta = asPropertyMeta(holding.metadata);

  if (meta === null) {
    return null;
  }

  const point = priceAt(book, holdingInstrument(holding.id), instant);

  if (point === undefined) {
    return null;
  }

  const quantity = quantityAt(meta.lots, instant);

  return multiplyToMinorUnits([quantity, point.price], holding.currency);
};
