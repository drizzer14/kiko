import type { HoldingRow } from '../../db/schema';
import type { HoldingType } from '../holding-type';
import { holdingDescriptorOrUndefined } from '../holding-descriptor';

/** A holding a priced spec's `value` needs — every real holding row has an `id`. */
export type PricedHolding = Pick<HoldingRow, 'type' | 'currency' | 'metadata' | 'id'>;

/**
 * Whether a holding TYPE ever reads `price_points` at all — a priced type
 * (`property_item`/`metal`, whose own descriptor's `priced` spec is
 * non-null) OR `loan` (not priced, `priced: null`, but its own
 * `holding:<id>` manual-correction series is read the same way,
 * kiko-pricing's "Priced holdings" section — an explicit exception, not a
 * pattern gap). Gates `usePriceBook`'s `enabled` argument
 * (kiko-architecture): a screen showing no holding of any of these types
 * never needs the `price_points` read.
 */
export const needsPriceBook = (type: HoldingType): boolean => {
  const priced = holdingDescriptorOrUndefined(type)?.priced;

  return (priced !== undefined && priced !== null) || type === 'loan';
};
