# Review-to-Biome rule inventory

**Date:** 2026-09-01
**Purpose:** The user asked that code-review feedback update Biome/Semgrep
rules, not only skills. This is the inventory of mechanizable style rules that
live in the Kiko skills but are NOT yet enforced by Biome or Semgrep, plus the
go-forward process. Source pass by `kiko:explorer`.

## Key findings

- The `feedback`-type memories are all agent-workflow rules (delegation,
  commit hygiene, review routing), not code style. No past review produced a
  mechanizable style rule that is currently missing. Every candidate below
  comes from a skill, chiefly `kiko-code-style`.
- Already enforced, correctly dropped: single quotes / 2-space / 100-width /
  trailing commas / arrow-parens (Biome formatter), `noExplicitAny`,
  `noUnusedVariables` / `noUnusedImports`, `noExcessiveCognitiveComplexity`,
  `useImportType` (Biome recommended), and the Semgrep TLS / `Math.random` /
  AsyncStorage-secret / WebView rules.
- 2026-09-05: `suspicious/noConsole` ("error") added to `biome.json` by the
  security-and-app-lock plan, mechanizing the "no `console.*` in `src`"
  convention that previously relied on manual review. No `allow` list.

## Risk triage (coordinator)

Not every candidate is safe to enforce. Adding a rule that the existing
codebase violates would fail `check:all` everywhere until the code is fixed.
Each candidate is tiered: **Safe** (codebase already complies, low
false-positive), **Cleanup-first** (real violations exist; enforce only after
a fix pass), **Judgment** (too broad or too false-positive-prone to
mechanize well; keep in the skill).

### Candidates — enforce via Biome/Semgrep

| Rule | Source | Enforce via | Tier |
|---|---|---|---|
| Repositories are plain function modules, never classes | kiko-architecture | Semgrep, `*.repo.ts` scope, ban `class` | Safe |
| Repository typed `satisfies Repository`, never `: Repository` | kiko-code-style | Semgrep, `const $X: Repository = {` | Safe |
| Amount/balance columns integer minor-units, never `real`/`decimal` | kiko-domain | Semgrep, `schema.ts` scope | Safe |
| Every DB write wrapped in a transaction | kiko-architecture | Semgrep, `pattern-not-inside` — must allow the repo `write(tx => ...)` helper | Cleanup-first (verify the `write` helper is recognized) |
| Repository read functions return the query builder, never `await`/`.execute()` | kiko-architecture | Semgrep, `*.repo.ts` scope | Safe |
| Default export only in `*.component.tsx` / `*.screen.tsx`; named elsewhere | kiko-code-style | Biome `noDefaultExport` via `overrides` glob | Cleanup-first (verify no stray default exports) |
| Uppercase domain acronyms stay uppercase (`PAN`, `IBAN`, `MCC`, `ID`, `JSON`, `BTC`) | kiko-code-style | Semgrep blocklist regex | Safe (blocklist is partial) |
| Rest-props binding named `props`, not `rest`, in `*.component.tsx` | kiko-design-system | Semgrep | Safe |
| Primitive own-props spread after `{...props}` in JSX | kiko-design-system | Semgrep, four primitive files | Safe |
| Monobank token never written to DB or logged | kiko-architecture | Semgrep, extend the AsyncStorage-secret rule | Safe |
| Two-arg `first(result, toError)`; curried `first(toError)(result)` banned | kiko-code-style | Semgrep, `first($X)($Y)` | Safe |
| No hand-rolled `pipe`/`compose`; use `fnts` | kiko-code-style | Semgrep | Safe |
| Confirm `noNestedTernary` is enabled | kiko-design-system | Biome | Verify only |
| Blank line before every `return` | kiko-code-style | Semgrep | Cleanup-first (likely many violations; noisy) |
| Closed literal sets use `ts-pattern .exhaustive()`, not `switch` | kiko-code-style, kiko-domain, kiko-architecture | ~~Semgrep~~ superseded — see "Enforced — 2026-09-25 R2" below | Now enforced (`kiko-no-switch`) — the prior `switch` exception for `interest.ts`/`holding-value.ts` no longer stands; the rule applies with no exception |
| `guard` over `if (!ok) throw` | kiko-code-style | Semgrep (Class B) | Judgment (broad) |
| No hand-rolled `try/catch` + Error normalization; use `fnts` either | kiko-code-style | Semgrep (Class B) | Judgment (broad; documented exceptions) |
| Hardcoded URL/config literals must live in `@env` | kiko-code-style | Semgrep | Cleanup-first (false positives in tests/config) |
| Components never hardcode raw spacing/radius; read theme tokens | kiko-design-system | Semgrep | Cleanup-first (false-positive-prone); the color half is now enforced — see `kiko-no-raw-color-literal` below |
| Full unabbreviated variable names | kiko-code-style | ~~Semgrep blocklist~~ superseded — see "Enforced — 2026-09-25 R1.d" below | Now enforced (hand-rolled shell+JS check, not Semgrep — Semgrep cannot split an identifier into camelCase/snake_case parts across every identifier-bearing syntax position) |

