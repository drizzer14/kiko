# Review-to-Biome rule inventory

**Date:** 2026-09-01
**Purpose:** The user asked that code-review feedback update Biome/Semgrep
rules, not only skills. This is the inventory of mechanizable style rules that
live in the PFF skills but are NOT yet enforced by Biome or Semgrep, plus the
go-forward process. Source pass by `pff:explorer`.

## Key findings

- The `feedback`-type memories are all agent-workflow rules (delegation,
  commit hygiene, review routing), not code style. No past review produced a
  mechanizable style rule that is currently missing. Every candidate below
  comes from a skill, chiefly `pff-code-style`.
- Already enforced, correctly dropped: single quotes / 2-space / 100-width /
  trailing commas / arrow-parens (Biome formatter), `noExplicitAny`,
  `noUnusedVariables` / `noUnusedImports`, `noExcessiveCognitiveComplexity`,
  `useImportType` (Biome recommended), and the Semgrep TLS / `Math.random` /
  AsyncStorage-secret / WebView rules.

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
| Repositories are plain function modules, never classes | pff-architecture | Semgrep, `*.repo.ts` scope, ban `class` | Safe |
| Repository typed `satisfies Repository`, never `: Repository` | pff-code-style | Semgrep, `const $X: Repository = {` | Safe |
| Amount/balance columns integer minor-units, never `real`/`decimal` | pff-domain | Semgrep, `schema.ts` scope | Safe |
| Every DB write wrapped in a transaction | pff-architecture | Semgrep, `pattern-not-inside` — must allow the repo `write(tx => ...)` helper | Cleanup-first (verify the `write` helper is recognized) |
| Repository read functions return the query builder, never `await`/`.execute()` | pff-architecture | Semgrep, `*.repo.ts` scope | Safe |
| Default export only in `*.component.tsx` / `*.screen.tsx`; named elsewhere | pff-code-style | Biome `noDefaultExport` via `overrides` glob | Cleanup-first (verify no stray default exports) |
| Uppercase domain acronyms stay uppercase (`PAN`, `IBAN`, `MCC`, `ID`, `JSON`, `BTC`) | pff-code-style | Semgrep blocklist regex | Safe (blocklist is partial) |
| Rest-props binding named `props`, not `rest`, in `*.component.tsx` | pff-design-system | Semgrep | Safe |
| Primitive own-props spread after `{...props}` in JSX | pff-design-system | Semgrep, four primitive files | Safe |
| Monobank token never written to DB or logged | pff-architecture | Semgrep, extend the AsyncStorage-secret rule | Safe |
| Two-arg `first(result, toError)`; curried `first(toError)(result)` banned | pff-code-style | Semgrep, `first($X)($Y)` | Safe |
| No hand-rolled `pipe`/`compose`; use `fnts` | pff-code-style | Semgrep | Safe |
| Confirm `noNestedTernary` is enabled | pff-design-system | Biome | Verify only |
| Blank line before every `return` | pff-code-style | Semgrep | Cleanup-first (likely many violations; noisy) |
| Closed literal sets use `ts-pattern .exhaustive()`, not `switch` | pff-code-style, pff-domain, pff-architecture | Semgrep | Judgment — the codebase uses `switch`/`Record` in places (currency.ts, interest.ts, holding-value.ts, all reviewer-approved); do NOT mechanize without a decision |
| `guard` over `if (!ok) throw` | pff-code-style | Semgrep (Class B) | Judgment (broad) |
| No hand-rolled `try/catch` + Error normalization; use `fnts` either | pff-code-style | Semgrep (Class B) | Judgment (broad; documented exceptions) |
| Hardcoded URL/config literals must live in `@env` | pff-code-style | Semgrep | Cleanup-first (false positives in tests/config) |
| Components never hardcode raw color/spacing/radius; read theme tokens | pff-design-system | Semgrep | Cleanup-first (false-positive-prone) |
| Full unabbreviated variable names | pff-code-style | Semgrep blocklist | Judgment (inherently incomplete) |

### Judgment-only (correctly stay in skills)

Functional-first-vs-OOP boundary; single-source-of-truth literal union +
`Set`; type colocated after its `const`; `bifold` annotation needs; fold an
Either back to the boundary contract; not forcing `fnts` where plain code
reads better; `Money` currency-mismatch rejection; `convert()` as the only
currency changer; `MoneyText` as the only raw-`Money` sink; primitive prop
widening via `Pick`/extend; design-system layout prop over inline style; OLED
dark-theme choices; Monobank protocol constraints; ISO-4217 mapping at the
sync boundary only; net-worth assets-only rule.

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
