import { isRecord } from '@kiko/type-guards';
import { bifoldr, eitherSync } from 'fnts/either';
import { type Currency, isCurrency } from '@kiko/currency/currency';

/**
 * What the history backfill keeps between launches, in `settings.historyBackfillState`.
 *
 * - `cursor`: the code of the coin the next run starts requesting crypto history with.
 * - `settledFrom`: per fiat currency, the span start (a UTC-midnight day) its history was fetched
 *   from without finding an earlier day. NBU started quoting such a currency later than the span
 *   starts, so asking again for the same start would answer the same way.
 */
export type HistoryBackfillState = {
  cursor: string | null;
  settledFrom: Partial<Record<Currency, number>>;
};

export const EMPTY_HISTORY_BACKFILL_STATE: HistoryBackfillState = { cursor: null, settledFrom: {} };

const settledFromOf = (value: unknown): HistoryBackfillState['settledFrom'] => {
  const settledFrom: HistoryBackfillState['settledFrom'] = {};

  if (!isRecord(value)) {
    return settledFrom;
  }

  for (const [code, day] of Object.entries(value)) {
    if (isCurrency(code) && typeof day === 'number' && Number.isFinite(day)) {
      settledFrom[code] = day;
    }
  }

  return settledFrom;
};

/**
 * Reads the stored text. A bare coin code is a cursor stored before the settled span starts
 * joined it; anything unreadable is dropped, as a cursor that is lost only costs the rotation.
 */
export const parseHistoryBackfillState = (stored: string | null): HistoryBackfillState => {
  if (stored === null) {
    return EMPTY_HISTORY_BACKFILL_STATE;
  }

  if (!stored.startsWith('{')) {
    return { cursor: stored, settledFrom: {} };
  }

  const parsed = bifoldr(eitherSync<unknown, unknown>(() => JSON.parse(stored)));

  if (!isRecord(parsed)) {
    return EMPTY_HISTORY_BACKFILL_STATE;
  }

  return {
    cursor: typeof parsed.cursor === 'string' ? parsed.cursor : null,
    settledFrom: settledFromOf(parsed.settledFrom),
  };
};

/** The text to store: null when there is nothing to keep. */
export const serializeHistoryBackfillState = (state: HistoryBackfillState): string | null =>
  state.cursor === null && Object.keys(state.settledFrom).length === 0
    ? null
    : JSON.stringify({ cursor: state.cursor, settledFrom: state.settledFrom });
