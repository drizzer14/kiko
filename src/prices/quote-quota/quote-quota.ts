import { DAY_MS } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';

import type { UserLimits } from '../eodhd';

// The free EODHD plan, until the key's own limit is read on save.
const DEFAULT_DAILY_LIMIT = 20;
// A share search is the user waiting on a sheet; a refresh can wait a day.
const SEARCH_RESERVE = 2;
// A symbol EODHD has no use for is asked again after 2, 4, 8, 16, then every
// 30 days: rarely enough to spare the daily calls, often enough to notice a
// listing that came back.
const MAX_BACKOFF_DAYS = 30;
// A held listing with no close for a week of daily answers is most likely
// delisted; a holiday or a late close never runs that long.
const EMPTY_ANSWERS_BEFORE_STRIKE = 7;

/**
 * A symbol held back until `retryDay` (a UTC day), after `strikes` answers in a
 * row it had no use for. `lastLotDay` and `firstLotDay` are the newest and the
 * oldest lot of its holdings when it was struck: a newer lot is the user acting
 * on the share, so its newest closes are asked for again, and an older lot asks
 * again for the history before it. `firstLotDay` is absent on a back-off stored
 * before it. `emptyAnswers` counts its answers in a row with no close.
 */
export type SymbolBackoff = {
  strikes: number;
  retryDay: number;
  lastLotDay: number;
  firstLotDay?: number;
  emptyAnswers?: number;
};

/** A symbol and the oldest and newest lot of its holdings. */
export type SymbolLots = { symbol: string; firstLotDay: number; lastLotDay: number };

/**
 * The EODHD calls spent on one `day`: a UTC-midnight day, because EODHD resets
 * its daily limit at midnight GMT, not on the device's day. `symbols` are the
 * symbols already requested that day, so a symbol costs at most one refresh
 * per day even when its answer brought no new close. `isLimitUnconfirmed`
 * marks a `dailyLimit` EODHD has not told yet (a key saved while `/user`
 * answered with a limit error); absent on every quota stored before it.
 *
 * It also keeps what the saved key taught a refresh, so no day repeats it:
 * `isKeyRejected` (EODHD answered 401: no call until a key is saved or checked
 * again), `keyGeneration` (counts key saves, so an answer about an older key
 * never lands on a newer one; the key itself stays in the Keychain), `backoff`
 * per symbol, and `backfilledFrom`, the earliest day each share series was
 * answered from, so a range with no close is never asked for again.
 */
export type QuoteQuota = {
  day: number;
  calls: number;
  dailyLimit: number;
  symbols: string[];
  isLimitUnconfirmed?: boolean;
  isKeyRejected?: boolean;
  keyGeneration?: number;
  backoff?: Record<string, SymbolBackoff>;
  backfilledFrom?: Record<string, number>;
};

export const utcDayOf = (instant: number): number => Math.floor(instant / DAY_MS) * DAY_MS;

export const keyGenerationOf = (quota: QuoteQuota | null): number => quota?.keyGeneration ?? 0;

/** The instant EODHD's day starts over: the next midnight GMT. */
export const quotaResetsAt = (now: number): number => utcDayOf(now) + DAY_MS;

export const currentQuota = (stored: QuoteQuota | null, now: number): QuoteQuota => {
  const day = utcDayOf(now);

  if (stored?.day === day) {
    return stored;
  }

  return { dailyLimit: DEFAULT_DAILY_LIMIT, ...stored, day, calls: 0, symbols: [] };
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
  symbols: [...new Set([...quota.symbols, ...symbols])],
});

export const markUsedUp = (quota: QuoteQuota): QuoteQuota => ({
  ...quota,
  calls: Math.max(quota.calls, quota.dailyLimit),
});

const isHeldBack = (
  quota: QuoteQuota,
  symbol: string,
  isSameLot: (backoff: SymbolBackoff) => boolean,
): boolean =>
  foldMap(
    maybe(quota.backoff?.[symbol]),
    (backoff) => isSameLot(backoff) && quota.day < backoff.retryDay,
  ) ?? false;

export const isBackedOff = (quota: QuoteQuota, symbol: string, lastLotDay: number): boolean =>
  isHeldBack(quota, symbol, (backoff) => backoff.lastLotDay === lastLotDay);

export const isBackfillBackedOff = (
  quota: QuoteQuota,
  symbol: string,
  firstLotDay: number,
): boolean => isHeldBack(quota, symbol, (backoff) => backoff.firstLotDay === firstLotDay);

/**
 * What one refresh did with the calls it reserved on `day`: `unanswered` are
 * the reserved symbols it stopped before asking about. `keyGeneration` is the
 * key it asked with: what it learned about the key and its symbols (a
 * rejection, a symbol `struck`, or one whose newest closes were `answered` or
 * came back `empty`) applies only while that key is still the saved one.
 * `backfilledFrom` is the earliest day it got an answer from per series, which
 * holds whatever key asked.
 */
export type QuotaSettlement = {
  day: number;
  reserved: number;
  spent: number;
  unanswered: string[];
  usedUp: boolean;
  keyGeneration: number;
  isKeyRejected?: boolean;
  struck?: SymbolLots[];
  answered?: string[];
  empty?: SymbolLots[];
  backfilledFrom?: Record<string, number>;
};

const withCalls = (
  stored: QuoteQuota,
  { day, reserved, spent, unanswered, usedUp }: QuotaSettlement,
): QuoteQuota => {
  if (stored.day !== day) {
    return stored;
  }

  const settled = {
    ...stored,
    calls: Math.max(0, stored.calls + spent - reserved),
    symbols: stored.symbols.filter((symbol) => !unanswered.includes(symbol)),
  };

  return usedUp ? markUsedUp(settled) : settled;
};