### Candidates — currency-fix round (2026-09-21, not yet enforced)

| Rule | Source | Enforce via | Tier |
|---|---|---|---|
| A plain, non-`'worklet'`-tagged function called synchronously inside a reanimated worklet hook (`useAnimatedStyle`/`useDerivedValue`/`useAnimatedReaction`/`useAnimatedScrollHandler`/`Gesture.*`) | kiko-gestures ("Every function called inside a worklet needs its own `'worklet'` directive"), memory `worklet-directive-debug-swallows-release-aborts` | Semgrep (TS, likely ERROR — deterministic, RELEASE-only SIGABRT, invisible to tsc/Jest) | Needs design + a `rules/fixtures/<rule-id>.bad.ts`/`.good.ts` pair before it can land; not yet implemented |

### Candidates — kiko-ux-round review (2026-09-04, not yet enforced)

| Rule | Source | Enforce via | Tier |
|---|---|---|---|
| A `SymbolIcon`/`SFSymbolView` `color=` fed a raw entity/category `.color` (or `?? undefined`), not wrapped in `resolveEntityColor`/`resolveCategoryColor` | kiko-design-system, kiko-domain | Semgrep | Cleanup-first (verify no existing raw-color call site) |
| Import-boundary: `src/screens/**` must not import a value export from another `*.screen.tsx` | kiko-code-style | Semgrep | Safe |
| At most one `Record<HoldingType, string>` / `Record<AccountKind, string>` glyph map in the tree | kiko-domain | Knip/lint guard | Judgment (needs a one-off script, not a stock rule) |

### Judgment-only (correctly stay in skills)

Functional-first-vs-OOP boundary; single-source-of-truth literal union +
`Set`; type colocated after its `const`; `bifold` annotation needs; fold an
Either back to the boundary contract; not forcing `fnts` where plain code
reads better; `Money` currency-mismatch rejection; `convert()` as the only
currency changer; `MoneyText` as the only raw-`Money` sink; primitive prop
widening via `Pick`/extend; design-system layout prop over inline style; OLED
dark-theme choices; Monobank protocol constraints; ISO-4217 mapping at the
sync boundary only; net-worth assets-only rule.

### Enforced — 2026-09-06 security pass (`docs/security/2026-09-06-security-pass-findings.md`)

