import type { HoldingRow } from '../../db/schema';
import type { HoldingType } from '../holding-type';
import type { PriceBook } from '../../prices/price-book';
import { holdingDescriptorOrUndefined } from '../holding-descriptor';
import { pricedValueOrNull } from '../holding-descriptor/priced-parts';

/**
 * A type valued through the `PriceBook` rather than an interest engine or a
 * raw stored balance — one whose own descriptor carries a non-null `priced`
 * spec (`src/holdings/holding-descriptor/`).
 */
export const isPricedHoldingType = (type: HoldingType): boolean => {
  const priced = holdingDescriptorOrUndefined(type)?.priced;

  return priced !== undefined && priced !== null;
};

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
 * basis, never 0.
 */
export const pricedValueMinor = (
  holding: PricedHolding,
  book: PriceBook,
  instant: number,
): number | null =>
  pricedValueOrNull(
    holdingDescriptorOrUndefined(holding.type)?.priced ?? null,
    holding,
    book,
    instant,
  );
