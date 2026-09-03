import type { Currency } from '../currency/currency';

/**
 * One normalized historical rate point from a provider, before it is composed
 * into the stored UAH-anchored cross pairs. `day` is the UTC-midnight epoch-ms
 * of the rate's calendar day, matching `currency_rate_history.day`.
 */
export type HistoryRateEntry = {
  base: Currency;
  quote: Currency;
  day: number;
  rate: number;
  source: 'nbu' | 'coingecko';
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Floor an epoch-ms instant to the UTC midnight of its calendar day. Epoch 0 is
 * itself UTC midnight, so an integer floor of the day count is exact — this
 * never rounds up into the following day.
 */
export const toUtcMidnight = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;
