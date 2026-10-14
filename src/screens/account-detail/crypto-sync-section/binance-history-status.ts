import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_EARN_HISTORY_CURSOR_FIELD,
  BINANCE_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  BINANCE_TRANSFER_HISTORY_CURSOR_FIELD,
  BINANCE_TRANSFER_PENDING_OVERLAP_FIELD,
  binanceWalkCursorOf,
  binanceWalkPendingOf,
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
 * Whether the Transfer walk owes a range, in every type or in one: ground its forward cursor has
 * passed and a later run still has to read (a type whose narrowing the run could not afford, an
 * edge band). An owed point is not a range: a record the walk keeps owed is read again on every
 * sync. A list that is not well formed owes nothing here; the walk repairs it on its next run.
 */
export const transferOwesRange = (holdings: Pick<HoldingRow, 'metadata'>[]): boolean => {
  const carrier = holdings.find(
    (holding) => binanceWalkCursorOf(BINANCE_HISTORY_CURSOR_FIELD, holding.metadata) !== null,
  );
  const owed = foldMap(maybe(carrier), (found) =>
    binanceWalkPendingOf(BINANCE_TRANSFER_PENDING_OVERLAP_FIELD, found.metadata),
  );

  return owed?.some((ground) => ground.kind !== 'point') ?? false;
};

/**
 * True when a Binance history walk is meaningfully behind the account's own balance sync: any
 * walk that never caught up (a `null` cursor), or lags by more than a day, or the Transfer walk
 * owes a range (`owesRange`, see `transferOwesRange`: its cursor has passed ground it has yet to
 * read). An owed point does not count: the caption is about the walks being behind, and a record
 * the walk keeps owed is read again on every sync. `lastBalanceSyncAt === null` (the account has
 * never synced) is never "behind": there's nothing yet to compare the history against, so the
 * caption would be noise before the very first sync.
 */
export const isBinanceHistoryBehind = (input: {
  cursors: readonly (number | null)[];
  lastBalanceSyncAt: number | null;
  owesRange?: boolean;
}): boolean => {
  const { cursors, lastBalanceSyncAt, owesRange = false } = input;

  return (
    lastBalanceSyncAt !== null &&
    (owesRange || cursors.some((cursor) => cursor === null || lastBalanceSyncAt - cursor > DAY_MS))
  );
};
