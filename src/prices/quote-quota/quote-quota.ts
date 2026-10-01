import type { UserLimits } from '../eodhd';

const DAY_MS = 24 * 60 * 60 * 1000;
// The free EODHD plan, until the key's own limit is read on save.
const DEFAULT_DAILY_LIMIT = 20;
// A share search is the user waiting on a sheet; a refresh can wait a day.
const SEARCH_RESERVE = 2;

/**
 * The EODHD calls spent on one `day`: a UTC-midnight day, because EODHD resets
 * its daily limit at midnight GMT, not on the device's day. `symbols` are the
 * symbols already requested that day, so a symbol costs at most one refresh
 * per day even when its answer brought no new close.
 */
export type QuoteQuota = { day: number; calls: number; dailyLimit: number; symbols: string[] };

const utcDayOf = (instant: number): number => Math.floor(instant / DAY_MS) * DAY_MS;

export const currentQuota = (stored: QuoteQuota | null, now: number): QuoteQuota => {
  const day = utcDayOf(now);

  if (stored?.day === day) {
    return stored;
  }

  return { day, calls: 0, dailyLimit: stored?.dailyLimit ?? DEFAULT_DAILY_LIMIT, symbols: [] };
};

export const refreshAllowance = (quota: QuoteQuota): number =>
  Math.max(0, quota.dailyLimit - SEARCH_RESERVE - quota.calls);

export const reserve = (quota: QuoteQuota, calls: number, symbols: string[]): QuoteQuota => ({
  ...quota,
  calls: quota.calls + calls,
  symbols: [...quota.symbols, ...symbols],
});

export const markUsedUp = (quota: QuoteQuota): QuoteQuota => ({
  ...quota,
  calls: Math.max(quota.calls, quota.dailyLimit),
});

/**
 * EODHD's own count wins over the local one: the same key can spend calls in
 * another app. Its count applies only when EODHD's day is today's UTC day.
 */
export const withUserLimits = (
  stored: QuoteQuota | null,
  limits: UserLimits,
  now: number,
): QuoteQuota => {
  const quota = currentQuota(stored, now);

  return {
    ...quota,
    dailyLimit: limits.dailyLimit,
    calls: limits.requestsDay === quota.day ? limits.requestsToday : quota.calls,
  };
};