| Rule id | Finding | Enforce via | Notes |
|---|---|---|---|
| ~~`kiko-widget-money-view-needs-privacysensitive`~~ | S2 (rule idea H1) | REMOVED 2026-09-23 (skill-gap-analysis #21) | The widget was deleted in `bba473f`; the auditor confirmed no widget and no App Group consumer anywhere in the tree, and the rule's own comment cited a nonexistent `ios/KikoWidget/NetWorthSnapshot.swift`. Removed along with its fixture pair rather than kept as a dead, unreachable rule — re-add if a widget ships again. |
| ~~`kiko-appgroup-write-needs-protection`~~ | S3 | REMOVED 2026-09-23 (skill-gap-analysis #21) | Same removal as above — no code anywhere writes into the App Group container today. `docs/plans/statement-import.md`'s planned Share Extension will need this rule again; re-add it (with a fresh fixture pair) when that phase actually starts writing into the container, rather than assuming this row still applies. |
| `plist.sh` — credential-bearing host must be pinned | S1, H3 | Shell assertion (`scripts/checks/plist.sh`, medium tier + `check:all`) | Resolves each credential-header client's `@env` endpoint to a host via `.env` and requires it under `NSPinnedDomains`. The `@env` import parser is Node-based (not single-line sed) so a multi-line `import { A, B } from '@env';` is still resolved; if a credential-bearing file references `@env` at all but no identifier can be extracted (unrecognized import shape), the check fails closed rather than silently skipping the host. Also asserts every domain under `NSPinnedDomains` carries at least 2 `NSPinnedCAIdentities` entries (reinforces S1's "primary + backup pin" recommendation) — a single pin cannot be rotated without an outage. |
| `plist.sh` — Release ATS hardening | S7, S8, H6 | Shell assertion (`scripts/checks/plist.sh`) | `NSAllowsArbitraryLoads` false; `NSAllowsLocalNetworking` absent from the source plist; the Debug-injection build phase present; no empty `NS*UsageDescription`. |
| `settings` columns must have a reader | S4, H5 | Jest (`src/db/settings-columns.test.ts`) | Exception list is exact, not a floor, so both a new dead column and a silent re-wiring fail. Not a Semgrep rule: the assertion is cross-file (schema vs. the whole of `src/`). |
| Security master switches stay `true` | S10, H7 | Jest (`src/db/db-config.test.ts`) | One assertion per flag. Converts an accidental "restore the documented default" from a silent shipped regression into a failing test. |
| `kiko-no-keychain-secret-into-usestate` | S5, H4 | Semgrep (TS, taint mode, WARNING/Class B) | Catches `const x = await readToken(); setX(x)`. Also flags a value *derived* from a secret (e.g. a client-info call using it) — a judgment call, which is why it is Class B rather than a hard fail; the full rationale is the comment above the rule in `rules/semgrep-mobile.yml`. |
| `kiko-no-keychain-secret-through-then` | S5, H4 | Semgrep (TS, WARNING/Class B) | Companion for `readToken().then(...)`, which Semgrep 1.175's taint engine cannot follow (propagators and `focus-metavariable` sources both verified not to work through a `.then` callback parameter); the full rationale is the comment above the rule in `rules/semgrep-mobile.yml`. Proven by its own fixture pair (`kiko-no-keychain-secret-through-then.bad.ts` / `.good.ts`), not the taint rule's — the fixture harness only credits a rule id against the fixture whose filename names it. |

### Enforced — 2026-09-18 Guideline 5.6 remediation

| Rule id | Finding | Enforce via | Notes |
|---|---|---|---|
| `kiko-no-hidden-feature-flag-or-demo-import` | App Store rejection of build 7 (Guideline 5.6, "features intentionally hidden during review") | Semgrep (TS/JS, ERROR) | Three deterministic shapes, one rule: importing a SHOW_*/HIDE_*/SCREENSHOT_* visibility-control `@env` flag, a static `import` reaching from app source into the dev-only `e2e/` tree (screenshot/demo/seed), or a dynamic `require(...)` reaching the same `e2e/` tree. The `require` exemption this rule used to carry is gone: it was justified only by trusting Metro's dead-code elimination to strip a dead-branched `require`, and that trust was empirically disproven — build 8 shipped `seedScreenshotData` in the `main.jsbundle` despite it sitting behind a dead `SCREENSHOT_MODE === 'true'` branch. That branch and flag are deleted outright now, so there is no longer any exempted crossing of any kind, and `src/` has zero `e2e/` crossings, static or dynamic. Deliberately carries NO `paths.include` scope — a path-prefixed `"src/**"` would hit the same fixture-scan gotcha the Swift rows above document (matches nothing when `semgrep-rules.sh` scans `rules/fixtures/` directly, since the fixture is not nested under a `src/` segment); scoping is content-only instead (the `e2e/` regexes need a literal `e2e/` path segment, which `e2e/`'s own internal relative imports never spell out — verified empirically), and it is verified to report zero findings on the real tree (`src/` and `e2e/` both). |

