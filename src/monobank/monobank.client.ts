import { MONOBANK_API_ENDPOINT } from '@env';
import { guard } from 'fnts';

import { i18n } from '../i18n';

import type { MonobankClientInfo, MonobankStatementItem } from './monobank.types';

const base = MONOBANK_API_ENDPOINT;

/**
 * Abort a Monobank request that has not responded within this window. Without
 * it a single hung socket freezes the whole sync behind a spinner that never
 * clears. 30s is comfortably above Monobank's normal p99 latency yet well under
 * the 60s per-token rate interval, so a genuine slow response still completes
 * while a truly stuck one is cut loose before the next throttled request is due.
 */
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * How many times a 429 is retried (after honouring Retry-After) before the
 * request surfaces a distinct rate-limited error. Bounded so a persistently
 * rate-limited token fails fast rather than looping forever.
 */
const MAX_RATE_LIMIT_RETRIES = 2;
/**
 * Backoff used for a 429 that carries no parseable Retry-After header: the
 * per-token rate interval, the shortest wait Monobank could plausibly want.
 */
const RATE_LIMIT_FALLBACK_MS = 60_000;

const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * A request that did not respond within `REQUEST_TIMEOUT_MS` and was aborted.
 * Distinct from a rate-limit error so a caller (and the user-facing error text)
 * can tell "the network hung" from "we are being throttled".
 */
export class MonobankTimeoutError extends Error {
  constructor() {
    super(i18n.t('accountDetail.monobankTimeout'));
    this.name = 'MonobankTimeoutError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, MonobankTimeoutError.prototype);
  }
}

/** A 429 that was still rate-limited after the bounded retry budget was spent. */
export class MonobankRateLimitError extends Error {
  constructor() {
    super(i18n.t('accountDetail.monobankRateLimited'));
    this.name = 'MonobankRateLimitError';
    Object.setPrototypeOf(this, MonobankRateLimitError.prototype);
  }
}

/**
 * Read a Monobank JSON body, or throw on a non-ok response. The ok-check is a
 * `guard` validator/executor pair rather than an imperative `if (!ok) throw`:
 * a non-ok response fails into the throwing executor; the default executor
 * parses the body. A 429 is handled before this runs (see `request`), so it
 * only ever sees the other, non-retryable non-ok statuses.
 */
const readBody = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`Monobank request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<unknown> => response.json(),
);

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Retry-After is defined in seconds (Monobank sends a plain integer). Convert
 * to milliseconds; anything missing, non-numeric, or non-positive (including a
 * literal `Retry-After: 0`) falls back to the per-token interval so a malformed
 * or zero header never collapses the backoff to zero.
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
 * Issue one request with an AbortController-based timeout. On abort the fetch
 * rejects; we translate that into a `MonobankTimeoutError` (any other rejection
 * is re-thrown untouched). The timer is always cleared so a completed request
 * never leaves a dangling handle.
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
      headers: { 'X-Token': token },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new MonobankTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The one request path every Monobank call goes through. It layers two
 * resilience concerns onto the raw fetch:
 *
 *  - a per-attempt timeout (`requestOnce`), so a hung socket cannot stall the
 *    sync indefinitely; and
 *  - bounded 429 handling: on a rate-limit response it waits the server's
 *    Retry-After (or the per-token interval) and retries up to `maxRetries`
 *    times, then surfaces a `MonobankRateLimitError` rather than a raw status
 *    throw.
 *
 * A non-429 non-ok status still throws immediately via `readBody`.
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
        throw new MonobankRateLimitError();
      }
      await sleep(retryAfterMs(response));
      continue;
    }

    return (await readBody(response)) as T;
  }
};

export const fetchClientInfo = (
  token: string,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<MonobankClientInfo> => request('/personal/client-info', token, fetchImpl, options);

export const fetchStatement = (
  token: string,
  accountId: string,
  fromSeconds: number,
  toSeconds: number,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<MonobankStatementItem[]> =>
  request(
    `/personal/statement/${accountId}/${fromSeconds}/${toSeconds}`,
    token,
    fetchImpl,
    options,
  );
