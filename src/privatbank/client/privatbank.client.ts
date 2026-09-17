import { PRIVATBANK_API_ENDPOINT } from '@env';
import { guard } from 'fnts';

import { i18n } from '../../i18n';
import type { PrivatbankBalancePage, PrivatbankStatementPage } from '../privatbank.types';

const base = PRIVATBANK_API_ENDPOINT;

/** Abort a PrivatBank request that has not responded within this window. Reuses Monobank's/Starling's 30s pick. */
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * How many times a 429 is retried (after honouring Retry-After) before the
 * request surfaces a distinct rate-limited error. Mirrors Monobank's own
 * bounded-retry budget (`src/monobank/client/monobank.client.ts`).
 */
const MAX_RATE_LIMIT_RETRIES = 2;
/**
 * Backoff used for a 429 that carries no parseable Retry-After header. This
 * is the REACTIVE fallback for an actual 429 response — distinct from the
 * PROACTIVE per-request pacing gate (`PRIVATBANK_RATE_LIMIT_MS` in
 * `src/privatbank/sync/sync.ts`, confirmed at 1 req/s per the official
 * AutoClient doc). The official doc does not document a 429 Retry-After
 * convention, so this keeps Monobank's 60s fallback as a conservative
 * placeholder.
 */
const RATE_LIMIT_FALLBACK_MS = 60_000;

const HTTP_TOO_MANY_REQUESTS = 429;

/** The statement page size requested per call. VERIFIED (task-6 brief): default 20, max 500, recommended <=100 — this pins the upper end of that recommendation explicitly rather than relying on the server's smaller default. */
const STATEMENT_PAGE_SIZE = 100;

/**
 * A stable Kiko app identifier — VERIFIED (task-6 brief) that AutoClient
 * REQUIRES a `User-Agent` header; the brief does not mandate a specific
 * string, only that one is sent, so this is Kiko's own name/version.
 */
const PRIVATBANK_USER_AGENT = 'Kiko/1.0';

/**
 * A request that did not respond within `REQUEST_TIMEOUT_MS` and was
 * aborted. Mirrors `MonobankTimeoutError`.
 */
export class PrivatbankTimeoutError extends Error {
  constructor() {
    super(i18n.t('accountDetail.privatbankTimeout'));
    this.name = 'PrivatbankTimeoutError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, PrivatbankTimeoutError.prototype);
  }
}

/** A 429 that was still rate-limited after the bounded retry budget was spent. */
export class PrivatbankRateLimitError extends Error {
  constructor() {
    super(i18n.t('accountDetail.privatbankRateLimited'));
    this.name = 'PrivatbankRateLimitError';
    Object.setPrototypeOf(this, PrivatbankRateLimitError.prototype);
  }
}

/**
 * Read a PrivatBank JSON body, or throw on a non-ok response. Mirrors
 * Monobank's `readBody`: a non-ok response fails into the throwing executor;
 * the default executor parses the body. A 429 is handled before this runs
 * (see `request`), so it only ever sees the other, non-retryable statuses.
 */
