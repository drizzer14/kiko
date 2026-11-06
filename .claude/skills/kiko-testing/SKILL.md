---
name: kiko-testing
description: Invoke whenever you write or change a test: __tests__/**, a *.test.ts(x) file, src/test-support/**, jest.config.js, __mocks__/**, e2e/** Maestro flows, or debug a test that passes in jest but not on the device (Hermes, hit-testing, a real navigator) or passes on one machine only (time zone, `.env`). Read before writing a repository test (real SQLite or a fake database), a render or navigator test, a property sweep, an acceptance pin, an absence assertion, a subset matcher, or a fix-round regression test, and before adding a test double or helper. For code style see kiko-code-style; for the mutation gate and its checks see kiko-linter and docs/harness/checks.md.
---

# Kiko testing

How a Kiko test is written, and the shared helpers it reaches for. The rules here are the ones a
test author gets wrong without a reminder; style rules for the test code itself (comments, full
words, `fnts`, one component per file) stay in kiko-code-style and apply to a test too.

## Where a test lives and what it must prove

- A unit or component test is Jest with `@testing-library/react-native`, colocated next to its
  source as `<name>.test.ts(x)`, not in a `__tests__/` folder (kiko-code-style, "File suffixes").
  `__tests__/` holds the harness tests (scripts, rules, docs); an iOS end-to-end test is a Maestro
  YAML flow under `e2e/`.
- A test asserts real behavior. An assertion-free test fails the Stryker check.
- A real-repository inventory row lives in a top-level `__tests__/*.test.ts` that `make doc-suites`
  discovers; a row under `__tests__/test-support/` runs only in the queued verify, too late for a
  scribe. Each explicit NO in a matching ruling gets its own negative fixture row: a rule pinned
  only by the real-repository row moves whenever the docs change.
- An assertion that reads back a fixture literal instead of a value the code under test wrote or
  computed is not a test of the code: it only proves the fixture equals itself.
- Every test typechecks under `npm run check:typecheck`. Never `as never` to satisfy a
  navigation-prop type: use the typed helpers of `src/test-support/navigation-props.ts`.
- A form's Save is a native nav-bar item: press it with `pressSave` from
  `src/test-support/form-header-items.ts` (see the kiko-design-system form Save bullet), never
  `getByText('Save')`.
- Iterate with `make jest-affected` or named files (`npx jest <files> --maxWorkers=2`). A change to
  a shared value, a shared component's render shape, or an i18n string that tests match on ripples
  to every consumer, so the scoped run must include every consumer; a scoped run never proves a
  task green. After a file split, run the suites that key by file path too (the `src/i18n` call
  site allowlists). After a migration or snapshot change, the demo `.kiko` fixtures under
  `e2e/screenshot/fixtures/` need regenerating: scoped jest never reads them. The whole suite
  runs only in the queued verify (CLAUDE.md, "Checks").

## Shared test helpers

Reuse a helper before writing a second double; read the module's exports there, and extend it
rather than declaring one per file. `@kiko/test-support/<name>` is `src/test-support/<name>`.
Before adding a double or helper, list the test-support folder(s) for the current set. A helper
file the catalogue below does not list fails `__tests__/skill-text-checks.test.ts`: list yours.

### `src/test-support/`

- `navigation-props.ts`: the navigation prop and route prop doubles screen tests assert on
  (`navigationSpy`, `asNavigationProp`, `asRouteProp`, `paramsAfter`).
- `focus-navigation.tsx`: a navigation that keeps only `focus` and `blur` listeners.
- `real-tab-navigator.tsx`, `navigator-stack-probe.tsx`: the REAL React Navigation routers and a
  stack reader, for a navigator test a spy cannot replace.
- `transaction-form-data-layer.ts`: the data layer the real transaction form reads and writes,
  for a navigator test that renders it.
- `recurring-mark-live-queries.ts`: the settings and whole-ledger reads of the transaction form's
  mark field (`createMarkLiveQueries`, `taggedQuery`) and the Netflix fixtures its three suites
  share.
- `recurring-ledger.ts`: builders for a recurring-detection ledger (`ledgerOf`, `chargeOf`,
  `monthly`, `weekly`, `holdingOf`, `randomLedgerOf`) and the views that compare series with
  their expected shape (`viewsOf`, `expectedViewsOf`).
- `marked-series-world.ts`: the mark, expected-series and outcome types of a marked-series world,
  and the views and random entries (`entryOf`, `outcomeOf`, `randomEntriesOf`) that check it.
- `marked-series-worlds.ts`: the table of marked-series worlds (`ONE_AMOUNT_WORLDS`,
  `exclusionWorlds`) and the small builders they share (`series`, `marked`, `detected`, `chain`).
- `marked-series-chain-worlds.ts`: the amount-chain worlds (`AMOUNT_CHAIN_WORLDS`), built from the
  same builders.
- `marked-series-hook-result.ts`: what the series hook hands its screens for a ledger and marked
  entries (`hookStateOf`, with the `MarkedNames` type), made of the real detection functions.
- `mock-recurring-groups.ts`: a stand-in for `useRecurringGroups` in a suite that does not test
  the groups (the real grouping over no charge rows, one default category group); wire it with
  `import { useRecurringGroups as mockUseRecurringGroups } from
  '@kiko/test-support/mock-recurring-groups'` and
  `jest.mock('@kiko/recurring/use-recurring-groups', () => ({ useRecurringGroups: (shown:
  RecurringSeries[]) => mockUseRecurringGroups(shown) }))`; `jest.mock` hoists, so only a
  `mock`-prefixed name works.
- `sqlite-live-query.ts`, `recurring-sqlite-world.ts`: a navigator test's whole data layer on a
  real migrated `node:sqlite` database (`clientModule`, `openSqliteWorld`; a
  `rawDatabase.reactiveExecute` double fires the real `useLiveQuery` on a committed write), and
  the rows of a `ledgerOf` ledger put into it.
- `form-header-items.ts`: the nav-bar items a form sets (`pressSave`, `saveItem`,
  `expectNavBarSaveOnly`).
- `account-form-test-support.ts`: `selectKind`, `selectExchange` and sync-module doubles for an
  account form test; `pick-category.ts`: picks a category from the field's bottom sheet.
- `held-currencies.ts`: the currencies the user holds, for a screen that renders a currency
  picker; `saved-reminder.ts`: an active daily reminder row; `permission-notice-cases.ts`: the
  shared notification-permission notice cases.
- `rendered-element.d.ts` (the element type of every RNTL query), `ancestor-with-style.ts`,
  `layout-of.ts`, `glyphs-within.ts`, `field-suffix.ts`: readers over a rendered tree.
- `mock-text-tone.tsx`, `mock-text-variant-tone.tsx`, `field-label-spy.ts`: Text and FieldLabel
  mocks that hand through a unistyles variant the Jest mock strips.
- `layout-mode-spy.ts`, `modal-animation-spy.ts`, `mock-reanimated-scroll-to-end.ts`,
  `gesture-root-wrapper.tsx`: doubles for the layout mode, a Modal's animation, a scroll ref and
  a gesture root.
- `lift-grid-card.ts`, `hold-card.ts`: a drag lifecycle and a touch-and-hold driven through props,
  because Jest cannot hit-test.
- `native-spec-lookup.ts`: the native-spec lookup check; the caller passes a thunk holding its own
  literal `jest.requireActual` call.
- `real-sqlite.ts`: a real `node:sqlite` engine, `applyAllMigrations`, `applyMigrationsThrough`
  and the Drizzle `.toSQL()` proxy; `delete-cascade-fixture.ts`: the rows a delete-cascade test
  starts from; `implicit-total-parity.ts`: the implicit account whose total two screens read.
- `binance-real-sqlite.ts`, `binance-backfill-world.ts`, `walk-marks.ts`, `walk-disturbances.ts`:
  the database set-up, the backfill world, the single reader of a walk's marks and the disturbance
  loop of the Binance history walk tests.
- `property-sweep.ts`, `seeded-random.ts`: `sweep` for a property seed list; a seeded generator.
- `local-days-from.ts`, `device-zone-offset.ts`: calendar-day arithmetic and a device-zone offset
  for a test whose dates cross DST.
- `code-from-currency.ts`: the numeric ISO code of a currency, for a Monobank feed fixture.
- `window-size.ts`: `reportWindow` (the size class the native display-regions module reports, plus
  the window size; call it before the first render) and `resizeWindow` (resize a mounted tree).
- `lazy-tabs.tsx`: a tab navigator on the real `TabRouter` that mounts a tab on its first focus and
  keeps it mounted, as the native bottom tabs do.
- `pane-stack-presentation.ts`: `nonPushPresentations`, the pane-stack screens whose options set a
  presentation other than a push; `test-ids-in-order.ts`: `testIdsInOrder`, every testID of a
  rendered tree in paint order; `header-configs.ts`: `headerConfigsIn`, the props of every native
  header config (`RNSScreenStackHeaderConfig`) of a rendered tree in paint order, what
  native-stack derives from the merged options; assert on it instead of a hand-rolled tree walk.
- `mock-statistics-data-layer.ts`, `statistics-filter-data.ts`: the mocked data layer a real
  Statistics screen (or Home) mounts on, and its filter fixtures (`answerFilterData`,
  `pressFilterOption`, `transactionRowOf` (a transaction row with defaults), the filter testIDs).
- `reset-statistics-filter-selection.ts`: `resetStatisticsFilterSelection`, an `afterEach` that
  puts the session-long Statistics account and category picks back on "all".
- `node-handles.ts`: `mockFindNodeHandle`, a stand-in that gives each distinct host its own handle
  where Jest's `findNodeHandle` returns null, for a share-anchor pin.

### `__tests__/test-support/` (harness tests)

- `temporary-directory.ts`, `isolated-git.ts`, `repository-files.ts`, `read-text-file.ts`: a
  throwaway folder, a git environment free of the developer's config, the tracked-plus-untracked
  file list, and a text read that keeps a spawning suite in the doc-suite discovery.
- `kill-guard-decide.ts`, `kill-guard-fake-repository.ts`, `copy-kill-guard.ts`: judge a command
  in a fake repository without running it, and copy the real guard with its requires.
- `mutation-repository.ts`, `mutation-score-report.ts`, `stryker-jest-runner.ts`,
  `stryker-mutant-run-probe.ts`, `mutation-binance-set3b.ts`: fixtures for the mutation wrapper,
  the scorer and the patched Stryker runner.
- `sysctl-stub.ts`, `warm-executables.ts`: a load stub and the warm-up of a never-run stub script,
  so a spawned script never waits.
- `skill-text.ts`, `orphan-reference-files.ts`, `markdown-code-spans.ts`,
  `source-comment-citations.ts`, `prose-citations.ts`, `spec-test-rows.ts`: the readers the doc
  suites share (a skill's files, its backtick spans, the paths a source comment names, the
  skill sections a prose citation quotes, a spec table's Test cells).
- `deployment-target.ts`, `sf-symbol-catalogue.ts`: the readers of the iOS target and of the
  SF Symbols availability data.
- `plist-root.ts`: `buildPlistRoot` and `runPlistCheck`, a throwaway root with a copy of
  `plist.sh` and the plist, project and privacy files a case overrides.

## Real SQLite versus a fake database

- A repository test whose SQL matters (a join, an aggregate, NULL handling, a foreign key, an
  upsert) runs the REAL repo on a real migrated database:
  `jest.mock('@kiko/db/client', () => executingClient(() => mockDatabase))` with a `node:sqlite`
  `DatabaseSync` prepared by `applyAllMigrations`, both from `src/test-support/real-sqlite.ts`
  (see `src/reminders/repo/reminders.repo.test.ts`). Prefer this over a fake.
- Otherwise a repository test drives the real repo functions through a fake transaction handle:
  mock `write` (and `select` when a read path is under test) via `jest.mock('@kiko/db/client')`,
  back it with a plain-array store, and let the REAL repository function run against it. See
  `src/holdings/repo/holdings.repo.test.ts` for the canonical shape; extend it, do not invent a
  second style. Span the fake across two repos in one store when a test exercises both (a
  disconnect-then-reconnect sequence).
- A hand-rolled fake DB or transaction handle must THROW on an unknown column or table, and its
  `select` must honour its projection: a permissive fake hides a real bug behind a green test, and
  a `select` that ignores its projection masks every mutant on the selected columns.
- A change to a repository function's columns or shape greps every fake transaction or database
  handle that drives it and updates each.
- A `jest.mock` factory replaces the whole module. When an import rewrite makes production code
  resolve a function through a partially mocked module (`holdingsRepo.balanceOf` via the barrel),
  add that function to the factory; never widen the mock to the real module.
  A mock must target the module that holds the call site. After you extract code,
  re-point each mock of a function that the moved code calls from a sibling file
  (a mock on the barrel `exchange/walk` missed `runWalkPlan`, which
  `exchange-walk-plan.ts` calls from `./walk`).
- Before adding a prop to a hand-written `__mocks__` module, check the real library's own type in
  `node_modules` first. A mock that accepts a prop the real component discards lets a test pass
  while the real UI is silently broken: forward only the props the real library consumes.

## Acceptance pins, fix rounds and red proofs

- A red row (or red-fixture file) is run through a working prototype of its check before the
  red commit: a row written without one can contradict its own spec (a wrong-direction row
  that listed two of its three citations).
- A pin that greps tests for a walking literal misses a suite that walks through a helper:
  grep the helper folder first, then the importers of each helper found.

- An acceptance pin's seed or world is part of the pin (harness-workflow, "An acceptance pin's
  seed or world"): re-seed it with one per-pin seed line, never in the shared helper. The shared
  helpers (`src/test-support/walk-marks.ts`, `binance-backfill-world.ts`) are an edit of every pin
  on them.
- Never edit, widen, skip or loosen an existing expectation to make new code pass, and never move
  an acceptance pin around a loss: a failing pin is the result of a fix round, reported red. If a
  new requirement genuinely conflicts with an existing assertion, stop and report both
  expectations for a human to rule on. Edit only assertions that pin the section under change, and
  name the approved default that forces the edit in the commit message. The fix-round brief says
  so, and the reviewer diffs the test files for pin edits before accepting the round.
- A RED must fail for the stated reason, and the report shows the failing output, not a claim of
  it. Every regression test of a fix round is shown red on the PARENT source (run it against the
  old file in a scratch copy, or a scratch jest config whose `moduleNameMapper` points the import
  at the old file extracted with `git show`); the report quotes the red count, and the reviewer
  re-runs it. A test that cannot fail pins nothing.
- A test change kept as a fix is load-bearing: scratch-mutate the code and show the change turns a
  green run red; else record it as not load-bearing. A negative
  `expect(spy).not.toHaveBeenCalledWith(tag, exactPayload)` cannot fail when the code logs the
  same tag with another payload: pin the tag with `expect.anything()` as the payload and show it
  red with a log-only mutant.
- A quantitative fix (rows lost, a count) is proven by running the simulation on both tips and
  quoting old against new; a reported number is never trusted unrun.
- State shared across series or types (a depth, a band, a skip) needs a cross-type pin: one case
  where a later type's data differs from the answer of the earlier type. Per-type tests all pass
  when every type has the same data.
- A quoted label that exists in a catalogue is not proof the step is right: the pin checks
  existence, not visibility per screen and state. Check the rendering code and the screen state.
- After a hook is extracted out of a screen, a green suite on the hook alone does not prove the
  screen wires every one of the hook's outputs to a prop. Add a screen-level integration test (or
  a manual "does every hook field reach a prop" pass) in the SAME change as the extraction.

## Mutant-aware tests

The mutation gate (docs/harness/checks.md and kiko-linter) grades the tests; these rules keep a
test from being decorative.

- A boundary mutant (`<=` against `<`) dies only on a case exactly on the limit, with float-exact
  values on both sides. Assert the computed width or value first, so the case is proven to sit on
  the limit.
- A loading-gate test deletes the gate and confirms the test fails: a `useLiveQuery` mock that
  ignores `enabled`, or returns loaded data at once, passes with the gate removed. An
  exact-decision predicate is proven with a temporary `|| true` mutation; a fixture whose needle is
  JSON-quoted never reaches an instr prefilter and passes vacuously.
- A property suite is accepted only after it kills NAMED mutants, each run and counted (killed of
  total, in the review brief); a property no named mutant breaks proves nothing.
- A mutant is "equivalent" only if it behaves the same on the app's engine (Hermes), not only in
  Jest (V8): before classifying a survivor as equivalent, ask whether the proof depends on a V8
  detail (a sort comparator's sign, `Intl`, a text codec); if so, pin the contract directly.
- A re-render with the SAME prop value never re-runs a `[value]` effect, so the test passes without
  exercising it: pick a distinct value. A one-frame paint bug (a stale value shown for one render)
  needs a render-log pin that records every render and asserts none shows the stale value; a
  final-state assertion misses it.
- A counted-work pin counts the work itself (sort comparisons, calls of the inner function), not
  reads on input rows: a copy of a field hides later reads. See
  `src/recurring/detection/detection.performance.test.ts`.
- A hook memo over several live reads is gated on readiness, and its pin settles the reads one
  at a time, so a half-loaded set is seen to run nothing. See
  `src/recurring/use-recurring-series/use-recurring-series.test.tsx`.
- A `*-test-helper.ts` beside a test counts as production for feature-imports and the pre-write
  rules, so it holds no `@kiko/test-support` import.

## Property tests

- A property harness runs at gaps of 0, one hour and one day between runs. Frozen time hides a key
  derived from the clock (a re-scan window's `endTime - windowMs`, a floor that trails the run),
  which differs on every real run. Time-dependent paging also needs a gate-driven clock simulation
  pin inside one run, at latency 0, a small range, a large range and one spike.
- Never steer the generator around a failing case: the generator includes gap 0, a backwards
  clock and every placement; a narrowed generator is a reworded known limit. A reviewer checks the
  generator's ranges, not only its pass count.
- A property suite drives the production caller (the lane's real entry point), or pins the caller's
  arguments in a separate test: a suite that re-implements the caller proves only the callee.
- A property whose seeds go through `seededRandom` (`src/test-support/seeded-random.ts`) must prove
  its worlds vary: small consecutive seeds of that Lehmer generator draw the same first value, so
  every case can build the same world and the property passes vacuously. Multiply the seed by a
  spread constant (`SEED_SPREAD` in
  `src/crypto-sync/binance/binance.p2p-history.properties.test.ts`) and assert that the drawn
  worlds exceed the boundary the property is about (more windows than a run reads).
- A walk world needs a moving clock: a fixed-clock world hid a reset bug in `headFirstGroundOf`.
  Run it at gaps of 0, one hour and one day, and pin the cases that need the clock to move (a head
  held across runs).
- A red commit for a missing export or field reads it by a runtime lookup so the file type-checks;
  after the green, tidy the lookup into a typed import or field.
- The seed list goes through `sweep` (below).

## Device, engine and configuration traps

- Jest runs on Node (V8, ICU, jsdom); the app runs on Hermes. A green Jest run does not prove code
  runs on the device. Check a dependency that targets the browser or Node (browser-only globals
  such as the DOM parser, file reader and blob classes) separately, by reading its entry point's
  runtime deps or running it on the device, before shipping. Hermes lacks `TextDecoder`,
  `TextEncoder` and `Intl.PluralRules`; app code also never uses `atob`, `btoa` or `Buffer`. The
  codec rule is kiko-architecture's "No `TextDecoder`/`TextEncoder`", the plural fallback is
  kiko-translator's "Hermes on iOS has no `Intl.PluralRules`". Before relying on any `Intl.*` or
  Web global, check Hermes has it; prove it on the device or with a test that deletes the global.
- Jest cannot verify real navigator behavior (whether `navigate()` or `popTo()` pushes a duplicate
  route on React Navigation 7: a mocked navigation prop cannot catch that) or native hit-testing
  geometry (whether a `hitSlop` or `minHeight`-grown touch target is reachable on the device). A
  fix for either needs a real-navigator test (see
  `src/navigation/root-navigator/statement-import-return.navigator.test.tsx`) or a device check;
  a green Jest assertion on a prop is never proof the real behavior is fixed. A navigator flow
  where a write must change what Back shows runs the real `useLiveQuery` through
  `src/test-support/sqlite-live-query.ts`. An accessible iOS
  `Pressable` groups its children into one VoiceOver element, and RNTL `getByLabelText` still
  finds the inner control: device-check a control inside a pressable row with VoiceOver.
- The time zone is pinned by a top-level assignment in `jest.config.js` only. Jest gives each test
  sandbox its own copy of `process.env`, so `process.env.TZ = ...` inside a test, a `beforeAll` or
  a helper is a silent no-op (`kiko-no-process-env-time-zone-in-test` denies it). A test that
  needs another zone injects the offset or zone directly (`src/test-support/device-zone-offset.ts`).
  `__tests__/jest-time-zone.test.ts` is the pin's own proof: an offset assertion on both sides of
  a DST boundary that goes red under another host zone (`TZ=America/New_York npx jest
  jest-time-zone.test.ts`).
- A test fixture never derives "N days ago" by subtracting `N * 24 * 60 * 60 * 1000` from
  `Date.now()`: a day is 23 or 25 real hours across DST, and `now + one day + one hour` crosses
  midnight after 23:00 local. Use calendar arithmetic (`localDaysFrom` from
  `src/test-support/local-days-from.ts`, or the next local day plus a fixed hour of day), as
  production does. `kiko-no-fixed-day-offset-on-real-clock-in-test` denies the fixed-ms form.
- A fixture name with a store number needs at least 2 digits: `merchantNameOf` cuts only 2 to 6
  digits, so a one-digit number stays in the name and never reaches the merchant key.
- A test never depends on a hand-edited `.env`: `jest.config.js` points `react-native-dotenv` at
  the tracked, public-only `.env.test` (`process.env.ENVFILE || '.env.test'`; an explicit `ENVFILE`
  wins). A new tracked env file is recorded in `docs/harness/documented-exceptions.md`.
- Write the jest command with the test paths FIRST and an array option (`--testPathIgnorePatterns`)
  last, in the `=` form. An array option before the paths makes jest read every following path as
  one more ignore pattern and run the whole suite; a path variable or glob that is EMPTY does the
  same, so guard it or list the paths literally. A targeted run that reports hundreds of suites is
  this bug. Keep the output of every jest run in a file. The kill-guard denies the bare forms
  (CLAUDE.md, "Automatic wiring").
- A Jest timeout does not stop a child started with `spawnSync`, and a stopped run never runs
  `afterAll`. A test that runs a script that can WAIT stubs every wait input in its helper (a
  low-load `sysctl` stub, a fake power source: `__tests__/test-support/sysctl-stub.ts`,
  `warm-executables.ts`), so the spawned script never waits; do not rely on `afterEach` kills.
  Scope any "no fixture process alive" check to the suite's own fixture names.
- Maestro: pick selectors from ONE live `maestro hierarchy` dump of the target posture and check
  ALL selectors in that one pass (one dump, one commit, one rerun). Maestro runs in the app's
  language: use ids or a bilingual regex, never a single-language label. Its automatic failure
  screenshot cannot be turned off: run with `--debug-output` into the scratchpad, never open a
  `.png`, and remove that folder after quoting the log; ask before deleting `~/.maestro/tests/`.

## Testing a native/ESM dependency

Jest's React Native preset transforms only `node_modules` packages
matched by `jest.config.js`'s `transformIgnorePatterns` allow-list —
everything else in `node_modules` is assumed pre-transformed CommonJS
and skipped. A new dependency that ships raw TypeScript, a native
Fabric/Nitro binding, or an ESM-only build fails to parse under Jest
until it is added to that allow-list; a dependency with no software
renderer under `react-test-renderer` (an SVG host view, a native
symbol view) additionally needs a manual mock under `__mocks__/` so a
component test can render it at all. `__mocks__/react-native-svg.tsx`
is the template: it renders every primitive the app imports as a
passthrough `View` that preserves `testID` and props, picked up
automatically by Jest with no `jest.mock()` call needed. Read
`jest.config.js`'s current `transformIgnorePatterns` regex before
assuming a package is already covered — a package added to
`package.json` without also being added there will fail its first
test with an unhelpful parse error, not an obviously-related one.

## A jest.requireActual call takes no type argument

Write `jest.requireActual('module') as { ... }`, or bind the result to an annotated const
(`const actual: Shape = jest.requireActual('module')`); never `jest.requireActual<Shape>('module')`,
and the same for `jest.requireMock`, `jest.createMockFromModule` and `jest.genMockFromModule`.
Jest finds the tests to run for a changed file
(`--findRelatedTests`, which Stryker's per-test coverage also uses) by a regex over each file's
text. jest-haste-map's dependency extractor reads only those four names with optional
whitespace, then a string literal. A type argument between the name and the `(` hides the module,
so a change to that module does not select the test. The rule covers every
file that calls it (a test, a `__mocks__` file, a test-support helper): a typed call in a helper
cuts the chain from the test through the helper to the real module too.

Semgrep `kiko-no-typed-jest-require-actual` (`rules/semgrep-prewrite.yml`) denies the typed form at
write time; a comment or a string that spells the typed form is flagged too (a test builds the
text at runtime or keeps it under `rules/fixtures/`); its known limits are in kiko-linter's
"`kiko-no-typed-jest-require-actual`".

## Tests read a module, never a source file's text

A test never reads a `.ts`/`.tsx` source file's text to derive what it
expects. Stryker rewrites every mutable source in its sandbox, so the
text the test reads is instrumented code, and a parse of it breaks the
dry run (`settings-columns.test.ts` split `schema.ts`'s text;
`title-keys.call-sites.test.ts` read literal call arguments). Import
the module and read its structure instead: drizzle's
`getTableColumns(settings)` for a table's columns, an exported list
for a set of keys.

A data fixture is fine: name it by its own non-TypeScript extension in
the path (`join(__dirname, '__fixtures__/sample.csv')`, or a `const`
bound to that join), or read it from `drizzle/migrations/`.

Semgrep `kiko-no-source-text-read-in-test` (`rules/semgrep-prewrite.yml`)
enforces this in every `*.test.ts(x)` and `src/test-support/**`. It
flags a `readFileSync`/`readFile`/`createReadStream` call whose path it
cannot prove is a non-TypeScript file, so a walked or computed path is
flagged too. A test that must read source text keeps one documented
per-line override (`// nosemgrep: kiko-no-source-text-read-in-test
OVERRIDE(<reason>)` on the line above that read), never a whole-file
exclude. The current inventory is in `docs/harness/documented-exceptions.md`.
Harness tests under `__tests__/` are out of scope: they read
rules, scripts, docs, and temp projects.

Known limits:

- A harness test that walks `src/` (`one-component-per-file.test.ts`)
  is not checked.
- A join rooted at `drizzle/migrations` is not extension-checked, so
  `join(MIGRATIONS_ROOT, '..', '..', 'src', 'db', 'schema.ts')` passes.
  Never climb out of the migrations folder in a path.
- A template path (`` `${__dirname}/x.csv` ``) fires even with a
  non-TypeScript extension: the rule reads only a string literal or a
  join. A safe false positive: write `join(__dirname, 'x.csv')`.

## An absence assertion must not go vacuous

A test that asserts a text is ABSENT (`queryByText`, `not.toContain`)
passes for ever once a reword changes the text it hunts. Derive that text
from the i18n key (`i18n.t(...)`) or an exported constant, never a typed
fragment. Exception: a test that pins REMOVED wording has no key to derive from (the key is
gone). A typed fragment is the only form there. Keep it, and add the positive twin on the
replacement text (`src/help/help-topics.test.ts`). Add a positive twin that finds the same text
in the case where it must be there, so the matcher is proven to match. After any reword,
grep the old fragment across `src/` and the tests.

## A subset matcher never holds a Set or a Map

Neither subset matcher compares the members of an expected Set or Map; each is vacuous in its own
way (expect 29.7.0):

- `toMatchObject` reads the Set or Map as an object with no own keys, so the check is vacuous at a
  PRESENT key: `undefined`, `null`, `{}` and `[2]` all pass against `new Set([1])`. A missing key
  still fails, and so does a different Set.
- `expect.objectContaining` checks the kind only: a DIFFERENT Set or Map passes against
  `new Set([1])`, while `undefined`, `null`, `{}`, `[2]` and a missing key fail.

Take the field out of the subset and compare it with `toEqual`, which checks the members:

```ts
expect(result).toMatchObject({ id: 'a' });
expect(result.tags).toEqual(new Set(['x']));
```

A `[...new Set(values)]` spread and `new Set(values).size` hand the matcher an array or a number,
so they stay allowed.

Semgrep `kiko-no-set-or-map-in-subset-match` (`rules/semgrep-prewrite.yml`, ERROR) denies an
object property whose value is `new Set|Map|WeakSet|WeakMap(...)`, at any depth inside either
matcher's argument. Known limits: a Set held in a variable (`{ tags: seen }`), a Set as an array
element or inside a call (`[new Set()]`, `wrap(new Set())`), and a Set reached through another
matcher such as `expect.arrayContaining` are not matched.

## A property test's seed list goes through `sweep`

A property test declares its seeds as `const SEEDS = sweep([...])`, with `sweep` from
`@kiko/test-support/property-sweep` (`src/test-support/property-sweep.ts`; read it there).

- A dev run gets the first, middle and last seed. `KIKO_PROPERTY_SWEEP=full` gives every seed;
  any other value throws. The queued verify and the mutation gate set `full`.
- A clock list (`RUN_GAPS`) is not swept.
- A coverage floor measured on the full list scales with `SEEDS.length / FULL_SEEDS.length`
  (`src/crypto-sync/binance/binance.trade-history.properties.test.ts` is the example).
- `__tests__/property-sweep-sites.test.ts` pins the exact list of sites: add a new site there.

## A rejection names its error

A `.rejects` assertion names what the call rejects with: the error class, a message, or
`toHaveProperty('cause.message', ...)`. Any `.rejects` form that passes on every failure (a bare
`toThrow()` is the plainest) also passes on a typo that throws before the code under test runs;
the forms are the patterns of `kiko-rejects-to-throw-needs-error` in `rules/semgrep-prewrite.yml`
(see kiko-linter's own section).

Pin the exact message the call produces, read from jest's Received output, never a guessed
message or a loosened regex: a guess that happens to pass proves nothing about the real failure.