**Not mechanized, with reason.** H3's Semgrep half — "flag a `fetch` whose
headers carry a credential key" — was dropped. Semgrep cannot read
`Info.plist`, so the rule can only report every credential-bearing client
unconditionally, which means it would fire forever on the two known-good,
correctly-pinned clients. That is a noisy rule, not a check. The shell
assertion above carries the whole intent, and it is strictly more precise
because it can compare against the actual pinned set.

### Enforced — 2026-09-23 skill-gap-analysis pass (#14, #16)

| Rule id | Finding | Enforce via | Notes |
|---|---|---|---|
| `kiko-no-import-screens-outside-ui` | #14 — `currency-field.component.tsx` imported `FieldTrigger` from `src/screens/forms/`, a design-system-into-screens layer inversion (fixed by moving `FieldTrigger` into `src/design-system/components/`) | Semgrep (TS/JS, ERROR) | `paths.exclude: ["src/screens/**", "src/navigation/**", "App.tsx"]` — screens and navigation ARE the UI layer and are allowed to import from `src/screens/**`. `paths.exclude` (unlike `paths.include`) was verified to path-prefix safely: it matches correctly against a whole-directory, absolute-directory, or single-absolute-file Semgrep target (the last is what `fast.sh` uses), and failing to match only fails OPEN (rule still applies), not closed. Content regex requires a `/screens/` (or leading `screens/`) path segment, so `react-native-screens` (no `/` after the name) and any `<x>-screens/…`-suffixed segment do not false-positive. |
| `kiko-no-use-animated-keyboard` | #16 — `useAnimatedKeyboard()` was prose-only banned in `kiko-gestures` (its native observer reaches `AppDelegate.window`, which SIGABRTs under this app's UIScene lifecycle) | Semgrep (TS/JS, ERROR) | Flags any `useAnimatedKeyboard(` call. `bottom-sheet.component.tsx` drives its keyboard height from RN core `Keyboard` events instead — see `kiko-gestures`. |
| `kiko-no-textdecoder-textencoder` | #16 — Hermes has no working `TextDecoder`/`TextEncoder`; `src/data-transfer/utf8`/`base64` hand-roll the equivalent, prose-only in `kiko-code-style`'s dependency notes | Semgrep (TS/JS, ERROR) | Flags `new TextDecoder(` / `new TextEncoder(` anywhere under `src/`. A comment merely mentioning the names does not match — the pattern requires the `new …(` call syntax. |

### Enforced — 2026-09-25 R1 behavior-free refactor (R1.a)

| Rule id | Finding | Enforce via | Notes |
|---|---|---|---|
| `kiko-no-nullable-map-ternary` | kiko-code-style's "Banned: the nullable-map ternary" — `x === undefined ? undefined : f(x)` and its `null`/`== null`/list-or-empty variants, previously prose-only | Semgrep (TS, ERROR) | Every `pattern-either` branch is a literal branch shape (basename `paths.include` N/A — no path scope needed, the rule applies repo-wide including tests), covering the direct (`===`/`==`-first) and inverted (`!==`/`!=`-first) forms plus the `||`/`&&`-joined longhand spelling of `== null` seen in `transactions.repo.test.ts`. Deliberately has NO test-file exclusion — the sweep this rule lands with converts existing test-file instances too. A default-value ternary (fallback is a real value, not a null/undefined/`[]` literal) and a validator-error ternary (opposite polarity: a real message on the absent side, `undefined` on the present side) both verified to draw zero findings on the negative fixture.|

### Enforced — 2026-09-25 R1 behavior-free refactor (R1.b)

| Rule id | Finding | Enforce via | Notes |
|---|---|---|---|
| `exportedComponentNames` (one-component-per-file) | kiko-code-style's "One component per file" | Jest invariant (`__tests__/one-component-per-file.test.ts`) | Semgrep has no same-file cross-declaration cardinality primitive, so this is a Jest invariant rather than a Semgrep rule — see the kiko-linter skill's "One exported component per `.tsx`" section for the scanner design and the jest.mock exemption's structural reason (a mock factory body can never syntactically contain a top-level `export`). Walks every real `.tsx` under `src/`; 0 violations today. |

### Enforced — 2026-09-25 R1 behavior-free refactor (R1.c)

