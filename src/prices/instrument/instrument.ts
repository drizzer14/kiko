// The `price_points.instrument` key format: one string namespace per priced
// thing, so a share, a metal, and a directly-priced holding can never
// collide in the same table. `src/db/schema.ts`'s `pricePoints` table comment
// documents the three prefixes this module is the single source of truth for.

/** A publicly-traded share, keyed by its ticker symbol. */
export const shareInstrument = (symbol: string): string => `share:${symbol}`;

/** A precious metal (e.g. gold, silver), keyed by its slug. */
export const metalInstrument = (metal: string): string => `metal:${metal}`;

/** A holding priced directly (not through a share/metal), keyed by its id. */
export const holdingInstrument = (holdingId: string): string => `holding:${holdingId}`;
