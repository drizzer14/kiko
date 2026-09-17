// Ambient types for the `@env` virtual module produced by the
// react-native-dotenv Babel plugin (see babel.config.js). Each name here
// must match a key in `.env`; the plugin inlines its string value at build
// time. Included by tsconfig's `**/*.ts` glob so `@env` imports type-check.
declare module '@env' {
  export const MONOBANK_API_ENDPOINT: string;
  export const PRIVATBANK_API_ENDPOINT: string;
  // bunq public API base URL (handshake + monetary-account/payment reads).
  // CONFIRMED (coordinator's live verification pass): sandbox
  // https://public-api.sandbox.bunq.com/v1, production
  // https://api.bunq.com/v1. Defaults to the sandbox base — see
  // `.env.example`'s own comment for the sandbox/production switch.
  export const BUNQ_API_ENDPOINT: string;
  // Starling Bank v2 public API base URL (accounts, balance, and feed
  // reads). COORDINATOR-VERIFIED against Starling's own docs: sandbox
  // https://api-sandbox.starlingbank.com, production
  // https://api.starlingbank.com. Defaults to the sandbox base — see
  // `.env.example`'s own comment for the sandbox/production switch.
  export const STARLING_API_ENDPOINT: string;
  // Base CoinGecko simple-price URL; the `ids`/`vs_currencies` query is built in
  // code from `src/rates/coingecko-ids` so the coin set cannot drift from a
  // stale committed `.env`.
  export const PRICE_ENDPOINT: string;
  export const BTC_EXPLORER_ENDPOINT: string;
  export const BINANCE_API_ENDPOINT: string;
  export const BINANCE_API_MANAGEMENT_URL: string;
  // DEV/TEST-ONLY (screenshot mode). Present only in `.env.screenshots`, absent
  // from the committed `.env`, so a production build inlines `undefined`. Typed
  // as optional to model that absence honestly — see src/screenshot/.
  export const SCREENSHOT_MODE: string | undefined;
  export const SCREENSHOT_LANG: string | undefined;
  // DEV/TEST-ONLY (screenshot dataset scenario). Present only in the regression
  // env files `.env.screenshots.empty.stable` / `.env.screenshots.locked.stable`;
  // absent from `.env`, `.env.screenshots`, and `.env.screenshots.stable`, so
  // those builds inline `undefined` and the seed defaults to the rich dataset.
  // Values: 'rich' | 'empty' | 'locked' — see src/screenshot/screenshot-mode.ts.
  export const SCREENSHOT_SCENARIO: string | undefined;
  // DEV/TEST-ONLY (STABLE-GLASS regression variant). Present only in
  // `.env.screenshots.stable`, absent from both `.env` and `.env.screenshots`,
  // so production and the real-glass marketing build both inline `undefined`
  // here. When `'true'` (and screenshot mode is on) GlassSurface renders a
  // fixed opaque surface instead of live LiquidGlass, so the pixelmatch
  // regression check gets byte-stable pixels — see src/screenshot/.
  export const SCREENSHOT_STABLE_GLASS: string | undefined;
}
