import { quantityAt } from '../lots';
import type { HoldingRow } from '../../db/schema';
import type { HoldingType } from '../holding-type';
import { asMetalMeta, asPropertyMeta } from '../holding-metadata';
import { holdingInstrument, metalInstrument } from '../../prices/instrument';
import { multiplyToMinorUnits } from '../../currency/decimal';
import { priceAt, type PriceBook } from '../../prices/price-book';

/**
 * The holding types valued through the `PriceBook` rather than an interest
 * engine or a raw stored balance: `property_item` (its value is
 * `quantityAt(lots, instant)` times the latest price point for its OWN
 * `holding:<id>` instrument) and `metal` (T17 — its value is priced through
 * the shared `metal:<XAU|XAG|XPT|XPD>` instrument, not a per-holding one —
 * kiko-domain). T26/T35 extend this set as shares land their own priced
 * instrument namespace.
 */
export const pricedHoldingTypes = [
  'property_item',
  'metal',
] as const satisfies readonly HoldingType[];

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

// One troy ounce in grams (NBU quotes precious metals per troy ounce). A
// 'g'-unit lot's quantity is converted to ounces by dividing by this constant
// inside `multiplyToMinorUnits`'s BigInt-backed division, never a float
// multiply; an 'oz'-unit lot needs no conversion.
const TROY_OUNCE_GRAMS = '31.1034768';

/**
 * A metal holding's value: `quantityAt(lots, instant)` times `purity` times
 * the price point for the metal's SHARED `metal:<XAU|XAG|XPT|XPD>` instrument
 * (not a per-holding one — every holding of the same metal reads the same
 * NBU-sourced points). Fixed to UAH regardless of `holding.currency` — NBU
 * quotes precious metals in UAH, so a metal holding's priced value is always
 * a UAH amount (T20 is expected to create every `metal` holding with
 * `currency: 'UAH'` to match). Returns `null` for invalid metadata or a
 * missing price point, same contract as the property branch below.
 */
const pricedMetalValueMinor = (
  metadata: HoldingRow['metadata'],
  book: PriceBook,
  instant: number,
): number | null => {
  const meta = asMetalMeta(metadata);

  if (meta === null) {
    return null;
  }

  const point = priceAt(book, metalInstrument(meta.metal), instant);

  if (point === undefined) {
    return null;
  }

  const quantity = quantityAt(meta.lots, instant);

  return multiplyToMinorUnits(
    [quantity, meta.purity, point.price],
    'UAH',
    meta.unit === 'g' ? TROY_OUNCE_GRAMS : undefined,
  );
};

/**
 * A priced holding's value, in minor units, at `instant`'s local day.
 * `property_item`: `quantityAt(lots, instant)` times the price point for the
 * holding's own `holding:<id>` instrument at or before that day (`priceAt` —
 * Review Focus 4's local-day convention). `metal` (T17): delegates to
 * `pricedMetalValueMinor` above — its instrument is the metal itself, not
 * the holding id. Returns `null` when the holding is missing its `id`,
 * carries no valid metadata for its type, or has no stored price point yet —
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

  if (holding.type === 'metal') {
    return pricedMetalValueMinor(holding.metadata, book, instant);
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
