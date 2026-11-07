import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import type { BinancePendingRange, WalkId } from '@kiko/crypto-sync/exchange/walk-state';

/**
 * The window of each Bybit walk that the re-scan reads again behind the balance sync, and the span
 * the walk asks the route for: one source for the walk and for the caption.
 */
export const BYBIT_RESCAN_WINDOWS_MS = {
  capital: 29 * DAY_MS,
  transfer: 7 * DAY_MS,
  log: 7 * DAY_MS,
} as const;

const windowOf = (walkId: WalkId): number | undefined =>
  match(walkId)
    .with('capital', 'transfer', 'log', (id) => BYBIT_RESCAN_WINDOWS_MS[id])
    .otherwise(() => undefined);

/**
 * Whether a range lies in ground the forward pass read whole and the re-scan reads again by
 * design: a range in every series, wholly inside `[syncedAt - window, cursor]`. "Not imported
 * yet" is false for it, so the caption skips it. The range stays stored, so the walk still reads
 * it. A range with a series (a stop) or a scope, and one older than the window, still owes.
 */
export const isBybitRescannedRange = (
  walkId: WalkId,
  ground: BinancePendingRange,
  cursor: number | null,
  syncedAt: number | null,
): boolean => {
  const windowMs = windowOf(walkId);

  return (
    ground.kind !== 'point' &&
    ground.series === undefined &&
    ground.scope === undefined &&
    windowMs !== undefined &&
    cursor !== null &&
    syncedAt !== null &&
    ground.start >= syncedAt - windowMs &&
    ground.end <= cursor
  );
};
