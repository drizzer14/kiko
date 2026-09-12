// Ambient types for the `@env` virtual module produced by the
// react-native-dotenv Babel plugin (see babel.config.js). Each name here
// must match a key in `.env`; the plugin inlines its string value at build
// time. Included by tsconfig's `**/*.ts` glob so `@env` imports type-check.
declare module '@env' {
  export const MONOBANK_API_ENDPOINT: string;
  export const PRICE_ENDPOINT: string;
  export const BTC_EXPLORER_ENDPOINT: string;
  export const BINANCE_API_ENDPOINT: string;
  export const BINANCE_API_MANAGEMENT_URL: string;
  // DEV/TEST-ONLY (screenshot mode). Present only in `.env.screenshots`, absent
  // from the committed `.env`, so a production build inlines `undefined`. Typed
  // as optional to model that absence honestly — see src/screenshot/.
  export const SCREENSHOT_MODE: string | undefined;
  export const SCREENSHOT_LANG: string | undefined;
  // DEV/TEST-ONLY (STABLE-GLASS regression variant). Present only in
  // `.env.screenshots.stable`, absent from both `.env` and `.env.screenshots`,
  // so production and the real-glass marketing build both inline `undefined`
  // here. When `'true'` (and screenshot mode is on) GlassSurface renders a
  // fixed opaque surface instead of live LiquidGlass, so the pixelmatch
  // regression check gets byte-stable pixels — see src/screenshot/.
  export const SCREENSHOT_STABLE_GLASS: string | undefined;
}