| Rule id | Finding | Enforce via | Notes |
|---|---|---|---|
| `scripts/checks/import-order.js`/`.sh` | kiko-code-style's "Import ordering" — hand-enforced rather than mechanized, so it drifted (two prior `kiko:reviewer` passes flagged pre-existing violations under `src/screens/`) | Shell + JS check (fast tier, per-file; project-wide via `npm run check:import-order`) | Biome's `organizeImports` cannot express this project's length-sort convention, so this is a hand-rolled scanner, not a Biome/Semgrep rule — see the kiko-linter skill's "Import length-sort" section for the scanner design, the file-header-comment pinning rule, and the `--write` auto-fix mode. The R1.c sweep found 210 violating files; `--write` fixed all but 7 (each with a comment glued to a non-first import), fixed by hand. `check:import-order` now reports zero violations across `src/`. |

### Enforced — 2026-09-25 R1.d (full words in identifiers, new user rule)

| Rule id | Finding | Enforce via | Notes |
|---|---|---|---|
| `scripts/checks/full-word-identifiers.js`/`.sh` | kiko-code-style's "Full words in identifiers" — a new user rule (not a past review finding): no abbreviated word (`cond`/`btn`/`idx`/`acc`/`tx`/`err`/`val`/`prev`/`cfg`/`e`/`res`/`msg`/`cb`/`ctx`/`el`/`opts`/`tmp`/`num`/`arr`/`obj`/`str`) as a whole camelCase/PascalCase/snake_case PART of a variable, parameter, function, type, or prop name | Shell + JS check (fast tier, per-file; project-wide via `npm run check:full-word-identifiers`, scanning `src/`, `__tests__/`, `rules/fixtures/`, and `scripts/`) | Semgrep has no primitive that splits an identifier into word parts and tests each against a denylist across every identifier-bearing syntax position at once, so this is a hand-rolled scanner, same shape as `import-order.js` — see the kiko-linter skill's "Full words in identifiers" section for the scanner design and the exact-(path, word, name)-scoped exemption allowlist (18 entries, each a verified third-party-API/DB-format mirror, e.g. `idx` in `src/db/run-migrations.ts` mirroring drizzle-kit's own generated migration-journal JSON shape, and Binance's own `txId` deposit/withdraw history field — found only after an initial mechanical sweep pass, by reading the diff, not by inspection beforehand). The sweep found 1783 violations across 78 files (dominated by `tx` — the Drizzle `write((tx) => ...)` transaction-handle callback parameter, used ~1500 times); `check:full-word-identifiers` now reports zero violations across its scanned roots. |

### Enforced — 2026-09-25 R2 (ts-pattern behavior-free refactor, `switch` withdrawn exception)

| Rule id | Finding | Enforce via | Notes |
|---|---|---|---|
| `kiko-no-switch` | kiko-code-style's ts-pattern section — the prior per-file `switch` exception for `interest.ts`/`holding-value.ts` (see the withdrawn row above) is gone; the R2 refactor converted all 4 remaining `switch` statements to `match(...).exhaustive()`/`.otherwise()` and 54 other closed-set `===` chains across 31 files, leaving zero `switch` statements in `src`/`__tests__`/`e2e` | Semgrep (TS, ERROR) | A `pattern-either` of two AST arms, each anchored on a real clause label (`switch ($X) { case $C: ... }` / `switch ($X) { default: ... }` — a bare `switch ($X) { ... }` matches no real switch, since a case-clause list is not a generic statement block), not a keyword-plus-paren `pattern-regex` — a bare regex has real false-positive shapes (a comment or string mentioning `switch(`, a `.switch(...)` method call) the AST pattern naturally avoids. Verified to report zero findings on the real tree. Five conversions kept their catch-all `.otherwise()` rather than a fully literal `.exhaustive()`, because their ORIGINAL `switch`/if-chain/ternary-chain tolerated ANY unmatched runtime value (a stale or malformed discriminant), not only the few other literal members named in each arm — a fully literal `.exhaustive()` there is a real behavior change (crash instead of a tolerant fallback): `holding-value.ts`'s `holdingValueBreakdown`, `holding-form.screen.tsx`'s hydration-seed effect, and `derived-entries.ts`'s `entriesForType` all read a real, externally/persisted-sourced `HoldingType` (a DB row) and were caught by two real test-suite failures (`accounts.screen.test.tsx`, `home.screen.test.tsx`) whose fixtures omit `type` entirely; a fix-round-1 pass then found the same shape in two more conversions reading a settings-JSON discriminant — `resolveTrendFilter`'s stored `trend_filter.mode` and the column-mapping screen's stored `statement_mappings` JSON `amount`/`currency.mode` — each given its own malformed-stored-value test. Every OTHER `.exhaustive()` conversion in R2 is over a LOCAL type this codebase's own code constructs (a `useState` literal, a pure helper's return value, a caller-supplied op) with no such external-data risk. |

