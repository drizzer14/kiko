import { DAY_MS } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';
import type { ParsedKeyExpiry } from '@kiko/crypto-sync/exchange/walk-state';

/** A key ends "soon" when it has this many days or fewer left. */
const NEAR_DAYS = 14;

type BybitKeyExpiryState =
  | { state: 'far'; endsAtMs: number }
  | { state: 'near'; endsAtMs: number; daysLeft: number }
  | { state: 'expired'; endsAtMs: number }
  | { state: 'unknown' };

/**
 * The end of the key. The stored end wins; the days left at the read stand in only when no end
 * is stored. An end at or before the epoch, and a count of days that is not above zero, are
 * Bybit's "no date" (its sample shows -2 days with an end at the epoch), so they read as none.
 */
const endsAtMsOf = ({
  expiredAtMs,
  deadlineDay,
  readAtMs,
}: ParsedKeyExpiry): number | undefined => {
  if (expiredAtMs !== undefined && expiredAtMs > 0) {
    return expiredAtMs;
  }

  return deadlineDay !== undefined && deadlineDay > 0 && readAtMs !== undefined
    ? readAtMs + deadlineDay * DAY_MS
    : undefined;
};

/**
 * Which of the four states the stored end puts the key in at `now`. The state comes from the
 * clock and the stored end alone: a refusal that names the cause reaches the user through the
 * failure text of the sync that met it, since a failed sync writes nothing here.
 */
export const keyExpiryStateOf = (
  stored: ParsedKeyExpiry | undefined,
  now: number,
): BybitKeyExpiryState => {
  const endsAtMs = foldMap(maybe(stored), endsAtMsOf);

  if (endsAtMs === undefined) {
    return { state: 'unknown' };
  }

  if (now >= endsAtMs) {
    return { state: 'expired', endsAtMs };
  }

  const daysLeft = Math.ceil((endsAtMs - now) / DAY_MS);

  return daysLeft <= NEAR_DAYS ? { state: 'near', endsAtMs, daysLeft } : { state: 'far', endsAtMs };
};
