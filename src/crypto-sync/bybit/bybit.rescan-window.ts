import { DAY_MS } from '@kiko/dates';
import type { BinancePendingRange, WalkId } from '@kiko/crypto-sync/exchange/walk-state';

const SECOND_MS = 1_000;

/**
 * The window of each Bybit walk that the re-scan reads again behind the balance sync, and the span
 * the walk asks the route for: one source for the walk and for the caption.
 */
export const BYBIT_RESCAN_WINDOWS_MS = {
  capital: 29 * DAY_MS,
  transfer: 7 * DAY_MS,
  log: 7 * DAY_MS,
  // The ledger rounds each bound out to a whole second, so a span of 7 days less a second sends
  // at most 7 days, the most the route accepts.
  fundingLedger: 7 * DAY_MS - SECOND_MS,
} as const;

const WINDOW_OF: Record<WalkId, number | undefined> = {
  ...BYBIT_RESCAN_WINDOWS_MS,
  pay: undefined,
  earn: undefined,
  convert: undefined,
  p2p: undefined,
  fiatOrders: undefined,
  fiatPayments: undefined,
};

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
  const windowMs = WINDOW_OF[walkId];

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