const readBody = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`PrivatBank request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<unknown> => response.json(),
);

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Retry-After is defined in seconds. Convert to milliseconds; anything
 * missing, non-numeric, or non-positive falls back to the per-credential
 * interval so a malformed or zero header never collapses the backoff to
 * zero. Mirrors Monobank's `retryAfterMs`.
 */
const retryAfterMs = (response: Response): number => {
  const header = response.headers?.get?.('Retry-After');
  const seconds = header ? Number.parseInt(header, 10) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMIT_FALLBACK_MS;
};

/**
 * Per-request tuning. Defaulted so production call sites pass nothing; tests
 * inject a fake `sleep` (no real backoff wait) and can shrink the timeout /
 * retry budget to keep the suite instant. `followId` (VERIFIED, task-6
 * brief) is the AutoClient pagination cursor — the caller passes the
 * previous response's `next_page_id` back in to fetch the next page of
 * EITHER endpoint below.
 */
export type RequestOptions = {
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
  followId?: string;
};

/**
 * Issue one request with an AbortController-based timeout, bearing the
 * SINGLE `token` header (VERIFIED, task-6 brief — no separate client-id
 * header), a required `User-Agent`, and an explicit `charset=utf8` so
 * Ukrainian `OSND`/counterparty text is not returned cp1251-encoded. On
 * abort the fetch rejects; we translate that into a `PrivatbankTimeoutError`
 * (any other rejection is re-thrown untouched). The timer is always cleared
 * so a completed request never leaves a dangling handle.
 *
 * TODO(VERIFY LIVE): the two things a live smoke test with real AutoClient
 * credentials must still confirm — everything else in this module is now
 * documented against the official AutoClient doc, not guessed: (1) this
 * single `token` header actually authenticates and the `charset=utf8`
 * request round-trips Ukrainian text without cp1251 mangling; (2) the exact
 * timezone `DATE_TIME_DAT_OD_TIM_P` is reported in — `sync/sync.ts`'s
 * `parsePrivatbankDateTime` assumes Kyiv local time (EET/EEST) by calendar
 * month, not a live-confirmed offset.
 */
const requestOnce = async (
  path: string,
  token: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(`${base}${path}`, {
      headers: {
        token,
        'User-Agent': PRIVATBANK_USER_AGENT,
        'Content-Type': 'application/json;charset=utf8',
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new PrivatbankTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The one request path every PrivatBank call goes through — mirrors
 * Monobank's `request`: a per-attempt timeout (`requestOnce`) plus bounded
 * 429 handling (wait Retry-After or the fallback interval, retry up to
 * `maxRetries`, then surface `PrivatbankRateLimitError`). A non-429 non-ok
 * status still throws immediately via `readBody`.
 */
const request = async <T>(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
  options: RequestOptions = {},
): Promise<T> => {
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? MAX_RATE_LIMIT_RETRIES;

  for (let attempt = 0; ; attempt += 1) {
    const response = await requestOnce(path, token, fetchImpl, timeoutMs);

    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      if (attempt >= maxRetries) {
        throw new PrivatbankRateLimitError();
      }
      await sleep(retryAfterMs(response));
      continue;
    }

    return (await readBody(response)) as T;
  }
};

/** Appends every DEFINED entry of `params` as a `?key=value&...` query string; an `undefined` value (an omitted optional param) is dropped rather than serialized as the literal string `'undefined'`. */
const buildQuery = (params: Record<string, string | undefined>): string => {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );

  return entries.length === 0
    ? ''
    : `?${entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
};

/**
 * The balance call — VERIFIED endpoint (task-6 brief): `/api/statements/balance`,
 * SEPARATE from the transactions endpoint below (replaces the old, guessed
 * `/rest/accounts`). Pages via `followId`/`exist_next_page` the same way
 * `fetchStatement` does — see `sync/sync.ts`'s `fetchAllAccounts` for the
 * loop that follows the cursor.
 */
export const fetchAccounts = (
  token: string,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<PrivatbankBalancePage> =>
  request(
    `/api/statements/balance${buildQuery({ followId: options.followId })}`,
    token,
    fetchImpl,
    options,
  );

/**
 * The date-ranged statement call — VERIFIED endpoint (task-6 brief):
 * `/api/statements/transactions` (replaces the old, guessed `/rest/statement`).
 * VERIFIED query params: `acc` (the account number), `startDate` MANDATORY
 * `DD-MM-YYYY` (dashes — the response's own `DATE_TIME_DAT_OD_TIM_P` uses
 * dots instead, see `formatPrivatbankDate` below), `endDate` optional same
 * format, `followId` the pagination cursor, `limit` pinned at
 * `STATEMENT_PAGE_SIZE`. This client still fetches exactly ONE page per call
 * — the sync engine (`sync/sync.ts`'s `fetchAllStatements`) is what follows
 * `exist_next_page`/`next_page_id` across repeated calls.
 */
export const fetchStatement = (
  token: string,
  accountId: string,
  fromSeconds: number,
  toSeconds: number,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<PrivatbankStatementPage> =>
  request(
    `/api/statements/transactions${buildQuery({
      acc: accountId,
      startDate: formatPrivatbankDate(fromSeconds),
      endDate: formatPrivatbankDate(toSeconds),
      followId: options.followId,
      limit: String(STATEMENT_PAGE_SIZE),
    })}`,
    token,
    fetchImpl,
    options,
  );

/**
 * VERIFIED (task-6 brief): the statement query's `startDate`/`endDate` use
 * `DD-MM-YYYY` (DASHES) — distinct from the response's own
 * `DATE_TIME_DAT_OD_TIM_P`, which uses dots (see `sync/sync.ts`'s
 * `parsePrivatbankDateTime`).
 */
const formatPrivatbankDate = (seconds: number): string => {
  const date = new Date(seconds * 1000);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();

  return `${day}-${month}-${year}`;
};
