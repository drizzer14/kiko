import { guard } from 'fnts';
import { match } from 'ts-pattern';
import { EODHD_API_ENDPOINT } from '@env';
import maybe, { foldMap } from 'fnts/maybe';
import either, { bifoldr } from 'fnts/either';
import { decimalFromJsonNumber } from '@kiko/currency/decimal';

/** One end-of-day close, in the listing's own currency unit, as an exact decimal string. */
export type EodClose = { day: number; close: string };

export type UserLimits = { dailyLimit: number; requestsToday: number; requestsDay: number };

// Every error below carries a fixed message: the request URL holds the user's
// key, and an error message reaches logs and alerts.

/** 401: EODHD did not accept the key. */
export class EodhdAuthError extends Error {
  constructor() {
    super('EODHD rejected the API key');
    this.name = 'EodhdAuthError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, EodhdAuthError.prototype);
  }
}

/** 403: the endpoint or the symbol is outside the key's plan — a per-symbol outcome, not a bad key. */
export class EodhdNotInPlanError extends Error {
  constructor() {
    super('EODHD plan does not cover this request');
    this.name = 'EodhdNotInPlanError';
    Object.setPrototypeOf(this, EodhdNotInPlanError.prototype);
  }
}

/** 402: the key's daily call limit is used up until midnight GMT. */
export class EodhdQuotaError extends Error {
  constructor() {
    super('EODHD daily limit reached');
    this.name = 'EodhdQuotaError';
    Object.setPrototypeOf(this, EodhdQuotaError.prototype);
  }
}

/** 429: the per-minute limit. */
export class EodhdRateLimitError extends Error {
  constructor() {
    super('EODHD rate limit reached');
    this.name = 'EodhdRateLimitError';
    Object.setPrototypeOf(this, EodhdRateLimitError.prototype);
  }
}

/** A network failure, a 5xx or other status, or a body that is not the documented JSON. */
export class EodhdUnavailableError extends Error {
  constructor() {
    super('EODHD is unavailable');
    this.name = 'EodhdUnavailableError';
    Object.setPrototypeOf(this, EodhdUnavailableError.prototype);
  }
}

const unavailable = (): never => {
  throw new EodhdUnavailableError();
};

// EODHD error bodies are plain text even with `fmt=json`, so only the status is read.
const errorForStatus = (status: number): Error =>
  match(status)
    .with(401, () => new EodhdAuthError())
    .with(402, () => new EodhdQuotaError())
    .with(403, () => new EodhdNotInPlanError())
    .with(429, () => new EodhdRateLimitError())
    .otherwise(() => new EodhdUnavailableError());

const readBody = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw errorForStatus(response.status);
    },
  ],
  async (response: Response): Promise<unknown> =>
    bifoldr(await either<unknown, unknown>(() => response.json())) ?? unavailable(),
);

// A rejected fetch can carry the request URL, and with it the key, in its message.
const requestJson = async (
  path: string,
  params: [string, string][],
  key: string,
  fetchImpl: typeof fetch,
): Promise<unknown> => {
  const query = new URLSearchParams([['api_token', key], ['fmt', 'json'], ...params]);
  const sent = await either<unknown, Response>(async () =>
    fetchImpl(`${EODHD_API_ENDPOINT}${path}?${query.toString()}`),
  );

  return readBody(bifoldr(sent) ?? unavailable());
};

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const dayFromText = (text: string): number | undefined =>
  foldMap(maybe(DAY_PATTERN.exec(text)), ([, year, month, day]) =>
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );

const textFromDay = (day: number): string => new Date(day).toISOString().slice(0, 10);

type EodRow = { date: string; close: number };

const isEodRow = (value: unknown): value is EodRow =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { date?: unknown }).date === 'string' &&
  typeof (value as { close?: unknown }).close === 'number';

const toClose = (row: unknown): EodClose[] => {
  if (!isEodRow(row)) {
    return [];
  }

  const day = dayFromText(row.date);
  const close = decimalFromJsonNumber(row.close);

  if (day === undefined || close === null) {
    return [];
  }

  return [{ day, close }];
};

/**
 * End-of-day closes for one `CODE.EXCHANGE` symbol over `[fromDay, toDay]`
 * (UTC-midnight days), oldest first. A range with no trading day is `[]`.
 */
export const fetchEod = async (
  symbol: string,
  fromDay: number,
  toDay: number,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EodClose[]> => {
  const body = await requestJson(
    `/eod/${encodeURIComponent(symbol)}`,
    [
      ['from', textFromDay(fromDay)],
      ['to', textFromDay(toDay)],
    ],
    key,
    fetchImpl,
  );

  return Array.isArray(body) ? body.flatMap(toClose) : unavailable();
};

type UserRow = { dailyRateLimit: number; apiRequests: number; apiRequestsDate: string };

const isUserRow = (value: unknown): value is UserRow =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { dailyRateLimit?: unknown }).dailyRateLimit === 'number' &&
  typeof (value as { apiRequests?: unknown }).apiRequests === 'number' &&
  typeof (value as { apiRequestsDate?: unknown }).apiRequestsDate === 'string';

/**
 * `requestsDay` is EODHD's own day (UTC midnight): it resets at midnight GMT,
 * not on the device's day. The `/user` call itself costs no call.
 */
export const fetchUserLimits = async (
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UserLimits> => {
  const body = await requestJson('/user', [], key, fetchImpl);

  if (!isUserRow(body)) {
    return unavailable();
  }

  const requestsDay = dayFromText(body.apiRequestsDate) ?? unavailable();

  return { dailyLimit: body.dailyRateLimit, requestsToday: body.apiRequests, requestsDay };
};
