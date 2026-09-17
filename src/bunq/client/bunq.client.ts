import { BUNQ_API_ENDPOINT } from '@env';
import { guard } from 'fnts';

import { i18n } from '../../i18n';
import type {
  BunqCrypto,
  BunqId,
  BunqMonetaryAccount,
  BunqPayment,
  BunqResponseEnvelope,
  BunqToken,
  BunqUser,
} from '../bunq.types';

const base = BUNQ_API_ENDPOINT;

/**
 * Abort a bunq request that has not responded within this window.
 * TODO(VERIFY LIVE): reuses Monobank/PrivatBank's 30s pick with no
 * bunq-specific evidence behind it — confirm bunq's real p99 latency before
 * shipping.
 */
const REQUEST_TIMEOUT_MS = 30_000;
/** How many times a 429 is retried before the request surfaces a distinct rate-limited error. */
const MAX_RATE_LIMIT_RETRIES = 2;
/**
 * Backoff used for a 429 that carries no parseable Retry-After header.
 * TODO(VERIFY LIVE): bunq's own 429 Retry-After convention is not confirmed
 * by the coordinator's verification pass — this keeps Monobank/PrivatBank's
 * 60s fallback as a conservative placeholder.
 */
const RATE_LIMIT_FALLBACK_MS = 60_000;

const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * The payment page size requested per call. CONFIRMED (coordinator's live
 * verification pass): pagination is `count`/`older_id`/`newer_id` query
 * params. TODO(VERIFY LIVE): the endpoint's documented default/max `count`
 * is unconfirmed — 200 is a conservative pick, not a confirmed ceiling.
 */
const PAYMENT_PAGE_SIZE = 200;

/** The device description sent to `/device-server` — how this connection shows up in the bunq app's device list. */
const BUNQ_DEVICE_DESCRIPTION = 'Kiko';

/**
 * bunq's documented sandbox-only shortcut that bypasses REAL request-body
 * signing for `/session-server` — see `openSession`'s doc comment.
 */
export const BUNQ_SANDBOX_TEST_SIGNATURE = 'IGNORE_ONLY_FOR_TESTING';

/**
 * CONFIRMED (coordinator's live verification pass): a session's real
 * lifetime comes back on the `UserPerson`/`UserCompany` Response entry as
 * `session_timeout` (seconds) — TODO(VERIFY LIVE): confirm this exact field
 * name/presence against a live response. Falls back to this conservative 30
 * minute default when the field is absent, so a session this client cannot
 * size is still refreshed proactively rather than assumed to live forever.
 */
const DEFAULT_SESSION_TTL_SECONDS = 30 * 60;

/**
 * How far ahead of a STORED session's expiry it is treated as due for
 * refresh — see `ensureBunqContext` (`../sync/sync.ts`). Refreshing a
 * LITTLE early avoids racing a mid-sync expiry.
 */
export const SESSION_REFRESH_MARGIN_MS = 60_000;

/** A bunq request that did not respond within `REQUEST_TIMEOUT_MS` and was aborted. Mirrors `MonobankTimeoutError`/`PrivatbankTimeoutError`. */
export class BunqTimeoutError extends Error {
  constructor() {
    super(i18n.t('accountDetail.bunqTimeout'));
    this.name = 'BunqTimeoutError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, BunqTimeoutError.prototype);
  }
}

/** A 429 that was still rate-limited after the bounded retry budget was spent. */
export class BunqRateLimitError extends Error {
  constructor() {
    super(i18n.t('accountDetail.bunqRateLimited'));
    this.name = 'BunqRateLimitError';
    Object.setPrototypeOf(this, BunqRateLimitError.prototype);
  }
}

/**
 * Read a bunq JSON body, or throw on a non-ok response. Mirrors
 * Monobank/PrivatBank's `readBody`: a non-ok response fails into the
 * throwing executor; the default executor parses the body. A 429 is handled
 * before this runs (see `bunqRequest`), so it only ever sees the other,
 * non-retryable statuses.
 */
const readBody = guard(
  [
    (response: Response) => !response.ok,
    (response: Response): never => {
      throw new Error(`bunq request failed: ${response.status}`);
    },
  ],
  (response: Response): Promise<unknown> => response.json(),
);

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Retry-After is defined in seconds. Convert to milliseconds; anything
 * missing, non-numeric, or non-positive falls back to the fallback interval
 * so a malformed or zero header never collapses the backoff to zero. Mirrors
 * Monobank/PrivatBank's `retryAfterMs`.
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

type BunqRequestInit = { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string };

