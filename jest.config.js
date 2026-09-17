// Bank providers gated by `connectReady:false` (bunq, PrivatBank) render in
// `AddBankProviderSheet` only for a TEST build (`SHOW_UNREADY_BANKS=true`).
// `react-native-dotenv` inlines `@env` from `process.env.ENVFILE || '.env'`
// at transform time, and `.env` is gitignored, so the gate must NOT depend
// on a local `.env`. Default every Jest run to the committed `.env.test`
// (flag on); an explicit ENVFILE (e.g. the screenshot flows) still wins.
process.env.ENVFILE = process.env.ENVFILE || '.env.test';

module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest/setup.js'],
  // fnts ships as pure ESM; Babel must transpile it to CJS for Jest, so it is
  // exempted from the preset's node_modules transform-ignore list.
  // react-native-unistyles resolves its "react-native" package.json export
  // condition to raw untranspiled TypeScript source (by design, so Metro's
  // own pipeline can process it); Jest's RN preset resolver follows that same
  // condition, so it needs the same transform-ignore exemption.
  //
  // react-native-gesture-handler, react-native-reanimated (its Jest mock pulls
  // in the package's own ESM source), react-native-worklets, and
  // react-native-sortables all ship untranspiled ESM (`import`), so each is
  // exempted from the preset's transform-ignore list for the drag-and-drop
  // grids to load under Babel/Jest. @noble/hashes (the Binance HMAC signer) is
  // ESM-only ("type": "module") for the same reason.
  //
  // react-native-calendars also ships untranspiled ESM ("main": "src/index.ts"
  // in its own package.json, and the .js files under src/ use bare `import`/
  // `export`). The app never renders it directly — jest/setup.js mocks the
  // bare `'react-native-calendars'` specifier to a plain View for every other
  // test — but the day-cell color-precedence regression test
  // (kiko-calendar.day-cell-color.test.tsx) deep-imports its real, unmocked
  // Day components (a different module specifier, so unaffected by that
  // mock) to prove the actual selected/today text-color precedence the
  // library applies, not just the marks data Kiko hands it.
  //
  // windows-1251 (Phase 3, statement-import's cp1251 decoder) ships ONLY an
  // ESM entry point (`"exports": "./windows-1251.mjs"`, no CJS build at
  // all) — same reason as the ESM-only deps above.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|fnts|react-native-unistyles|react-native-gesture-handler|react-native-reanimated|react-native-worklets|react-native-sortables|react-native-calendars|@noble|windows-1251)/)',
  ],
  // windows-1251 ships ONLY a `.mjs` entry point (`"exports":
  // "./windows-1251.mjs"`, no CJS build, no `"main"` field at all) — the RN
  // preset's own `transform` only matches `.(js|ts|tsx)$` (this key merges
  // INTO that map, it does not replace it), so `.mjs` needs its own entry
  // here for Babel to transpile its `import`/`export` syntax to CJS.
  transform: {
    '^.+\\.mjs$': 'babel-jest',
  },
  // `@kiko/*` path aliases map to `src/*` (mirrors tsconfig `paths` and the
  // babel `module-resolver` alias) so tests resolve the same specifiers the
  // app does.
  moduleNameMapper: {
    '^@kiko/(.*)$': '<rootDir>/src/$1',
  },
};
