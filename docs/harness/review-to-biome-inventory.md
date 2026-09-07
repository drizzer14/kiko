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
| Closed literal sets use `ts-pattern .exhaustive()`, not `switch` | kiko-code-style, kiko-domain, kiko-architecture | Semgrep | Judgment — the codebase uses `switch`/`Record` in places (currency.ts, interest.ts, holding-value.ts, all reviewer-approved); do NOT mechanize without a decision |
| `guard` over `if (!ok) throw` | kiko-code-style | Semgrep (Class B) | Judgment (broad) |
| No hand-rolled `try/catch` + Error normalization; use `fnts` either | kiko-code-style | Semgrep (Class B) | Judgment (broad; documented exceptions) |
| Hardcoded URL/config literals must live in `@env` | kiko-code-style | Semgrep | Cleanup-first (false positives in tests/config) |
| Components never hardcode raw color/spacing/radius; read theme tokens | kiko-design-system | Semgrep | Cleanup-first (false-positive-prone) |
| Full unabbreviated variable names | kiko-code-style | Semgrep blocklist | Judgment (inherently incomplete) |

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
| `kiko-widget-money-view-needs-privacysensitive` | S2 (rule idea H1) | Semgrep (Swift, ERROR), `paths.include: "*.swift"` | Scope must be the **basename** pattern, never a path-prefixed `ios/KikoWidget/*.swift` — copy that form into every new Swift row here; the rationale is the comment above the rule in `rules/semgrep-mobile.yml`. Matches a `Text(…)` reading a money member (`.formatted` / `.minorUnits` / `.total`, keyed on the member so a renamed binding cannot escape) outside a `.privacySensitive()` chain. Verified against Semgrep 1.175: a row-level `HStack { … }.privacySensitive()` satisfies it. Known gap: it keys on a direct `Text(<member>)` read, so it does not cover the `moneyText(_ formatted:)` helper shape `ios/KikoWidget/NetWorthWidgetView.swift` now uses (the amount reaches `Text` as a plain `String` parameter). |
| `kiko-appgroup-write-needs-protection` | S3 | Semgrep (generic regex over `*.swift`, ERROR) | File-scoped, not function-scoped: Semgrep 1.175 cannot match a Swift `func` body as an enclosing range, so `pattern-inside`/`pattern-not-inside` on a function silently matches nothing. Zero false positives on the real tree. |
| `plist.sh` — credential-bearing host must be pinned | S1, H3 | Shell assertion (`scripts/checks/plist.sh`, medium tier + `check:all`) | Resolves each credential-header client's `@env` endpoint to a host via `.env` and requires it under `NSPinnedDomains`. The `@env` import parser is Node-based (not single-line sed) so a multi-line `import { A, B } from '@env';` is still resolved; if a credential-bearing file references `@env` at all but no identifier can be extracted (unrecognized import shape), the check fails closed rather than silently skipping the host. Also asserts every domain under `NSPinnedDomains` carries at least 2 `NSPinnedCAIdentities` entries (reinforces S1's "primary + backup pin" recommendation) — a single pin cannot be rotated without an outage. |
| `plist.sh` — Release ATS hardening | S7, S8, H6 | Shell assertion (`scripts/checks/plist.sh`) | `NSAllowsArbitraryLoads` false; `NSAllowsLocalNetworking` absent from the source plist; the Debug-injection build phase present; no empty `NS*UsageDescription`. |
| `settings` columns must have a reader | S4, H5 | Jest (`src/db/settings-columns.test.ts`) | Exception list is exact, not a floor, so both a new dead column and a silent re-wiring fail. Not a Semgrep rule: the assertion is cross-file (schema vs. the whole of `src/`). |
| Security master switches stay `true` | S10, H7 | Jest (`src/db/db-config.test.ts`) | One assertion per flag. Converts an accidental "restore the documented default" from a silent shipped regression into a failing test. |
| `kiko-no-keychain-secret-into-usestate` | S5, H4 | Semgrep (TS, taint mode, WARNING/Class B) | Catches `const x = await readToken(); setX(x)`. Also flags a value *derived* from a secret (e.g. a client-info call using it) — a judgment call, which is why it is Class B rather than a hard fail; the full rationale is the comment above the rule in `rules/semgrep-mobile.yml`. |
| `kiko-no-keychain-secret-through-then` | S5, H4 | Semgrep (TS, WARNING/Class B) | Companion for `readToken().then(...)`, which Semgrep 1.175's taint engine cannot follow (propagators and `focus-metavariable` sources both verified not to work through a `.then` callback parameter); the full rationale is the comment above the rule in `rules/semgrep-mobile.yml`. Proven by its own fixture pair (`kiko-no-keychain-secret-through-then.bad.ts` / `.good.ts`), not the taint rule's — the fixture harness only credits a rule id against the fixture whose filename names it. |

**Not mechanized, with reason.** H3's Semgrep half — "flag a `fetch` whose
headers carry a credential key" — was dropped. Semgrep cannot read
`Info.plist`, so the rule can only report every credential-bearing client
unconditionally, which means it would fire forever on the two known-good,
correctly-pinned clients. That is a noisy rule, not a check. The shell
assertion above carries the whole intent, and it is strictly more precise
because it can compare against the actual pinned set.

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