const strike = (
  previous: SymbolBackoff | undefined,
  { firstLotDay, lastLotDay }: SymbolLots,
  day: number,
): SymbolBackoff => {
  const strikes =
    previous?.lastLotDay === lastLotDay && previous.firstLotDay === firstLotDay
      ? previous.strikes + 1
      : 1;

  return {
    ...previous,
    strikes,
    retryDay: day + Math.min(2 ** strikes, MAX_BACKOFF_DAYS) * DAY_MS,
    lastLotDay,
    firstLotDay,
  };
};

// Once the count is reached, each further answer with no close strikes again.
const answeredEmpty = (
  previous: SymbolBackoff | undefined,
  lots: SymbolLots,
  day: number,
): SymbolBackoff => {
  const emptyAnswers = (previous?.emptyAnswers ?? 0) + 1;

  if (emptyAnswers >= EMPTY_ANSWERS_BEFORE_STRIKE) {
    return { ...strike(previous, lots, day), emptyAnswers };
  }

  const { firstLotDay, lastLotDay } = lots;

  return { strikes: 0, retryDay: day, lastLotDay, firstLotDay, ...previous, emptyAnswers };
};

const withBackoff = (
  stored: QuoteQuota,
  { day, struck = [], answered = [], empty = [] }: QuotaSettlement,
): QuoteQuota => {
  const cleared = answered.filter((symbol) => stored.backoff?.[symbol] !== undefined);

  if (struck.length === 0 && cleared.length === 0 && empty.length === 0) {
    return stored;
  }

  const backoff = { ...stored.backoff };

  for (const symbol of cleared) {
    delete backoff[symbol];
  }

  for (const lots of struck) {
    backoff[lots.symbol] = strike(backoff[lots.symbol], lots, day);
  }

  for (const lots of empty) {
    backoff[lots.symbol] = answeredEmpty(backoff[lots.symbol], lots, day);
  }

  return { ...stored, backoff };
};

const withKeyAnswers = (stored: QuoteQuota, settlement: QuotaSettlement): QuoteQuota => {
  if (keyGenerationOf(stored) !== settlement.keyGeneration) {
    return stored;
  }

  const rejected = settlement.isKeyRejected === true ? { ...stored, isKeyRejected: true } : stored;

  return withBackoff(rejected, settlement);
};

const withBackfill = (stored: QuoteQuota, { backfilledFrom = {} }: QuotaSettlement): QuoteQuota => {
  const entries = Object.entries(backfilledFrom);

  if (entries.length === 0) {
    return stored;
  }

  const earliest = { ...stored.backfilledFrom };

  for (const [symbol, day] of entries) {
    earliest[symbol] = Math.min(earliest[symbol] ?? day, day);
  }

  return { ...stored, backfilledFrom: earliest };
};

/**
 * Applies a refresh's own calls to the quota stored now, not to the one it
 * read before its calls went out, so a key saved meanwhile keeps its limit
 * and EODHD's count. A quota stored for another UTC day no longer holds the
 * reservation, so its calls stay as they are.
 */
export const settle = (stored: QuoteQuota | null, settlement: QuotaSettlement): QuoteQuota | null =>
  foldMap(maybe(stored), (quota) =>
    withBackfill(withKeyAnswers(withCalls(quota, settlement), settlement), settlement),
  ) ?? null;

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

export const withoutRejection = ({
  isKeyRejected: _wasRejected,
  ...quota
}: QuoteQuota): QuoteQuota => quota;

// A new key starts with nothing the previous one learned: not its rejection,
// and not its back-offs, which a bigger plan may not need.
const withNewKey = (quota: QuoteQuota): QuoteQuota => {
  const { backoff: _backoff, ...kept } = withoutRejection(quota);

  return { ...kept, keyGeneration: keyGenerationOf(quota) + 1 };
};

/**
 * The quota for a key the user just saved. The calls and symbols of today are
 * the previous key's, so they start over, unless EODHD's `limits` report this
 * key's own count for today. Without `limits` (EODHD answered with a limit
 * error) the stored limit stays until it is confirmed.
 */
export const withSavedKey = (
  stored: QuoteQuota | null,
  limits: UserLimits | undefined,
  now: number,
): QuoteQuota => {
  const quota = withNewKey(currentQuota(stored, now));

  if (limits?.requestsDay === quota.day) {
    return withUserLimits(quota, limits, now);
  }

  const fresh = { ...quota, calls: 0, symbols: [] };

  return foldMap(maybe(limits), (found) => withUserLimits(fresh, found, now)) ?? fresh;
};

/**
 * A key restored from a backup may be another plan's: its limit is unconfirmed
 * until EODHD tells it. The calls this device spent today still count.
 */
export const withRestoredKey = (stored: QuoteQuota | null, now: number): QuoteQuota =>
  withUnconfirmedLimit(withNewKey(currentQuota(stored, now)));

/**
 * A restore replaces every price, so what the refresh knew about the old
 * series (which symbols it asked today, backed off, or backfilled) no longer
 * holds; the calls spent today and the key's own state do.
 */
export const withRestoredPrices = (stored: QuoteQuota | null): QuoteQuota | null =>
  foldMap(
    maybe(stored),
    ({ backoff: _backoff, backfilledFrom: _backfilledFrom, ...kept }): QuoteQuota => ({
      ...kept,
      symbols: [],
    }),
  ) ?? null;
