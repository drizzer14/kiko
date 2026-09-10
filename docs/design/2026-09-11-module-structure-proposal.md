# Module Structure Proposal — `src/` feature co-location (Track SR)

**Date:** 2026-09-11
**Branch:** `refactor-repo-aliases` (base `da81be8`)
**Author:** Track SR orchestrator, from a `kiko:auditor` read-only analysis of `src/` at `da81be8`.

## Purpose

`src/` mixed two organizing principles: feature folders (`holdings/`,
`transactions/`, `monobank/`, …) and layer folders (`repositories/`,
`screens/`, `db/`, …). Several cohesive features were hidden inside the
layer folders. This track co-locates each hidden feature into its own
folder and introduces `@kiko/*` path aliases, so cross-feature imports
read `@kiko/<feature>/…` instead of deep relative chains.

Every move in the EXECUTED section is a **pure structural change**: file
moves plus import rewrites only. Behavior is identical. The Jest suite
held at exactly **2166 passing tests / 199 suites** through every commit,
which is the primary evidence that no behavior changed. `npm run
check:all` was green before each commit.

## `@kiko/*` alias setup (foundation)

Committed in `949112b`:

- `babel-plugin-module-resolver` (devDependency, old and stable — passes
  the 7-day min-age rule) in `babel.config.js`: `root: ['./src']`,
  `alias: { '@kiko': './src' }`.
- `tsconfig.json` `compilerOptions.paths`: `"@kiko/*": ["./src/*"]`.
  `baseUrl` was intentionally omitted: `check:typecheck` fails on it
  (TS5101, removed in TS 7); modern TS resolves `paths` relative to the
  tsconfig without `baseUrl`.
- Jest `moduleNameMapper`: `^@kiko/(.*)$` → `<rootDir>/src/$1`.
- `babel-plugin-module-resolver` added to `knip.json` `ignoreDependencies`
  and `.depcheckrc.json` `ignores` (referenced only as a string in
  `babel.config.js`, same class as the existing `babel-plugin-inline-import`
  exception).

## EXECUTED groups

Convention: cross-feature imports use `@kiko/<feature>/…`; within-feature
imports stay relative.

| Group | From → To | Files | External importers | Commit |
|---|---|---|---|---|
| Repository co-location (pre-approved) | `src/repositories/*.repo.ts(.test.ts)` → feature folders; infra → `src/db/` | 19 | many | `21b4a33` |
| `calendar/` | `src/screens/calendar/` → `src/calendar/` | 12 | 2 | `193958e` |
| `sync/` | `src/screens/{use-sync,use-auto-sync,use-crypto-sync,use-sync-all}.ts(+tests)` + `sync-jobs.ts` → `src/sync/` | 9 | ~6 | `5a02273` |
| `migration/` | `src/db/migration/` + `migrate-legacy-db.ts(+test)` + `migrations.gate.*` → `src/migration/` | 14 | 3+ | `694286d` |

### Repository co-location (`21b4a33`) — pre-approved

The sharpest layer/feature mismatch. Each repository was severed from its
domain folder. Landings:

- `holdings.repo.ts(.test.ts)` → `src/holdings/`
- `transactions.repo.ts(.test.ts)` → `src/transactions/`
- `categories.repo.ts(.test.ts)` + `category-overrides.repo.ts(.test.ts)` → `src/categories/`
- `rates.repo.ts(.test.ts)` + `rate-history.repo.ts(.test.ts)` → `src/rates/`
- `accounts.repo.ts(.test.ts)` → new `src/accounts/` (no prior domain folder)
- `settings.repo.ts(.test.ts)` → new `src/settings/` (no prior domain folder)
- `repository.d.ts`, `capture-set-tx.ts`, `__fixtures__/` → `src/db/`
  (cross-repo infrastructure, not one feature)
- `src/repositories/` deleted.

### `calendar/` (`193958e`) — reusable date-picker widget

`src/screens/calendar/` rendered nothing screen-specific; it is a shared
calendar control consumed by two form fields (`date-range-field`,
`date-field`). Low risk (blast-radius 2). An alternative home is
`design-system/components/`; a top-level `src/calendar/` was chosen as the
lowest-risk pure move that does not enter the design-system skill's domain.

