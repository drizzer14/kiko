import { DAY_MS } from '@kiko/dates';

import type { UserLimits } from '../eodhd';

// The free EODHD plan, until the key's own limit is read on save.
const DEFAULT_DAILY_LIMIT = 20;
// A share search is the user waiting on a sheet; a refresh can wait a day.
const SEARCH_RESERVE = 2;

/**
 * The EODHD calls spent on one `day`: a UTC-midnight day, because EODHD resets
 * its daily limit at midnight GMT, not on the device's day. `symbols` are the
 * symbols already requested that day, so a symbol costs at most one refresh
 * per day even when its answer brought no new close. `isLimitUnconfirmed`
 * marks a `dailyLimit` EODHD has not told yet (a key saved while `/user`
 * answered with a limit error); absent on every quota stored before it.
 */
export type QuoteQuota = {
  day: number;
  calls: number;
  dailyLimit: number;
  symbols: string[];
  isLimitUnconfirmed?: boolean;
};

const utcDayOf = (instant: number): number => Math.floor(instant / DAY_MS) * DAY_MS;

export const currentQuota = (stored: QuoteQuota | null, now: number): QuoteQuota => {
  const day = utcDayOf(now);

  if (stored?.day === day) {
    return stored;
  }

  return {
    day,
    calls: 0,
    dailyLimit: stored?.dailyLimit ?? DEFAULT_DAILY_LIMIT,
    symbols: [],
    ...(stored?.isLimitUnconfirmed === true ? { isLimitUnconfirmed: true } : {}),
  };
};

export const withUnconfirmedLimit = (quota: QuoteQuota): QuoteQuota => ({
  ...quota,
  isLimitUnconfirmed: true,
});

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
 * What one refresh did with the calls it reserved on `day`: `unanswered` are
 * the reserved symbols it stopped before asking about.
 */
export type QuotaSettlement = {
  day: number;
  reserved: number;
  spent: number;
  unanswered: string[];
  usedUp: boolean;
};

/**
 * Applies a refresh's own calls to the quota stored now, not to the one it
 * read before its calls went out, so a key saved meanwhile keeps its limit
 * and EODHD's count. A quota stored for another UTC day no longer holds the
 * reservation, so it stays as it is.
 */
export const settle = (
  stored: QuoteQuota | null,
  { day, reserved, spent, unanswered, usedUp }: QuotaSettlement,
): QuoteQuota | null => {
  if (stored?.day !== day) {
    return stored;
  }

  const settled = {
    ...stored,
    calls: Math.max(0, stored.calls + spent - reserved),
    symbols: stored.symbols.filter((symbol) => !unanswered.includes(symbol)),
  };

  return usedUp ? markUsedUp(settled) : settled;
};

/**
 * EODHD's own count wins over the local one: the same key can spend calls in
 * another app. Its count applies only when EODHD's day is today's UTC day.
 */
export const withUserLimits = (
  stored: QuoteQuota | null,
  limits: UserLimits,
  now: number,
): QuoteQuota => {
  const { isLimitUnconfirmed: _wasUnconfirmed, ...quota } = currentQuota(stored, now);

  return {
    ...quota,
    dailyLimit: limits.dailyLimit,
    calls: limits.requestsDay === quota.day ? limits.requestsToday : quota.calls,
  };
};
