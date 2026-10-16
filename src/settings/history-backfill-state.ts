import { isRecord } from '@kiko/type-guards';
import { bifoldr, eitherSync } from 'fnts/either';
import { type Currency, isCurrency } from '@kiko/currency/currency';

/**
 * A currency whose history was fetched from `start` (a UTC-midnight day, the span start the
 * request began at) and whose provider answered from `firstDay` on, or with nothing at all
 * (`firstDay` null). The provider has no day before `firstDay`, so asking again for a start at or
 * after `start` would answer the same way. A start before `start` is a new question, and rows
 * stored from a day after `firstDay` (a restore can bring them) mean the days are missing.
 */
export type SettledMark = { start: number; firstDay: number | null };

export type SettledHistory = Partial<Record<Currency, SettledMark>>;

/**
 * What the history backfill keeps between launches, in `settings.historyBackfillState`.
 *
 * - `cursor`: the code of the coin the next run starts requesting crypto history with.
 * - `settled`: the marks above, per fiat currency and per coin.
 */
export type HistoryBackfillState = {
  cursor: string | null;
  settled: SettledHistory;
};

export const EMPTY_HISTORY_BACKFILL_STATE: HistoryBackfillState = { cursor: null, settled: {} };

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const settledOf = (value: unknown): SettledHistory => {
  const settled: SettledHistory = {};

  if (!isRecord(value)) {
    return settled;
  }

  for (const [code, mark] of Object.entries(value)) {
    if (isCurrency(code) && isRecord(mark) && finiteNumber(mark.start)) {
      settled[code] = {
        start: mark.start,
        firstDay: finiteNumber(mark.firstDay) ? mark.firstDay : null,
      };
    }
  }

  return settled;
};

/**
 * Reads the stored text. A bare coin code is a cursor stored before the marks joined it;
 * anything unreadable is dropped, as a cursor that is lost only costs the rotation and a mark
 * that is lost only costs one more request.
 */
export const parseHistoryBackfillState = (stored: string | null): HistoryBackfillState => {
  if (stored === null) {
    return EMPTY_HISTORY_BACKFILL_STATE;
  }

  if (!stored.startsWith('{')) {
    return { cursor: stored, settled: {} };
  }

  const parsed = bifoldr(eitherSync<unknown, unknown>(() => JSON.parse(stored)));

  if (!isRecord(parsed)) {
    return EMPTY_HISTORY_BACKFILL_STATE;
  }

  return {
    cursor: typeof parsed.cursor === 'string' ? parsed.cursor : null,
    settled: settledOf(parsed.settled),
  };
};

/** The text to store: null when there is nothing to keep. */
export const serializeHistoryBackfillState = (state: HistoryBackfillState): string | null =>
  state.cursor === null && Object.keys(state.settled).length === 0
    ? null
    : JSON.stringify({ cursor: state.cursor, settled: state.settled });
