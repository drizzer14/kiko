import { DAY_MS } from '@kiko/dates';
import type { Currency } from '@kiko/currency/currency';

/**
 * One normalized historical rate point from a provider, before it is composed
 * into a stored `X:UAH` row. `day` is the UTC-midnight epoch-ms of the rate's
 * calendar day, matching `currency_rate_history.day`.
 */
export type HistoryRateEntry = {
  base: Currency;
  quote: Currency;
  day: number;
  rate: number;
  source: 'nbu' | 'coingecko' | 'binance';
};

/**
 * Floor an epoch-ms instant to the UTC midnight of its calendar day. Epoch 0 is
 * itself UTC midnight, so an integer floor of the day count is exact — this
 * never rounds up into the following day.
 */
export const toUtcMidnight = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * Resolve one anchor's rate for `day` from its ascending timeline, using the
 * nearest point AT OR BEFORE `day` (carry-forward across weekend/holiday gaps).
 */
export const nearestAtOrBefore = (
  timeline: HistoryRateEntry[],
  day: number,
): number | undefined => {
  let rate: number | undefined;

  for (const entry of timeline) {
    if (entry.day <= day) {
      rate = entry.rate;
    } else {
      break;
    }
  }

  return rate;
};

/**
 * Group anchor entries into ascending per-pair timelines, keyed `<base>:<quote>`, so each target
 * day can carry the nearest prior rate forward.
 */
export const groupTimelines = (entries: HistoryRateEntry[]): Map<string, HistoryRateEntry[]> => {
  const timelines = new Map<string, HistoryRateEntry[]>();

  for (const entry of entries) {
    const key = `${entry.base}:${entry.quote}`;
    const list = timelines.get(key) ?? [];
    list.push(entry);
    timelines.set(key, list);
  }

  for (const list of timelines.values()) {
    list.sort((a, b) => a.day - b.day);
  }

  return timelines;
};