### `sync/` (`5a02273`) — sync orchestration

Five files sat at the top of the `screens/` layer but render nothing.
`sync-jobs.ts` unifies `crypto-sync/` + `monobank/` + `db`; the `use-*`
hooks glue `monobank` + `rates` + repositories. This is the one
cross-cutting sync hub, previously misfiled under `screens/`. Note:
`sync-jobs.test.ts` does not exist.

### `migration/` (`694286d`) — legacy DB migration feature

A self-contained concern: the one-time old-app → new-app data handoff plus
the `MigrationsGate` UI that blocks the app until it finishes. `src/db/keys/`
was left in `src/db/` (migration imports it cross-feature). This is
**distinct** from the drizzle schema migrations at repo-root
`drizzle/migrations/`, which were not touched.

## Harness path assumptions (verified)

The `stryker.conf.json`, `scripts/checks/mutation.sh`, `.gitleaks.toml`,
and `.jscpd.json` configs use generic `.ts/.tsx` patterns, not hardcoded
`src/repositories`/`src/screens`/`src/db` paths, so they needed no change.
`knip.json` had one migration-path entry that was updated. `settings-columns.test.ts`
walks `src/` by directory, so it needed no change and still passes. The
`kiko-architecture`, `kiko-domain`, and `kiko-translator` skills were
updated to the new paths in the same commits (same-task upkeep rule).

## PROPOSED groups — NOT executed (user decision)

These are coherent groups the auditor identified but this track did not
move, because each is either genuinely risky or ambiguous in value. They
are listed for a user decision, not executed.

### `forms/` — SKIPPED (low value)

`src/screens/forms/` (61 files: 4 form screens + ~10 field subcomponents +
helpers). The form screens are **genuine navigation destinations**, so
`screens/` is arguably their correct home. Promoting 61 files out of the
`screens/` layer is high import-path churn for low marginal value — the
group is already internally cohesive as `screens/forms/`. Recommendation:
leave as-is unless the team wants a strict "no features under `screens/`"
rule.

### `entity/` — SKIPPED (risky / speculative)

`src/holdings/entity-colors.ts`, `src/holdings/entity-symbols.ts`,
`src/design-system/entity-tint.ts`, `src/screens/entity-amount-header/`,
`src/screens/entity-header-icon/`. They share the "entity" name but are
**not tightly coupled**, and the utilities are near-leaf with ~14
importers each (`entity-colors` ~14, `entity-tint` ~14, `entity-symbols`
~9). Moving them ripples widely for unclear benefit. Recommendation:
defer, or split — the two header components are a clean low-risk sub-move,
but the color/symbol/tint utilities are not clearly better relocated.

### Shared `screens/` top-level components — SKIPPED (ambiguous home)

`card-context-menu/`, `edit-header-button/`, `icon-editor/`,
`grid-interaction.ts`, and similar. These are shared UI/helpers consumed
by 2+ screens. They likely belong in `design-system/` rather than a new
feature folder, which is the designer's domain and a separate decision.
Recommendation: hand to the designer for a design-system placement call.

## Also left in place (correct as layer folders)

- `db/keys/` — tightly coupled to `encrypted-database.ts`; keep in `db/`.
- `test-support/` — genuine cross-cutting test infrastructure.
- `screens/`, `design-system/`, `navigation/`, `i18n/`, `currency/`,
  `dates/`, `auth/` — genuine shared layers or already-good feature folders.

## Stale references NOT edited

- `CLAUDE.md` — the guardrail forbids editing it. Two items are now stale:
  (a) no "Documented exceptions" justification entry for the
  `babel-plugin-module-resolver` / `@kiko/*` ignore-list additions;
  (b) the Stryker KEEP-LIST prose (CLAUDE.md ~lines 145, 291) still names
  `src/repositories/categories.repo.test.ts`, now at
  `src/categories/categories.repo.test.ts`. Neither affects any check.
  A human must apply these two edits.
- Dated historical docs under `docs/design/2026-09-10-ios-hig-audit.md`
  and `docs/superpowers/{plans,specs}/…` still name old paths. They are
  informational records, not live harness inputs, so they were left
  unchanged to avoid falsifying the record.
