// `react-native-dotenv` inlines `@env` from `process.env.ENVFILE || '.env'`
// at transform time, and `.env` is gitignored, so a Jest run must NOT depend
// on a local `.env`. Default every Jest run to the committed `.env.test`; an
// explicit `ENVFILE` still wins.
process.env.ENVFILE = process.env.ENVFILE || '.env.test';

// Local-calendar and DST tests assert Europe/Kyiv wall-clock times, so every
// host must run them on that zone. A `process.env.TZ` set inside a test only
// writes the test sandbox's own copy of `process.env` and never retargets
// `Date`, so the pin lives here: this file loads in the process that runs the
// tests in-band (Stryker's jest runner, a single-file `jest` run) and before
// `jest` forks its workers, which inherit the environment. It overrides the
// host `TZ` on purpose.
process.env.TZ = 'Europe/Kyiv';

module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./jest/setup.js'],
  // Resets every jest.fn()'s recorded calls/instances/results before each
  // test (does NOT touch mockImplementation/mockReturnValue setup) so a
  // module-scoped mock's call history from one `it` never leaks into the
  // next `it` in the same file/describe block.
  clearMocks: true,
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
  // Jest's default testMatch runs every file under a `__tests__/` folder as a
  // suite, so the shared harness-test helpers in `__tests__/test-support/`
  // would each fail as an empty suite. The lookahead keeps a `*.test.*` file
  // placed beside a helper running instead of silently skipping it.
  // `/node_modules/` is Jest's own default.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/__tests__/test-support/(?!.*\\.test\\.[jt]sx?$)',
  ],
};
