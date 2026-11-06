// The privacy policy names what each path reads, so a path the app calls must be on a list the
// policy test checks: the request helpers take this union, and an unlisted path fails the
// compiler. Every path is a GET read; no order, no transfer and no other write has a place here.

/** The signed (key and secret) paths the app reads. */
export const BYBIT_SIGNED_PATHS = [
  '/v5/account/wallet-balance',
  '/v5/asset/deposit/query-internal-record',
  '/v5/asset/deposit/query-record',
  '/v5/asset/transfer/query-account-coins-balance',
  '/v5/asset/transfer/query-inter-transfer-list',
  '/v5/asset/withdraw/query-record',
  '/v5/user/query-api',
] as const;

export type BybitSignedPath = (typeof BYBIT_SIGNED_PATHS)[number];
