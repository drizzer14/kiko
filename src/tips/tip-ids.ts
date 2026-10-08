export const TIP_IDS = [
  'accountDetail.importStatement',
  'settings.categories',
  'transaction.applyToAll',
] as const;

export type TipId = (typeof TIP_IDS)[number];

// A removed tip's id stays here forever so it is never reused for a different tip: a stored
// dismissal of the old tip would otherwise silently hide the new one.
export const RETIRED_TIP_IDS: readonly string[] = [];

export const isTipId = (value: string): value is TipId => TIP_IDS.some((id) => id === value);

// Stored ids come from a column an older or newer build also writes, so an id this build does
// not know is dropped rather than trusted.
export const dismissedTipIds = (stored: readonly string[]): ReadonlySet<TipId> =>
  new Set(stored.filter(isTipId));
