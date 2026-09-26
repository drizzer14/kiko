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
  is imported from app code, in `src/navigation/root-navigator/root.navigator.tsx`,
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
- **`.jscpd.json` `ignore`**: `**/net-worth-line/net-worth-line.component.tsx`
  and `**/category-trend-line/category-trend-line.component.tsx` — the two
  line-chart components intentionally mirror each other's structure
  (documented in the `kiko-charts` skill: parallel scale/tick/path-building
  helpers for a two-axis SVG line chart). Verified PRE-EXISTING at base
  `5838bf7` (before the chart date-label change): the two files already
  shared 182 lines (13.03%) scoped together, not introduced by that change.
  Project-level `npm run check:dup` and `make gate` both PASS (the
  duplication only trips the changed-file-scoped medium-tier run when both
  files are in scope together). The `kiko:reviewer` ponytail review verdict
  on this pair was "lean already, nothing to cut" — there is no shared
  block left to extract without coupling two independently-evolving chart
  components through an artificial abstraction. Only these two component
  files are ignored; their test files and every other chart file stay in
  scope. Revisit or remove this exception if the two charts' structure
  ever diverges enough that the duplication is no longer a deliberate
  mirror.
- **`knip.json` `ignore`**: `scripts/checks/kill-guard.js` — the PreToolUse
  hook script that `scripts/checks/kill-guard.sh` invokes (`node
  kill-guard.js`) to tokenize a Bash-tool command and deny pkill/killall and
  pattern/process-group kills (see CLAUDE.md's "Automatic wiring" and
  `.claude/skills/kiko-linter/SKILL.md`). It is reached only from a sibling
  `.sh` wrapper's `node` invocation — never a static `import`/`require` from
  any TypeScript/JavaScript source, and never a package.json script Knip's
  static scan can see (unlike `scripts/ensure-env.js`, which IS a
  `postinstall` package.json script and so needs no ignore entry) — so
  Knip's reachability graph reports it as an unused file. It is exercised
  directly by `__tests__/kill-guard.test.ts`, which spawns
  `kill-guard.sh` (and so `kill-guard.js`) as a subprocess, not an import,
  so Jest's coverage does not make Knip see it as reachable either.
