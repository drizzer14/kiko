import type { Money } from '../../currency/money';
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

/** A holding as `pricedValue` needs it — every real holding row has an `id`. */
export type PricedHolding = Pick<HoldingRow, 'type' | 'currency' | 'metadata' | 'id'>;

/**
 * A priced holding's value, as Money, at `instant`'s local day. Dispatches to
 * the holding's own descriptor's `priced` spec through `pricedValueOrNull`
 * (`holding-descriptor/priced-parts`), which runs NO id guard of its own —
 * `property_item` reads its own `holding:<id>` instrument and guards a
 * missing id itself, `metal` reads the shared `metal:<XAU|XAG|XPT|XPD>`
 * instrument (kiko-pricing) and needs no id at all. `null` for a non-priced
 * type, a `property_item` missing its `id`, invalid metadata, or no stored
 * price point yet — the caller falls back to the lots' cost basis, never 0.
 */
export const pricedValue = (
  holding: PricedHolding,
  book: PriceBook,
  instant: number,
): Money | null =>
  pricedValueOrNull(
    holdingDescriptorOrUndefined(holding.type)?.priced ?? null,
    holding,
    book,
    instant,
  );