### Enforced — 2026-09-25 R5 (comment-history mechanization)

| Rule id | Finding | Enforce via | Notes |
|---|---|---|---|
| `kiko-no-history-id-comment` | kiko-linter's "F4 code-style mechanization candidates" backlog item, mechanizing kiko-code-style's "Comments: WHY only, never history" (no task id, review-round id, spec/decision id, bug number, `Phase N`, `Requirement X`, `controller ruling N`, `section X.N`, or `the brief` left in a comment) | Semgrep (TS, ERROR) | `paths.exclude` scopes this to app code: `__tests__/`, `e2e/`, `scripts/`, `harness/`, plus root config files `App.tsx`/`drizzle.config.ts` (verified — none of these hides a real hit today). `__mocks__/**` was excluded too until a later round found 3 real hits it was hiding; the exclude was dropped and the hits fixed instead, so `__mocks__/` is now in scope like any other file. Landed as WARNING first, per the "a new check lands together with the fix of its own violations" rule; a repo-wide sweep, including two later extensions of the id-family list, dropped every hit to 0 each time, then it flipped to ERROR. See the kiko-linter skill's "`kiko-no-history-id-comment`" section for the rule's regex design, the string-skip anchor, the scope reasoning, and the full sweep history. |

### Enforced — 2026-09-25 pre-write guard rule 8

| Rule id | Finding | Enforce via | Notes |
|---|---|---|---|
| `kiko-no-raw-color-literal` | The color half of the "components never hardcode raw color/spacing/radius" candidate above, now mechanized as part of the pre-write guard's own rule set (`rules/semgrep-prewrite.yml`) | Semgrep (TS, ERROR) | `pattern: "'$COLOR'"` binds an AST string literal's own content (no surrounding quotes, either quote style) and `metavariable-regex` filters it against an anchored `^#[0-9A-Fa-f]{3,8}$|^rgba?\(` — so a comment merely mentioning a hex value (several exist in `theme.ts`/`palette.ts` documenting a token's own hex) never matches, and neither does a too-short/too-long hex-shaped string. `paths.exclude`: `src/design-system/palette.ts`, `src/design-system/theme.ts` (the tokens are defined there), `*.test.ts`/`*.test.tsx` (a test routinely asserts against a literal color value). Sweep fixed 2 real files: `src/navigation/dark-theme.ts` (5 literals now read `darkTheme.colors.*`) and `src/data-transfer/snapshot/restore-snapshot.ts:107` (`'#5E5CE6'` now reads `entityColorsDark.indigo`, the existing palette token with that exact hex — no rendered value changed). |

## Go-forward process (to wire into the retrospect/scribe loop)

After each code review, triage every finding:

1. **Mechanizable and low false-positive** → add a Biome rule (`biome.json`)
   or a Semgrep rule (`rules/semgrep-mobile.yml`). Verify `npm run check:all`
   stays green; if the new rule surfaces existing violations, fix them or
   record the rule as cleanup-first — never weaken the check.
2. **Semantic or architectural judgment** → distil into the relevant skill,
   as today ([[distill-full-review-into-skills]]).

## Sequencing note

The actual `biome.json` / `rules/semgrep-mobile.yml` edits are deferred to a
dedicated pass AFTER the holding-asset-types feature build completes and is
committed, so new rules land on a clean tree and any violations they surface
are isolated and reviewable — not mixed into the feature diff or breaking the
feature build's own Stop-hook checks.