- **`knip.json` `ignore`**: `scripts/checks/pre-write-guard.js` — the
  PreToolUse hook script that `scripts/checks/pre-write-guard.sh` invokes
  (`node --experimental-strip-types --no-warnings pre-write-guard.js`) to
  rebuild an Edit/Write/MultiEdit's proposed file content and deny the
  write when it introduces a known violation (see CLAUDE.md's "Automatic
  wiring" and `.claude/skills/kiko-linter/SKILL.md`), the same reason as
  `kill-guard.js` above. It is reached only from a sibling `.sh` wrapper's
  `node` invocation — never a static `import`/`require` from any
  TypeScript/JavaScript source, and never a package.json script Knip's
  static scan can see — so Knip's reachability graph reports it as an
  unused file. It is exercised directly by
  `__tests__/pre-write-guard.test.ts`, which spawns `pre-write-guard.sh`
  (and so `pre-write-guard.js`) as a subprocess, not an import, so Jest's
  coverage does not make Knip see it as reachable either.
- **`knip.json` `ignore`**: `scripts/checks/import-order.js` — the same
  shape as `kill-guard.js` above. `scripts/checks/import-order.sh`
  reaches it only via a `node` invocation (both the fast-tier per-file
  check and the project-wide `check:import-order` mode), never a static
  `import`/`require`, and never a package.json script Knip's static scan
  can see, so Knip's reachability graph reports it as unused. Exercised
  directly by `__tests__/import-order.test.ts`, which spawns
  `import-order.sh` (and so `import-order.js`) as a subprocess, and by a
  direct `node import-order.js --write` invocation in the same test file
  — neither of which Jest's static import graph makes Knip see as
  reachable.
- **`knip.json` `ignore`**: `scripts/checks/full-word-identifiers.js` —
  the same shape as `import-order.js`/`kill-guard.js` above.
  `scripts/checks/full-word-identifiers.sh` reaches it only via a `node`
  invocation (both the fast-tier per-file check and the project-wide
  `check:full-word-identifiers` mode), never a static `import`/`require`,
  and never a package.json script Knip's static scan can see, so Knip's
  reachability graph reports it as unused. Exercised directly by
  `__tests__/full-word-identifiers.test.ts`, which spawns
  `full-word-identifiers.sh` (and so `full-word-identifiers.js`) as a
  subprocess — not an import, so Jest's coverage does not make Knip see it
  as reachable either.
- **`knip.json` `ignore`**: `scripts/checks/blank-line-separation.js` — the
  same shape as `import-order.js`/`full-word-identifiers.js`/
  `kill-guard.js` above. `scripts/checks/blank-line-separation.sh` reaches
  it only via a `node` invocation (both its per-file mode and its
  project-wide mode), and `scripts/checks/pre-write-guard.js` reaches it
  only via `runSpawnedNodeChecker`'s own `spawnSync` — never a static
  `import`/`require`, and never a package.json script Knip's static scan
  can see (it mechanizes kiko-code-style's "Blank lines before statement
  blocks" and "Blank line between adjacent JSX sibling nodes" rules, wired
  into the pre-write guard's `NODE_RULES` as `kiko-blank-line-separation`;
  it is guard-mode only for now — not yet in `check:all`, so its
  project-wide mode has no package.json script either), so Knip's
  reachability graph reports it as unused. Exercised directly by
  `__tests__/blank-line-separation.test.ts`, which spawns
  `blank-line-separation.sh` (and so `blank-line-separation.js`) as a
  subprocess, and by a direct `node blank-line-separation.js [--write]`
  invocation in the same test file, and by
  `__tests__/pre-write-guard.test.ts`'s `kiko-blank-line-separation` case
  (via `pre-write-guard.sh`) — none of which Jest's static import graph
  makes Knip see as reachable.
- **`knip.json` `ignore`**: `scripts/checks/screen-imports.js` — the same
  shape as `blank-line-separation.js`/`import-order.js`/`kill-guard.js`
  above. `scripts/checks/screen-imports.sh` reaches it only via a `node`
  invocation (both its per-file mode and its project-wide mode), and
  `scripts/checks/pre-write-guard.js` reaches it only via
  `runSpawnedNodeChecker`'s own `spawnSync` — never a static `import`/
  `require`, and never a package.json script Knip's static scan can see
  (it mechanizes the pre-write-guard design spec's rule 12, "no import from
  another screen's folder", wired into the pre-write guard's `NODE_RULES`
  as `kiko-no-cross-screen-import`; it is guard-mode only for now — not yet
  in `check:all`, so its project-wide mode has no package.json script
  either), so Knip's reachability graph reports it as unused. Exercised
  directly by `__tests__/screen-imports.test.ts`, which spawns
  `screen-imports.sh` (and so `screen-imports.js`) as a subprocess, and by
  a direct `node screen-imports.js` invocation in the same test file, and
  by `__tests__/pre-write-guard.test.ts`'s `kiko-no-cross-screen-import`
  case (via `pre-write-guard.sh`) — none of which Jest's static import
  graph makes Knip see as reachable.
- **`scripts/checks/full-word-identifiers.js`'s own `EXEMPTIONS` list**: an
  exact `(file path suffix, denylisted word, EXACT identifier name)`
  allowlist mechanizing kiko-code-style's "Full words in identifiers"
  exception for "a name forced by a third-party API/DB column/persisted
  JSON key". The `name` field (not just word) matters: it is what lets
  `src/crypto-sync/binance/binance.transactions.ts` exempt only its
  wire-mirrored `txId` field while still catching a DIFFERENT `tx`-bearing
  identifier chosen freely in the SAME file (`BinanceTransactionSyncDeps`, this
  codebase's own type name, correctly renamed to `BinanceTransactionSyncDeps`
  during the R1.d sweep — a word-only, file-wide exemption would have
  silently skipped that one too). Each of the 18 entries is a real,
  verified external-format mirror, not a style preference:
  `src/db/run-migrations.ts` + its test + the six
  `src/db/schema.*.test.ts` fixtures (`idx`) mirror drizzle-kit's own
  generated `_journal.json` `{idx, when, tag}` shape, which this runner
  reimplements byte-for-byte (see the file's own header comment);
  `src/bonds/nbu-register/nbu-register.ts` + its test (`val`, from
  `val_code`) mirror the National Bank of Ukraine securities register's
  own external JSON field; `src/crypto-sync/binance/binance.client.ts` +
  its test (`msg`) mirror Binance's own error-body shape `{code, msg}`;
  those same two files plus `binance.transactions.ts`/`.test.ts` (`tx`,
  from `txId`) mirror the literal field name on Binance's deposit/withdraw
  history records (`GET /sapi/v1/capital/deposit/hisrec` and
  `/withdraw/history`) — found only by reading the ACTUAL diff after an
  initial mechanical `tx` → `transaction` sweep pass, not by inspection
  beforehand, which is exactly why this allowlist is exact-name-scoped
  rather than trusted-by-eye; `src/crypto-sync/btc-wallet/btc-wallet.client.test.ts`
  (`tx`, from `tx_count`) mirrors the Esplora/Blockstream address-stats
  API's own field name; `src/design-system/components/currency-field/currency-field.component.tsx`
  (`num`, from `initialNumToRender`) is React Native's own `FlatList` prop
  name. A denylisted word anywhere else in the tree — including the same
  word in a different file, or a DIFFERENT identifier in the same file —
  still fails; add a new entry here only for another verified
  external-name case, per this file's own standing rule.
- **`rules/fixtures/**` (Biome `files.includes`, `knip.json` `ignore`,
  `.jscpd.json` `ignore`, `.depcheckrc.json` `ignorePatterns`, and
  `--exclude 'fixtures'` in `scripts/checks/security.sh`)**: the
  positive/negative fixture pair that
  proves each project Semgrep rule still fires. A positive fixture is
  deliberately non-conforming, never-imported code (a hidden Guideline 5.6
  feature flag import, a Keychain secret pushed into React state), and each
  pair is near-identical by construction — the negative fixture
  is the positive one plus the fix. Verified: without these exclusions a
  `.bad.tsx` fails Biome, reads as an unused file to Knip, and a pair reports
  40% duplicated lines / 43.71% duplicated tokens to jscpd, all by design.
  Fixtures are Semgrep inputs, never built or installed, so a positive
  fixture importing a banned package that is not a dependency (e.g.
  `kiko-no-swipe-action.bad.tsx`'s `react-native-swipe-list-view`) must not
  read as a missing dependency to depcheck. The
  semgrep `--exclude` is the bare directory name `fixtures` (semgrep matches it
  per path component), so it hits only `rules/fixtures`; the app's own
  `src/**/__fixtures__` stays in scope. No coverage is lost:
  `npm run check:rules` (`scripts/checks/semgrep-rules.sh`) is the check that
  DOES scan the directory, and it fails if any rule stops matching its positive
  fixture or starts matching its negative one.
- **Stryker mutate-set exclusions (`stryker.conf.json` `mutate`
  negations + the changed-file filter in `scripts/checks/mutation.sh`)**:
  five categories are excluded from the set of files Stryker
  mutates, in both run modes (the whole-project fallback array and the
  diff-scoped changed-file filter). (0) **`scripts/checks/**`** — the
  harness's own check tooling, not app logic; `import-order.js`,
  `kill-guard.js`, and `full-word-identifiers.js` are already exempt by
  extension (plain `.js`, outside the `**/*.ts`/`**/*.tsx` mutate glob),
  but `one-component-per-file.ts` (the one-exported-component-per-`.tsx`
  Jest invariant, moved here from `src/code-style/` so it is treated the
  same as the harness's other TypeScript-checked rules) needed an
  explicit pattern since it IS `.ts`. (1) **i18n locale catalogs
  (`src/i18n/locales/**`)** — pure nested string-data objects with no
  logic a surviving mutant could meaningfully expose (hundreds of
  low-value string mutants); the
  locale test assertions (e.g. `en.casing-by-role.test.ts`,
  `uk.casing.test.ts`) still run
  under Jest, so string/casing coverage is unaffected — only the mutation
  report drops those keys. (2) **`**/*.d.ts`** — type-only declarations,
  erased at compile time, so Stryker generates no runtime mutants from
  them; excluding them only trims the mutate-list. (3) **barrels
  (`**/index.ts`)** — pure re-export modules (`export ... from './x'`)
  whose only mutable token is the module-path string; no branch, no
  arithmetic, no logic, and no test imports the excluded barrels
  directly. The SOLE non-barrel `index.ts` is `src/i18n/index.ts` (an
  `i18next.init(...)` side-effect module with config booleans/strings),
  so it is RE-INCLUDED (`**/i18n/index.ts`, a positive pattern after the
  negation). (4) **pure-static styles (`**/*.styles.ts`)** — pure
  `StyleSheet.create` objects (string/number/object-literal tokens only,
  no conditionals or arithmetic); no test imports any `.styles` file, so
  their mutants are pure denominator noise. The two logic-bearing styles
  are RE-INCLUDED (positive patterns after the negation):
  `**/bottom-sheet.styles.ts` (runtime style functions with real `+`
  arithmetic, covered by `bottom-sheet.component.test.tsx`) and
  `**/entity-icon-tile.styles.ts` (exports the `iconTileSize` helper
  function). The mechanism is PURELY glob-based, not logic-based: the
  drop is by PATTERN — EVERY `**/index.ts` and EVERY `**/*.styles.ts`
  is negated — and ONLY the three named files above
  (`src/i18n/index.ts`, `bottom-sheet.styles.ts`,
  `entity-icon-tile.styles.ts`) are re-included, BY NAME. So the files
  that stay in scope (`src/design-system/palette.ts`, `theme.ts`,
  `entity-tint.ts`, the mixed const+function modules,
  `drizzle/migrations/**`, and every other non-`.styles`, non-barrel
  source) stay in scope simply because they never match the `index.ts`
  or `*.styles.ts` globs — NOT because any logic test spared them.
  MAINTENANCE: a NEW logic-bearing barrel or `*.styles.ts` will be
  SILENTLY dropped (its mutants lost) unless it is added to the
  re-include list in BOTH `stryker.conf.json` `mutate[]` AND the `grep`
  in `scripts/checks/mutation.sh` — the two must stay in sync.
  `drizzle/migrations/**` is
  already outside the `.ts/.tsx` mutate scope and needs no pattern.
  Order matters: each re-include is a positive pattern placed AFTER its
  negation (config patterns apply in array order; a later positive
  re-enables a file a prior `!`-negation disabled — `project-reader.js`).
  NOTE: the CLI `--mutate` REPLACES the config `mutate[]` wholesale
  (`deepMerge` replaces arrays, `deep-merge.js:13`), so on the
  diff-scoped run the config negations do NOT apply — which is why these
  same excludes/re-includes are mirrored in `mutation.sh`'s own `grep`
  filter, not only in `stryker.conf.json`. See the `mutate` array in
  `stryker.conf.json` and the changed-file `grep` filter in
  `scripts/checks/mutation.sh` for the exact patterns and re-includes
  (not restated in full here so they cannot drift).
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
- **`.env.test` (tracked, public-only test env file)**: a committed `.env`
  variant that mirrors `.env.example`.
  `jest.config.js` defaults `ENVFILE` to it (`process.env.ENVFILE = process.env.ENVFILE || '.env.test'`),
  so a fresh checkout runs hermetic Jest tests with no hand-edited local
  `.env`; an explicit `ENVFILE` still wins. Concrete
  justification: the native-banks render tests were non-hermetic — they
  depended on a hand-edited local `.env`, so a medium-tier green on one
  machine was not proof of a fresh checkout; defaulting to a committed file
  makes them reproducible. Every value is public, non-secret config (same
  rule as `.env` — see `dependency-hygiene.md`'s "`.env` is public-only").
  Updated 2026-09-18 (Guideline 5.6 remediation, Task 1): `.env.test` no
  longer carries a `SHOW_UNREADY_BANKS`-style flag — that release-readiness
  visibility gate was removed outright, not merely defaulted off. The "add
  a bank" sheet's `visibleCatalogEntries`
  (`src/screens/account-detail/add-bank-sheet/add-bank-sheet.component.tsx`)
  now takes no flag argument: it shows every wired-registry provider in the
  catalog unconditionally, so there is nothing left for a test-env value to
  gate. See the `kiko-architecture` skill's "Guideline 5.6 — no hidden
  features" section for the standing rule this codifies.
- **`e2e/screenshot/` — the demo-dataset subsystem lives outside `src/`,
  and `knip.json` needs NO entry/ignore for it (2026-09-19, Guideline 5.6
  remediation).** `src/` now has **zero** references into `e2e/`, of any
  kind — no static import, no dynamic `require`. The one dynamic `require`
  that used to reach `screenshot-seed.ts` from `MigrationsGate`
  (`src/migration/migrations-gate/migrations.gate.tsx`,
  `seedScreenshotDataIfEnabled`) was deleted outright: demo data now enters
  the app only through the real, user-visible Import UI, never a boot-time
  seed. The tightened Semgrep rule
  (`kiko-no-hidden-feature-flag-or-demo-import`, `rules/semgrep-mobile.yml`)
  enforces this for both shapes going forward — a static `e2e/` import and
  a dynamic `e2e/` `require` are both findings now, with no exemption.
  `e2e/screenshot/` still needs no `knip.json` config for the one reason
  that remains: Knip's Jest plugin already treats every file Jest's own
  (unmodified) default `testMatch` matches as an entry point, and that
  default pattern is repo-wide, not scoped to `src/` — so
  `e2e/screenshot/**/*.test.ts` (the dataset builder's, the snapshot
  mapper's, and the `.kiko` generator's colocated tests) keeps the whole
  subsystem in Knip's reachable graph without any repo-wide edit.
- **`ios/Kiko/Kiko.entitlements`'s `com.apple.security.application-groups`
  (`group.com.dmytro-vasylkivskyi.kiko`) is kept on purpose although
  currently unused (2026-09-23, user decision).** The net-worth home-screen
  widget and its `WidgetBridge` native module were removed
  (`f54ce63`, `bba473f`) and nothing in the app writes to the App Group
  today. The entitlement stays because removing it needs a NEW
  provisioning profile, and a future Share Extension entry point
  (`docs/plans/forms-bank-model.md`'s Share Extension step) is expected to
  need the same App Group to hand data to the main app. The two Semgrep
  ERROR rules that used to guard widget/App-Group Swift code
  (`kiko-widget-money-view-needs-privacysensitive`,
  `kiko-appgroup-write-needs-protection`) and their fixtures were removed
  2026-09-23 (`4e66dd7`) as dead — re-add both, with fixtures, the moment
  any code (a Share Extension or otherwise) writes to the App Group again.
- **The pre-write guard's override comment (`// nosemgrep: <rule-id>
  OVERRIDE(<reason>) <justification>`, or `kiko-override:` for a
  Node-checked rule) is the same shape as the Biome override protocol
  above, applied to `rules/semgrep-prewrite.yml` and the
  `NODE_RULES` in `scripts/checks/pre-write-guard.js`.** A bare
  `nosemgrep`/`kiko-override` comment with no `OVERRIDE(...)` never
  suppresses a finding — see `pre-write-guard.js`'s
  `OVERRIDE_COMMENT_PATTERN` and its surrounding comments for the
  exact match rule. Every `paths.exclude` scope added to
  `rules/semgrep-prewrite.yml` (one per rule, pointing at the real
  implementation a rule's own pattern would otherwise also flag) is
  documented inline in that file's own comments next to each rule —
  read the rule there rather than duplicating the list here, since a
  new rule's exclude would otherwise drift this bullet out of date.

- **`kiko-worklet-directive-required` (`rules/semgrep-prewrite.yml`)
  excludes every test file (`*.test.ts`, `*.test.tsx`, `__tests__/**`,
  `e2e/**`).** Jest mocks `react-native-reanimated`, so no worklet runtime
  ever captures a helper in a test file and the Release-only SIGABRT the
  rule guards against cannot happen there. The rule's `$F(...)` x
  statement-sequence match is also quadratic on a large test file whose
  "Gesture" substrings (`fireGestureHandler`, `GestureRootWrapper`) defeat
  Semgrep's prefilter: it crossed Semgrep's per-rule timeout under load, so
  the pre-write guard denied "could not check" at random. The rule's
  `rules/fixtures/` pair is not named like a test file and still proves the
  rule in `check:rules`; `__tests__/pre-write-guard-rules.test.ts` proves
  the exclusion.
