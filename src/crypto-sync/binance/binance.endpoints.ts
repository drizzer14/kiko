// The privacy policy names what each path reads, so a path the app calls must be on a list the
// policy test checks: the request helpers take these unions, and an unlisted path fails the
// compiler.

/** The signed (key and secret) paths the app reads. */
export const BINANCE_SIGNED_PATHS = [
  '/api/v3/account',
  '/api/v3/myTrades',
  '/sapi/v1/asset/dribblet',
  '/sapi/v1/asset/get-funding-asset',
  '/sapi/v1/asset/transfer',
  '/sapi/v1/c2c/orderMatch/listUserOrderHistory',
  '/sapi/v1/capital/deposit/hisrec',
  '/sapi/v1/capital/withdraw/history',
  '/sapi/v1/convert/tradeFlow',
  '/sapi/v1/fiat/orders',
  '/sapi/v1/fiat/payments',
  '/sapi/v1/pay/transactions',
  '/sapi/v1/simple-earn/flexible/history/redemptionRecord',
  '/sapi/v1/simple-earn/flexible/history/rewardsRecord',
  '/sapi/v1/simple-earn/flexible/history/subscriptionRecord',
  '/sapi/v1/simple-earn/flexible/position',
  '/sapi/v1/simple-earn/locked/history/redemptionRecord',
  '/sapi/v1/simple-earn/locked/history/rewardsRecord',
  '/sapi/v1/simple-earn/locked/history/subscriptionRecord',
  '/sapi/v1/simple-earn/locked/position',
] as const;

/** The public (no key, no signature) paths the app reads. */
export const BINANCE_PUBLIC_PATHS = ['/api/v3/exchangeInfo', '/api/v3/klines'] as const;

export type BinanceSignedPath = (typeof BINANCE_SIGNED_PATHS)[number];

export type BinancePublicPath = (typeof BINANCE_PUBLIC_PATHS)[number];
