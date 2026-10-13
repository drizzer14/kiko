import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_EARN_HISTORY_CURSOR_FIELD,
  BINANCE_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  BINANCE_TRANSFER_HISTORY_CURSOR_FIELD,
  binanceWalkCursorOf,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';

/** The forward cursor of each history walk: capital, Pay, Transfer and Earn. */
const WALK_CURSOR_FIELDS = [
  BINANCE_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  BINANCE_TRANSFER_HISTORY_CURSOR_FIELD,
  BINANCE_EARN_HISTORY_CURSOR_FIELD,
] as const;

/**
 * The four walks' forward watermarks among an account's holdings. Every walk keeps its marks on
 * the Spot holding, which is the one that carries the capital cursor, so a plain scan for it
 * avoids hard-coding the Spot match key here too. A walk that has not written its cursor yet
 * reads as null; an account with no capital cursor at all reads as four nulls.
 */
export const walkCursorsOf = (holdings: Pick<HoldingRow, 'metadata'>[]): (number | null)[] => {
  const carrier = holdings.find(
    (holding) => binanceWalkCursorOf(BINANCE_HISTORY_CURSOR_FIELD, holding.metadata) !== null,
  );

  return WALK_CURSOR_FIELDS.map(
    (field) =>
      foldMap(maybe(carrier), (found) => binanceWalkCursorOf(field, found.metadata)) ?? null,
  );
};

/**
 * True when a Binance history walk is meaningfully behind the account's own balance sync: any
 * walk that never caught up (a `null` cursor), or lags by more than a day. An owed point does
 * not count: the caption is about the walks being behind, and a record the walk keeps owed is
 * read again on every sync. `lastBalanceSyncAt === null` (the account has never synced) is never
 * "behind": there's nothing yet to compare the history against, so the caption would be noise
 * before the very first sync.
 */
export const isBinanceHistoryBehind = (input: {
  cursors: readonly (number | null)[];
  lastBalanceSyncAt: number | null;
}): boolean => {
  const { cursors, lastBalanceSyncAt } = input;

  return (
    lastBalanceSyncAt !== null &&
    cursors.some((cursor) => cursor === null || lastBalanceSyncAt - cursor > DAY_MS)
  );
};