/**
 * Issue one request with an AbortController-based timeout. On abort the
 * fetch rejects; that is translated into a `BunqTimeoutError` (any other
 * rejection is re-thrown untouched). The timer is always cleared so a
 * completed request never leaves a dangling handle.
 */
const requestOnce = async (
  path: string,
  init: BunqRequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(`${base}${path}`, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new BunqTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The one request path every bunq call goes through — mirrors
 * Monobank/PrivatBank's `request`: a per-attempt timeout (`requestOnce`)
 * plus bounded 429 handling (wait Retry-After or the fallback interval,
 * retry up to `maxRetries`, then surface `BunqRateLimitError`). Unlike
 * Monobank/PrivatBank, headers are NOT derived from one fixed credential
 * shape — each bunq call needs different headers (none for `/installation`,
 * `X-Bunq-Client-Authentication` for the rest, plus a body signature for
 * `/session-server`), so the caller builds `init` itself.
 */
const bunqRequest = async <T>(
  path: string,
  init: BunqRequestInit,
  fetchImpl: typeof fetch,
  options: RequestOptions = {},
): Promise<T> => {
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? MAX_RATE_LIMIT_RETRIES;

  for (let attempt = 0; ; attempt += 1) {
    const response = await requestOnce(path, init, fetchImpl, timeoutMs);

    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      if (attempt >= maxRetries) {
        throw new BunqRateLimitError();
      }
      await sleep(retryAfterMs(response));
      continue;
    }

    return (await readBody(response)) as T;
  }
};

/** The first Response-array entry tagged `tag` (bunq's `{ Response: [{ <Tag>: <value> }, ...] }` envelope). */
const firstTag = <T>(envelope: BunqResponseEnvelope, tag: string): T | undefined => {
  const entry = envelope.Response.find((item) => tag in item);

  return entry ? (entry[tag] as T) : undefined;
};

/** Every Response-array entry tagged `tag`, in order. */
const allTagged = <T>(envelope: BunqResponseEnvelope, tag: string): T[] =>
  envelope.Response.filter((item) => tag in item).map((item) => item[tag] as T);

/**
 * `POST /installation` — the FIRST handshake step. CONFIRMED (coordinator's
 * live verification pass): no auth header; the response carries the
 * installation `Token` (used as `X-Bunq-Client-Authentication` for the next
 * two steps) and the server's own public key (unused here — this app never
 * verifies bunq's response signature; a read-only fetch trusts the TLS
 * channel). TODO(VERIFY LIVE): the exact JSON body field name —
 * `client_public_key` is the best-effort placeholder, not a docs-quoted
 * field.
 */
export const installClient = async (
  crypto: BunqCrypto,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<{ installationToken: string; privateKeyPem: string; publicKeyPem: string }> => {
  const { privateKeyPem, publicKeyPem } = await crypto.generateKeyPair();
  const envelope = await bunqRequest<BunqResponseEnvelope>(
    '/installation',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_public_key: publicKeyPem }),
    },
    fetchImpl,
    options,
  );
  const token = firstTag<BunqToken>(envelope, 'Token');

  if (!token) {
    throw new Error(i18n.t('accountDetail.invalidBunqCredentials'));
  }

  return { installationToken: token.token, privateKeyPem, publicKeyPem };
};

/**
 * `POST /device-server` — registers this installation as a "device" bound to
 * the user's API key (`secret`). CONFIRMED (coordinator's live verification
 * pass): header `X-Bunq-Client-Authentication: <installationToken>`.
 * TODO(VERIFY LIVE): the optional `permitted_ips` field is omitted here
 * (unrestricted, matching a device bunq's own apps would register) —
 * confirm whether it should be sent.
 */
export const registerDevice = async (
  installationToken: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<string> => {
  const envelope = await bunqRequest<BunqResponseEnvelope>(
    '/device-server',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bunq-Client-Authentication': installationToken,
      },
      body: JSON.stringify({ description: BUNQ_DEVICE_DESCRIPTION, secret: apiKey }),
    },
    fetchImpl,
    options,
  );
  const id = firstTag<BunqId>(envelope, 'Id');

  if (!id) {
    throw new Error(i18n.t('accountDetail.invalidBunqCredentials'));
  }

  return String(id.id);
};

export type BunqSessionResult = { sessionToken: string; userId: string; sessionTtlSeconds: number };

