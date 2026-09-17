import { PRIVATBANK_API_ENDPOINT } from '@env';
import { guard } from 'fnts';

import { i18n } from '../../i18n';
import type { PrivatbankCredentials } from '../credentials';
import type { PrivatbankAccount, PrivatbankStatementPage } from '../privatbank.types';

const base = PRIVATBANK_API_ENDPOINT;

/**
 * Abort a PrivatBank request that has not responded within this window.
 * TODO(VERIFY LIVE): reuses Monobank's 30s pick with no PrivatBank-specific
 * evidence behind it — confirm AutoClient's real p99 latency before shipping.
 */
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
 * placeholder — TODO(VERIFY LIVE) if AutoClient's actual 429 behavior is
 * ever confirmed to want a shorter wait.
 */
const RATE_LIMIT_FALLBACK_MS = 60_000;

const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * The statement page size requested per call. CONFIRMED against the official
 * AutoClient doc: default 20, max 500, recommended <=100 — this pins the
 * upper end of that recommendation explicitly rather than relying on the
 * server's smaller default. TODO(VERIFY LIVE): confirm the actual
 * query-parameter NAME this maps to (`limit` is a best-effort placeholder).
 */
const STATEMENT_PAGE_SIZE = 100;

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
 * retry budget to keep the suite instant.
 */
type RequestOptions = {
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
};

/**
 * Issue one request with an AbortController-based timeout. On abort the
 * fetch rejects; we translate that into a `PrivatbankTimeoutError` (any other
 * rejection is re-thrown untouched). The timer is always cleared so a
 * completed request never leaves a dangling handle.
 *
 * TODO(VERIFY LIVE): confirm the AutoClient's actual auth header names —
 * Monobank uses a single `X-Token` header; this assumes a `token` +
 * `id` (client id) header pair per the reference clients, until PrivatBank's
 * own docs confirm its real scheme.
 */
const requestOnce = async (
  path: string,
  credentials: PrivatbankCredentials,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(`${base}${path}`, {
      headers: { token: credentials.token, id: credentials.clientId },
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
  credentials: PrivatbankCredentials,
  fetchImpl: typeof fetch,
  options: RequestOptions = {},
): Promise<T> => {
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? MAX_RATE_LIMIT_RETRIES;

  for (let attempt = 0; ; attempt += 1) {
    const response = await requestOnce(path, credentials, fetchImpl, timeoutMs);

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

/**
 * The AutoClient balances/accounts call. TODO(VERIFY LIVE): confirm the real
 * endpoint path — `/rest/accounts` is a best-effort placeholder, not
 * confirmed against Privat24's own docs.
 */
export const fetchAccounts = (
  credentials: PrivatbankCredentials,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<PrivatbankAccount[]> => request('/rest/accounts', credentials, fetchImpl, options);

/**
 * The date-ranged statement call. TODO(VERIFY LIVE): confirm the real
 * endpoint path, its query-parameter names, and its date-range format —
 * `/rest/statement?acc=<id>&startDate=<DD-MM-YYYY>&endDate=<DD-MM-YYYY>` is a
 * best-effort placeholder (Monobank instead encodes unix-second path
 * segments; PrivatBank's own AutoClient docs must confirm its real shape).
 * The AutoClient doc confirms paging is by `followId`/`exist_next_page`, not
 * a date-range cap — this client does not yet page a single [from, to] call
 * beyond one `STATEMENT_PAGE_SIZE`-sized response, and never follows a
 * `exist_next_page` cursor (real forward paging stays a TODO(VERIFY LIVE)).
 * The flag is still surfaced on the resolved `PrivatbankStatementPage` (not
 * swallowed) so the sync engine can fail closed on a truncated page rather
 * than silently dropping the unread items — see `fetchAllStatements`
 * (`src/privatbank/sync/sync.ts`).
 */
export const fetchStatement = (
  credentials: PrivatbankCredentials,
  accountId: string,
  fromSeconds: number,
  toSeconds: number,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<PrivatbankStatementPage> =>
  request(
    `/rest/statement?acc=${encodeURIComponent(accountId)}&startDate=${formatPrivatbankDate(fromSeconds)}&endDate=${formatPrivatbankDate(toSeconds)}&limit=${STATEMENT_PAGE_SIZE}`,
    credentials,
    fetchImpl,
    options,
  );

/**
 * TODO(VERIFY LIVE): confirm PrivatBank's actual statement query date format;
 * DD-MM-YYYY is the format the `kagatan/privatbank-autoclient` reference
 * client documents for its date-ranged statement request, used here as the
 * best-effort placeholder.
 */
const formatPrivatbankDate = (seconds: number): string => {
  const date = new Date(seconds * 1000);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();

  return `${day}-${month}-${year}`;
};
