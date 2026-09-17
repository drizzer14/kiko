// bunq API wire shapes. VERIFY-LIVE STATUS: the handshake mechanics, request
// signing rule, monetary-account list, and payment list below were confirmed
// against bunq's own official API docs by the coordinator's live
// verification pass (2026-09-17). What is still a best-effort placeholder —
// mainly exact JSON key names the docs pass did not quote verbatim, and the
// undocumented `count`/`session_timeout` ceilings — carries its own
// TODO(VERIFY LIVE) marker on the field or function that assumes it (see
// `src/bunq/client/bunq.client.ts`).

/**
 * The injected crypto seam bunq's handshake needs: RSA-2048 keypair
 * generation (the `/installation` client public key) and request-body
 * signing (CONFIRMED mandatory for `/session-server` since bunq's 2020
 * signing change; optional elsewhere and never used for a payment POST,
 * since this app is read-only). React Native has no built-in RSA and this
 * app's `@noble/hashes` dependency has none either, so this is injected
 * rather than hand-rolled — see `src/bunq/crypto/bunq-crypto.ts` for the
 * concrete-binding stub and `src/bunq/sync/sync.ts` for how it is threaded
 * through the handshake.
 */
export interface BunqCrypto {
  generateKeyPair(): Promise<{ privateKeyPem: string; publicKeyPem: string }>;
  sign(privateKeyPem: string, body: string): Promise<string>;
}

/**
 * bunq's tagged Response-array envelope: every endpoint returns
 * `{ Response: [{ <Tag>: <value> }, ...] }`, where `<Tag>` names the object
 * type (`Token`, `Id`, `UserPerson`, `MonetaryAccountBank`, `Payment`, ...).
 * A list endpoint additionally carries a `Pagination` object alongside
 * `Response`. TODO(VERIFY LIVE): the exact `Pagination` field set — assumed
 * `older_id`/`newer_id` cursor fields per the coordinator's verification
 * pass ("Pagination = query params count, older_id, newer_id (cursor)").
 */
export interface BunqResponseEnvelope {
  Response: Array<Record<string, unknown>>;
  Pagination?: { older_id?: number | string; newer_id?: number | string };
}

/** A bunq monetary amount: an alpha-ISO-4217 code plus a decimal-string MAJOR-unit value. */
export interface BunqAmount {
  currency: string;
  value: string;
}

export interface BunqAlias {
  type: string;
  value: string;
  name?: string;
}

/**
 * `MonetaryAccountBank` — CONFIRMED (coordinator): `GET
 * /v1/user/{userID}/monetary-account` returns a list of these. `alias` holds
 * the account's IBAN among other alias types (email, phone) —
 * TODO(VERIFY LIVE): confirm the literal `type` value is exactly `'IBAN'`.
 * TODO(VERIFY LIVE): a `MonetaryAccountSavings`/`MonetaryAccountJoint` entry
 * (a different Response tag) is not mapped here — see
 * `bunq.client.ts`'s `fetchMonetaryAccounts`.
 */
export interface BunqMonetaryAccount {
  id: number;
  currency: string;
  balance: BunqAmount;
  description?: string;
  alias?: BunqAlias[];
}

export interface BunqCounterpartyAlias {
  iban?: string;
  display_name?: string;
}

/**
 * `Payment` — CONFIRMED (coordinator): `GET
 * /v1/user/{userID}/monetary-account/{monetary-accountID}/payment`. `amount`
 * is a decimal-string MAJOR-unit `BunqAmount`, negative = outgoing. `created`
 * is CONFIRMED format `'YYYY-MM-DD HH:MM:SS.ffffff'` in UTC — see
 * `parseBunqTimestamp` (`src/bunq/sync/sync.ts`).
 */
export interface BunqPayment {
  id: number;
  created: string;
  updated?: string;
  amount: BunqAmount;
  description?: string;
  counterparty_alias?: BunqCounterpartyAlias;
}

/** The `Token` Response entry `/installation` and `/session-server` both return. */
export interface BunqToken {
  id: number;
  token: string;
}

/** The `Id` Response entry `/device-server` returns. */
export interface BunqId {
  id: number;
}

/**
 * The `UserPerson`/`UserCompany` Response entry `/session-server` returns
 * alongside the session `Token`. `session_timeout` (seconds) is the
 * best-effort field this client reads to size the cached session's expiry —
 * TODO(VERIFY LIVE): confirm this field's exact name/presence; a response
 * missing it falls back to a conservative default
 * (`DEFAULT_SESSION_TTL_SECONDS`, `bunq.client.ts`).
 */
export interface BunqUser {
  id: number;
  session_timeout?: number;
}
