// Ambient types for the `@env` virtual module produced by the
// react-native-dotenv Babel plugin (see babel.config.js). Each name here
// must match a key in `.env`; the plugin inlines its string value at build
// time. Included by tsconfig's `**/*.ts` glob so `@env` imports type-check.
declare module '@env' {
  export const PRICE_ENDPOINT: string;
}
