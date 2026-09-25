import { match } from 'ts-pattern';

import type { HoldingRow } from '../../db/schema';
import type { HoldingType } from '../holding-type';
import type { PriceBook } from '../../prices/price-book';
import { metalDescriptor } from '../holding-descriptor/metal';
import { pricedValueOrNull } from '../holding-descriptor/priced-parts';
import { propertyItemDescriptor } from '../holding-descriptor/property-item';

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

/**
 * A priced holding's value, in minor units, at `instant`'s local day.
 * Dispatches to the holding's own descriptor's `priced` spec — `property_item`
 * reads its own `holding:<id>` instrument, `metal` the shared
 * `metal:<XAU|XAG|XPT|XPD>` instrument (kiko-pricing) — through the ONE
 * shared id guard (`pricedValueOrNull`, `holding-descriptor/priced-parts`).
 * `null` for a non-priced type, a holding missing its `id`, invalid metadata,
 * or no stored price point yet — the caller falls back to the lots' cost
 * basis, never 0 (Review Focus 5).
 */
export const pricedValueMinor = (
  holding: PricedHolding,
  book: PriceBook,
  instant: number,
): number | null =>
  match(holding.type)
    .with('property_item', () =>
      pricedValueOrNull(propertyItemDescriptor.priced, holding, book, instant),
    )
    .with('metal', () => pricedValueOrNull(metalDescriptor.priced, holding, book, instant))
    .otherwise(() => null);
