import { STARLING_API_ENDPOINT } from '@env';
import { guard } from 'fnts';

import { i18n } from '../../i18n';
import type {
  StarlingAccount,
  StarlingAccountsResponse,
  StarlingBalance,
  StarlingFeedResponse,
} from '../starling.types';

const base = STARLING_API_ENDPOINT;
const API_PREFIX = '/api/v2';

/**
 * Abort a Starling request that has not responded within this window.
 * Reuses Monobank's/PrivatBank's 30s pick — no Starling-specific p99
 * evidence behind it, but not a wire fact the task brief flagged for a
 * "verify-in-portal" TODO.
 */
const REQUEST_TIMEOUT_MS = 30_000;
/** How many times a 429 is retried (after honouring Retry-After) before the request surfaces a distinct rate-limited error. Mirrors PrivatBank's/bunq's own bounded-retry budget. */
const MAX_RATE_LIMIT_RETRIES = 2;
/** Backoff used for a 429 that carries no parseable Retry-After header. Mirrors PrivatBank's/bunq's own fallback. */
const RATE_LIMIT_FALLBACK_MS = 60_000;

const HTTP_TOO_MANY_REQUESTS = 429;

/** A request that did not respond within `REQUEST_TIMEOUT_MS` and was aborted. Mirrors `PrivatbankTimeoutError`/`BunqTimeoutError`. */
export class StarlingTimeoutError extends Error {
  constructor() {
    super(i18n.t('accountDetail.starlingTimeout'));
    this.name = 'StarlingTimeoutError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, StarlingTimeoutError.prototype);
  }
}

/** A 429 that was still rate-limited after the bounded retry budget was spent. */
export class StarlingRateLimitError extends Error {
  constructor() {
    super(i18n.t('accountDetail.starlingRateLimited'));
    this.name = 'StarlingRateLimitError';
    Object.setPrototypeOf(this, StarlingRateLimitError.prototype);
  }
}

/**
 * Read a Starling JSON body, or throw on a non-ok response. Mirrors
 * PrivatBank's/bunq's `readBody`: a non-ok response fails into the throwing
 * executor; the default executor parses the body. A 429 is handled before
 * this runs (see `request`), so it only ever sees the other, non-retryable
 * statuses.
 */
const readBody = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`Starling request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<unknown> => response.json(),
);

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Retry-After is defined in seconds. Convert to milliseconds; anything
 * missing, non-numeric, or non-positive falls back to the per-token interval
 * so a malformed or zero header never collapses the backoff to zero. Mirrors
 * PrivatBank's/bunq's `retryAfterMs`.
 */
const retryAfterMs = (response: Response): number => {
  const header = response.headers?.get?.('Retry-After');
  const seconds = header ? Number.parseInt(header, 10) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMIT_FALLBACK_MS;
};

/**
 * Per-request tuning. Defaulted so production call sites pass nothing; tests
 * inject a fake `sleep` (no real backoff wait) and can shrink the timeout /
 * retry budget to keep the suite instant.
 */
type RequestOptions = {
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
};

/**
 * Issue one request with an AbortController-based timeout, bearing the PAT
 * as `Authorization: Bearer <token>` (CONFIRMED — Starling's standard OAuth
 * bearer-token scheme). On abort the fetch rejects; we translate that into a
 * `StarlingTimeoutError` (any other rejection is re-thrown untouched). The
 * timer is always cleared so a completed request never leaves a dangling
 * handle.
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
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new StarlingTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The one request path every Starling call goes through — mirrors
 * PrivatBank's/bunq's `request`: a per-attempt timeout (`requestOnce`) plus
 * bounded 429 handling (wait Retry-After or the fallback interval, retry up
 * to `maxRetries`, then surface `StarlingRateLimitError`). A non-429 non-ok
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
        throw new StarlingRateLimitError();
      }
      await sleep(retryAfterMs(response));
      continue;
    }

    return (await readBody(response)) as T;
  }
};

/**
 * List every account for the PAT's holder. CONFIRMED shape:
 * `{ accounts: [{ accountUid, defaultCategory, currency, createdAt }] }` —
 * the account name/IBAN are NOT in this response, they come from a separate
 * account-details/identifiers endpoint this v1 slice does not call.
 * TODO(VERIFY LIVE): fetch the account-details/identifiers endpoint for the
 * account's real display name and IBAN in a later slice; until then the
 * sync engine uses a sensible default holding name.
 *
 * Read-only: the token needs `account:read` (plus `balance:read` and
 * `transaction:read` for the other two calls below).
 */
export const fetchAccounts = async (
  token: string,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<StarlingAccount[]> => {
  const response = await request<StarlingAccountsResponse>(
    `${API_PREFIX}/accounts`,
    token,
    fetchImpl,
    options,
  );

  return response.accounts;
};

/**
 * One account's balance. CONFIRMED shape: `{ clearedBalance,
 * effectiveBalance, availableToSpend, ... }`, each an Amount `{ currency,
 * minorUnits }` — see `StarlingBalance`'s own doc comment for which field
 * the sync engine uses as the holding balance. Requires `balance:read`.
 */
export const fetchBalance = (
  token: string,
  accountUid: string,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<StarlingBalance> =>
  request(
    `${API_PREFIX}/accounts/${encodeURIComponent(accountUid)}/balance`,
    token,
    fetchImpl,
    options,
  );

/**
 * The INCREMENTAL feed endpoint for one account/category, changed since
 * `changesSinceIso` — CONFIRMED to be preferred over `transactions-between`
 * for an incremental sync. Requires `transaction:read`.
 */
export const fetchFeedChangedSince = async (
  token: string,
  accountUid: string,
  categoryUid: string,
  changesSinceIso: string,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<StarlingFeedResponse['feedItems']> => {
  const response = await request<StarlingFeedResponse>(
    `${API_PREFIX}/feed/account/${encodeURIComponent(accountUid)}/category/${encodeURIComponent(categoryUid)}?changesSince=${encodeURIComponent(changesSinceIso)}`,
    token,
    fetchImpl,
    options,
  );

  return response.feedItems;
};
