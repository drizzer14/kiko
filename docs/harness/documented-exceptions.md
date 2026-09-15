# Documented exceptions (harness ignore-lists and suppressions)

> Reference detail moved out of CLAUDE.md (2026-09-15) to keep the root harness doc lean. CLAUDE.md points here. This is the authoritative content; edit it here.


Some tools cannot see how a dependency is actually used and would
otherwise report a false positive. Each exception below is a real,
verified usage, not dead weight:

- **`knip.json` `ignoreDependencies`**: `@babel/runtime` (injected by
  `@babel/plugin-transform-runtime` as helper imports in compiled
  output, never a static import), `@typescript/native-preview` (the
  `tsgo` / TS7 binary, reserved for a future typecheck script that
  does not exist yet), `jscpd`, `knip`, and `depcheck` (each invoked
  only via `npx --no-install <tool>` inside its own
  `scripts/checks/*.sh` wrapper, never from a package.json script
  Knip's static scan can see). Also `@env` — the virtual module that
  the `react-native-dotenv` Babel plugin synthesizes at transform time
  (`import { PRICE_ENDPOINT } from '@env'` in `src/rates/coingecko.ts`);
  it is not a real npm package, so Knip's resolver reports the import
  as an unlisted dependency. The package itself (`react-native-dotenv`)
  is seen through `babel.config.js`; only the synthetic `@env`
  specifier needs ignoring. Also `babel-plugin-inline-import` — a
  Babel plugin referenced only as the string `'inline-import'` in
  `babel.config.js` (it inlines the drizzle-orm migration `.sql`
  files as string exports), never imported from source, so Knip's
  static scan cannot see the usage. Also `babel-plugin-module-resolver`
  — a Babel plugin referenced only as the string `'module-resolver'` in
  `babel.config.js` (it resolves the `@kiko/*` path aliases to `src/*`),
  never imported from source, so Knip's static scan cannot see the usage.
- **`tsconfig.json` `compilerOptions.types`**: the base
  `@react-native/typescript-config` pins `types: ["jest"]`, which
  drops the Node ambient globals and module typings that four test
  files legitimately use — `src/db/schema.category-overrides.test.ts`
  and `src/categories/categories.repo.test.ts` read
  `drizzle/migrations` through `node:fs` + `__dirname`,
  `__tests__/info-plist.test.ts` reads `ios/Kiko/Info.plist` the same
  way, and `src/holdings/interest.test.ts` sets `process.env.TZ` to
  force a DST-observing zone. Jest runs on Node, so these are real,
  available globals, not a shim; the list is widened to
  `["jest", "node"]` (never to `[]`, which would admit every
  `@types/*` package in `node_modules` and silently weaken the
  check). This is a genuine widening of what `check:typecheck` can
  see, not a suppression of any error it reports. The two other
  `global` uses were fixed in the code instead — `jest.spyOn(global,
  ...)` became `jest.spyOn(globalThis, ...)`, which needs no Node
  typings at all. Be honest about the cost: `tsconfig.json` is a
  SINGLE project covering source and tests alike, so this widening is
  project-wide — a **production** file that imported `node:fs` would
  now typecheck clean instead of failing, even though React Native has
  no Node runtime and it would crash on device. Nothing does that
  today, and `check:security`/review are the backstop; the eventual
  remedy is a second, test-scoped tsconfig project (tests reference a
  `tsconfig.test.json` that adds `node`, while the app project keeps
  `types: ["jest"]`), which would make the widening unreachable from
  `src/**` non-test code. That is deferred, not forgotten.
- **`.depcheckrc.json` `ignores`**: the same CLI-only-invoked tools
  (`jscpd`, `knip`, `depcheck`) plus `@babel/runtime`,
  `@react-native-community/cli` and `-cli-platform-ios` (invoked by
  the `react-native` CLI, not imported), `@stryker-mutator/core` /
  `-jest-runner` (used via `stryker.conf.json` + npx), `@types/jest`
  (type-only), `@types/node` (type-only, in the same class as
  `@types/jest`: it is never imported, it is reached through
  `tsconfig.json`'s `types: ["jest", "node"]` so the file-reading
  tests can see `node:fs`/`node:path`/`__dirname`/`process`), and
  `typescript` (provides `tsc`/type declarations for the toolchain,
  and now backs `check:typecheck`, but is still never imported from
  source). Also
  `react-native-screens` (a required runtime peer of
  `@react-navigation/native-stack` — the native stack renders through
  it; it is imported inside `native-stack`, never by app code, so
  depcheck's static scan cannot see it), `react-native-nitro-modules`
  (the NitroModules native backend that `react-native-unistyles` is
  built on; required at runtime, never statically imported by app
  code), and `react-native-bottom-tabs` (the native tab-bar peer of
  `@bottom-tabs/react-navigation` — its `NativeBottomTabView` imports
  the real `TabView` component from `react-native-bottom-tabs` to
  render the tab bar on-device; only `@bottom-tabs/react-navigation`
  is imported from app code, in `src/navigation/root.navigator.tsx`,
  so depcheck's static scan cannot see `react-native-bottom-tabs`
  itself being used). Also `react-native-dotenv` — a Babel plugin referenced only
  as the string `'module:react-native-dotenv'` in `babel.config.js`,
  never imported from source, so depcheck's static scan cannot see the
  usage and reports it as an unused devDependency. Also
  `babel-plugin-inline-import` — a Babel plugin referenced only as the
  string `'inline-import'` in `babel.config.js` (it inlines the
  drizzle-orm migration `.sql` files as string exports), never
  imported from source, for the same reason. Also
  `babel-plugin-module-resolver` — referenced only as the string
  `'module-resolver'` in `babel.config.js` (it resolves the `@kiko/*`
  path aliases to `src/*`), never imported from source, for the same
  reason.
- **`.gitleaks.toml` allowlist**: `ios/Podfile.lock` — CocoaPods lists
  a SHA1 checksum per pod, which gitleaks' `generic-api-key` rule
  flags as a false positive (verified fingerprint:
  `ios/Podfile.lock:generic-api-key:1966`). Also `.superpowers/.*` —
  gitignored SDD scratch. Its generated review-diff artifacts echo
  `ios/Podfile.lock` CocoaPods SHA1 checksums (same false-positive
  class as the entry above) that trip `generic-api-key`, and a new
  uniquely-named diff is written on every review cycle, so a
  per-finding exception cannot stay green. Nothing under
  `.superpowers/` ever enters git history (the threat the secrets
  check guards against) — same class as `node_modules`/`ios/Pods`/
  `vendor`, so it is path-allowlisted the same way. Do not quote a
  literal 40-character hex checksum value in any tracked file. Also
  `ios/build/.*` — the generated, gitignored Release device build
  output. Its minified `main.jsbundle` (produced by a Release
  `-iphoneos` build) contains minified identifiers such as
  `obj2Keys.length` and `_usePropsWithDefaults2` that trip
  `generic-api-key`. gitleaks scans the filesystem (`--no-git`) and
  picks these up even though `ios/build/` never enters git — same
  false-positive class as the `ios/Podfile.lock`/`.superpowers/`
  entries above, path-allowlisted the same way as
  `node_modules`/`ios/Pods`/`vendor`. Also a `regexes` entry for the
  bech32 address `bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq` — the
  canonical BIP-173 example, used as test data throughout
  `docs/superpowers/plans/2026-09-04-crypto-btc-sync.md` (16
  occurrences); a public documentation example, not a secret, that
  trips `generic-api-key` only on the `metadataKey: '...'` line.
  Allowlisting the exact value is narrower than a path allowlist and
  keeps real-secret scanning of every tracked file intact.
- **`.jscpd.json` `ignore`**: `**/drizzle/migrations/meta/*_snapshot.json`
  — drizzle-kit's schema snapshots are tool-generated and *cumulative*:
  each `NNNN_snapshot.json` embeds the entire prior schema plus that
  migration's delta, so consecutive snapshots are near-identical by
  design (`0000`/`0001`/`0002` clone each other at ~35–65%). There is
  nothing to "extract into a shared function" — drizzle-kit owns the
  format and regenerates these files wholesale, so copy/paste detection
  is a pure false positive on them. Only the generated `*_snapshot.json`
  files are excluded; the hand-authored `.sql` migrations and every
  other JSON file stay in scope.
- **`rules/fixtures/**` (Biome `files.includes`, `knip.json` `ignore`,
  `.jscpd.json` `ignore`, and `--exclude 'fixtures'` in
  `scripts/checks/security.sh`)**: the positive/negative fixture pair that
  proves each project Semgrep rule still fires. A positive fixture is
  deliberately non-conforming, never-imported code (an unredacted widget money
  view, an unprotected App Group write, a Keychain secret pushed into React
  state), and each pair is near-identical by construction — the negative fixture
  is the positive one plus the fix. Verified: without these exclusions a
  `.bad.tsx` fails Biome, reads as an unused file to Knip, and a pair reports
  40% duplicated lines / 43.71% duplicated tokens to jscpd, all by design. The
  semgrep `--exclude` is the bare directory name `fixtures` (semgrep matches it
  per path component), so it hits only `rules/fixtures`; the app's own
  `src/**/__fixtures__` stays in scope. No coverage is lost:
  `npm run check:rules` (`scripts/checks/semgrep-rules.sh`) is the check that
  DOES scan the directory, and it fails if any rule stops matching its positive
  fixture or starts matching its negative one.
- **Stryker mutate-set exclusions (`stryker.conf.json` `mutate`
  negations + the changed-file filter in `scripts/checks/mutation.sh`)**:
  two NON-LOGIC categories are excluded from the set of files Stryker
  mutates, in both run modes (the whole-project fallback array and the
  diff-scoped changed-file filter). (1) **i18n locale catalogs
  (`src/i18n/locales/**`)** — pure nested string-data objects with no
  logic a surviving mutant could meaningfully expose (hundreds of
  low-value string mutants); the
  locale test assertions (e.g. `en.button-casing.test.ts`) still run
  under Jest, so string/casing coverage is unaffected — only the mutation
  report drops those keys. (2) **`**/*.d.ts`** — type-only declarations,
  erased at compile time, so Stryker generates no runtime mutants from
  them; excluding them only trims the mutate-list. Nothing else is
  excluded: `src/design-system/palette.ts`, `theme.ts`, `entity-tint.ts`,
  every `*.styles.ts`, `src/i18n/index.ts`, the mixed const+function
  modules, and the barrels all stay IN scope. `drizzle/migrations/**` is
  already outside the `.ts/.tsx` mutate scope and needs no pattern. See
  the `mutate` array in `stryker.conf.json` and the changed-file `grep
  -Ev` filter in `scripts/checks/mutation.sh` for the exact patterns
  (not restated here so they cannot drift).
- **Stryker sandbox exclusions (`stryker.conf.json` `ignorePatterns`)**:
  Stryker copies every non-ignored project file into a temp sandbox before
  each run (verified in `@stryker-mutator/core` 8.7.1
  `fs/project-reader.js` + `sandbox/sandbox.js`; its own always-ignored set
  is `node_modules`, `.git`, `*.tsbuildinfo`, `/stryker.log`, `.next`,
  `.nuxt`, `.svelte-kit`, plus the temp dir and the incremental/html/json
  report files — `node_modules` is symlinked, not copied). `ignorePatterns`
  keeps large NON-SOURCE, NON-TEST-READ dirs out of that copy: `ios` and
  `android` (native projects; pre-existing), plus `vendor` (the vendored
  CocoaPods Ruby bundle under `vendor/bundle/ruby/...`), `coverage`
  (generated jest coverage), `docs` (Markdown, never imported), and
  `.superpowers` (gitignored SDD scratch). Each was verified to have ZERO
  filesystem reads from any test or source module (grep of every
  `*.test.ts(x)` / `__tests__/**` / jest setup for `readFileSync`,
  `existsSync`, `__dirname`, `require` of a non-module path). **KEEP-LIST**
  — external paths tests DO read, which must stay in the sandbox and are
  therefore NOT ignored: `drizzle/migrations/**` (read by
  `src/db/schema.*.test.ts`, `src/categories/categories.repo.test.ts`,
  and `src/db/__fixtures__/seed-category-colors.ts` via `__dirname`
  +`node:fs`) and `scripts/checks/*.sh` (read by the `__tests__/mutation-*`
  wrapper tests). `reports/` is deliberately kept: Stryker's incremental
  report (`incremental: true`) is read from the PROJECT ROOT and is already
  in the always-ignored set, so keeping the dir is harmless and safer than
  excluding it. `ios` stays ignored even though `__tests__/info-plist.test.ts`
  reads `ios/Kiko/Info.plist`: the Stryker jest-runner defaults
  `enableFindRelatedTests: true`, so only tests transitively importing a
  mutated source file run, and that test imports no app source — it never
  runs under Stryker, so the missing `ios/` in the sandbox never breaks it.
  Final confirmation of any missing-file mistake comes from the FIRST real
  mutation run after integration: Stryker runs the covering test suite once
  before mutating, so a wrongly-excluded read fails FAST with a clear
  ENOENT rather than silently corrupting the score — that fail-fast is the
  accepted safety net.
- **`.npmrc` `min-release-age-exclude`**: `Kiko`, the first-party
  package name, is exempt from the dependency min-age rule below.
  `react-native` is exempt for the same category of reason: it is an
  explicitly pinned core framework, not a freshly-published
  auto-selected dependency, and react-native@0.87.1 being <7 days old
  otherwise breaks npm's ranged-peer resolver (a dependent like
  react-native-unistyles declares `react-native>=0.76.0`, and
  `min-release-age` filtering RN out of the packument means npm
  cannot validate that range against it — surfacing as an ERESOLVE
  error without `--legacy-peer-deps`).
- **`scripts/checks/screenshots.sh` `EXCLUDE_FROM_DIFF`**: 3 of the 10
  `check:screenshots` shots (`02-home-transactions-scrolled`,
  `07-statistics-account-contribution`,
  `08-statistics-expenses-by-category`) are captured and committed
  like every other shot but are skipped by the pixel-diff itself (via
  `compare-png.js`'s `excludeCsv` CLI arg). Verified, reproducible
  cause: all 3 are `scrollUntilVisible`-to-mid-content shots, and
  Maestro's scroll-stop offset for a target in the MIDDLE of a
  scrollable range is momentum-dependent — a few px of run-to-run
  landing drift shifts the whole captured frame (measured 7.75%,
  18.9%, and 10.6% mismatch respectively on an otherwise byte-stable,
  stable-glass build where the other 7 shots diff at 0%). This is not
  a tolerance loosening (`THRESHOLD`/`MAX_MISMATCH_RATIO` are
  unchanged) and not a glass or animation issue (stable-glass and
  `waitForAnimationToEnd` already remove those) — it is the exclusion
  of a genuinely non-deterministic INPUT the pixel-diff cannot be made
  to tolerate without hiding a real regression on every OTHER shot
  too. See the `check:screenshots` section above for the full
  writeup, including the untried mitigation (a gentler
  `scrollUntilVisible` `speed`) that could reclaim these 3 shots.

