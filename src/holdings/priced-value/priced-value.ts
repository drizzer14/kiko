import type { HoldingRow } from '../../db/schema';

/** A holding a priced spec's `value` needs — every real holding row has an `id`. */
export type PricedHolding = Pick<HoldingRow, 'type' | 'currency' | 'metadata' | 'id'>;