/**
 * `POST /session-server` — opens (or re-opens) a session. CONFIRMED
 * (coordinator's live verification pass): since bunq's 2020 signing change,
 * the request BODY must be signed with the client's RSA private key for
 * THIS call specifically (mandatory here and for a payment POST — this
 * read-only app never makes one). PRODUCTION therefore genuinely needs the
 * concrete `BunqCrypto` binding (see `src/bunq/crypto/bunq-crypto.ts`'s
 * stub); a SANDBOX/hermetic caller may instead pass `sandboxTestSignature:
 * true` to send the documented `X-Bunq-Client-Signature:
 * IGNORE_ONLY_FOR_TESTING` shortcut header, which bypasses the SIGNATURE
 * only — `installClient` above still needs a real keypair either way.
 * CONFIRMED (coordinator): the session-server rate limit is far stricter
 * than the read endpoints (~1 req/30s), which is why `ensureBunqContext`
 * (`../sync/sync.ts`) caches the returned session and calls this again only
 * once it is missing or expired, never once per sync.
 */
export const openSession = async (
  input: {
    installationToken: string;
    apiKey: string;
    privateKeyPem: string;
    crypto: BunqCrypto;
    sandboxTestSignature?: boolean;
  },
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<BunqSessionResult> => {
  const body = JSON.stringify({ secret: input.apiKey });
  const signature = input.sandboxTestSignature
    ? BUNQ_SANDBOX_TEST_SIGNATURE
    : await input.crypto.sign(input.privateKeyPem, body);
  const envelope = await bunqRequest<BunqResponseEnvelope>(
    '/session-server',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bunq-Client-Authentication': input.installationToken,
        'X-Bunq-Client-Signature': signature,
      },
      body,
    },
    fetchImpl,
    options,
  );
  const token = firstTag<BunqToken>(envelope, 'Token');
  const user =
    firstTag<BunqUser>(envelope, 'UserPerson') ?? firstTag<BunqUser>(envelope, 'UserCompany');

  if (!token || !user) {
    throw new Error(i18n.t('accountDetail.invalidBunqCredentials'));
  }

  return {
    sessionToken: token.token,
    userId: String(user.id),
    sessionTtlSeconds: user.session_timeout ?? DEFAULT_SESSION_TTL_SECONDS,
  };
};

export type BunqSession = { sessionToken: string; userId: string };

/**
 * `GET /v1/user/{userID}/monetary-account`. CONFIRMED (coordinator's live
 * verification pass): balance is `{ currency: '<alpha-3>', value: '<decimal
 * string, major units>' }` — mapped through `Money.fromMajor` at the sync
 * boundary (`src/bunq/sync/sync.ts`), not here.
 */
export const fetchMonetaryAccounts = async (
  session: BunqSession,
  fetchImpl: typeof fetch = fetch,
  options: RequestOptions = {},
): Promise<BunqMonetaryAccount[]> => {
  const envelope = await bunqRequest<BunqResponseEnvelope>(
    `/user/${session.userId}/monetary-account`,
    { method: 'GET', headers: { 'X-Bunq-Client-Authentication': session.sessionToken } },
    fetchImpl,
    options,
  );

  // TODO(VERIFY LIVE): only a `MonetaryAccountBank` entry is read; bunq may
  // also return a `MonetaryAccountSavings`/`MonetaryAccountJoint` Response
  // entry — unmapped here until confirmed how each should be represented.
  return allTagged<BunqMonetaryAccount>(envelope, 'MonetaryAccountBank');
};

export type BunqPaymentsPage = { payments: BunqPayment[]; nextOlderId?: string };

/**
 * `GET /v1/user/{userID}/monetary-account/{monetary-accountID}/payment`.
 * CONFIRMED (coordinator's live verification pass): pagination is
 * `count`/`older_id`/`newer_id` query params, and there is NO server-side
 * date/amount filter — the caller (`src/bunq/sync/sync.ts`) pages backward
 * with `older_id` and filters by `created` CLIENT-SIDE for an incremental
 * sync.
 */
export const fetchPayments = async (
  session: BunqSession,
  monetaryAccountId: string,
  fetchImpl: typeof fetch = fetch,
  olderId?: string,
  options: RequestOptions = {},
): Promise<BunqPaymentsPage> => {
  const params = new URLSearchParams({ count: String(PAYMENT_PAGE_SIZE) });

  if (olderId !== undefined) {
    params.set('older_id', olderId);
  }

  const envelope = await bunqRequest<BunqResponseEnvelope>(
    `/user/${session.userId}/monetary-account/${monetaryAccountId}/payment?${params.toString()}`,
    { method: 'GET', headers: { 'X-Bunq-Client-Authentication': session.sessionToken } },
    fetchImpl,
    options,
  );
  const payments = allTagged<BunqPayment>(envelope, 'Payment');
  const nextOlderId = envelope.Pagination?.older_id;

  return { payments, nextOlderId: nextOlderId === undefined ? undefined : String(nextOlderId) };
};
