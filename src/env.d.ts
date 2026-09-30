// Ambient types for the `@env` virtual module produced by the
// react-native-dotenv Babel plugin (see babel.config.js). Each name here
// must match a key in `.env`; the plugin inlines its string value at build
// time. Included by tsconfig's `**/*.ts` glob so `@env` imports type-check.
declare module '@env' {
  export const MONOBANK_API_ENDPOINT: string;
  // Base CoinGecko simple-price URL; the `ids`/`vs_currencies` query is built in
  // code from `src/rates/coingecko-ids` so the coin set cannot drift from a
  // stale committed `.env`.
  export const PRICE_ENDPOINT: string;
  export const BTC_EXPLORER_ENDPOINT: string;
  export const BINANCE_API_ENDPOINT: string;
  export const BINANCE_API_MANAGEMENT_URL: string;
  // NBU's public bank.gov.ua host, shared by the fiat/metal rate clients and
  // the bond register; each call site appends its own path.
  export const NBU_API_ENDPOINT: string;
  export const COINGECKO_MARKET_CHART_ENDPOINT: string;
  export const PRIVACY_POLICY_URL_EN: string;
  export const PRIVACY_POLICY_URL_UK: string;
  export const EODHD_API_ENDPOINT: string;
  export const EODHD_SIGNUP_URL: string;
}
