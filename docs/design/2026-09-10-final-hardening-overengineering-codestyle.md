# Full-Repo Review — Over-Engineering, Code-Style, and Structure (Kiko `src/`)

## Method

This is a full-repo review of `src/` at head `82b9145` (clean tree). It
covers over-engineering, code-style, and structure. It is not a diff
review. The reviewer checked every finding at the cited `file:line`. The
reviewer frontmatter references skills `kiko-code-style`,
`kiko-architecture`, and `kiko-domain` that do not exist as files in this
checkout. The de-facto code-style spec is
`docs/harness/review-to-biome-inventory.md`, and the design-system spec
is `harness/kiko/skills/design-system/SKILL.md`. The review used those
plus the enforced Biome and Semgrep rules. The codebase is well-factored
and self-documenting. Most helpers that look suspicious carry a
justification comment that holds up. The findings are therefore few and
specific.

## Section 1 — Over-engineering

### OE1 — Dead production helper `entityTintBackground` / `ENTITY_TINT_OPACITY`

- **Claim:** `entityTintBackground` and `ENTITY_TINT_OPACITY` have zero
  production callers.
- **Where:** `src/design-system/entity-tint.ts:19,52`.
- **Why unnecessary:** The only references anywhere in `src/` are inside
  `entity-tint.test.ts` (verified by a full-tree grep). The file's own
  comment states that the account and holding cards do not paint through
  this helper — they use `entityCardBackground`. It survives Knip because
  Knip counts test files as entry points. It is a speculative export.
- **Proposed simplification:** Delete `entityTintBackground`,
  `ENTITY_TINT_OPACITY`, and their tests. Keep `parseHex`,
  `resolveEntityColor`, `darkenHex`, and `entityCardBackground` (all have
  real consumers). `parseHex` stays as the shared parser for `darkenHex`.
- **Class:** Safe mechanical.

### OE2 — 49 one-line component barrels

- **Claim:** 49 of 53 `index.ts` files exist only to re-export a default.
- **Where:** `src/**/index.ts`
  (`export { default } from './x.component'`).
- **Why unnecessary:** Every design-system and screen component folder
  carries an `index.ts` whose entire body re-exports the default. It buys
  `import Box from '../box'` instead of `'../box/box.component'`. This is
  pure indirection: 49 files of boilerplate that must be kept in sync.
- **Proposed simplification:** Either drop the barrels and import the
  `.component` path directly, or keep them but accept the cost. This is a
  consistent convention, so a cut is all-or-nothing.
- **Class:** User design decision.

### OE3 — `box.styles.ts` is a no-op StyleSheet

- **Claim:** `box.styles.ts` defines a base style that does nothing.
- **Where:** `src/design-system/components/box/box.styles.ts:3`.
- **Why unnecessary:** `styles.box` is
  `{ backgroundColor: 'transparent' }`, which is the `View` default. It
  always sits first in Box's style array, where any real style overrides
  it. The `.styles.ts` file exists only to satisfy the per-component file
  convention.
- **Proposed simplification:** Drop `box.styles.ts` and the `styles.box`
  reference. Box needs no base stylesheet.
- **Class:** Safe mechanical (but it breaks the "every component has a
  .styles.ts" convention — see the OE2 spirit).

### OE4 — `monobank/sync.ts` `SyncDeps` granularity

- **Claim:** `SyncDeps` mirrors 20+ single-call repo methods as
  pass-through members.
- **Where:** `src/monobank/sync.ts:73-202`.
- **Why unnecessary:** `SyncDeps` is a 20+ member interface where most
  members wrap a single repo call
  (`setLastSyncAt: (t) => settingsRepo.setLastSyncAt(t)`,
  `closeHoldings: (ids) => holdingsRepo.closeMany(ids)`, and more).
  Injecting the roughly 5 underlying repos (plus `now`, `sleep`, `fetch`)
  instead of 20+ hand-mirrored functions would cut the interface and
  `defaultDeps` roughly in half.
- **Note:** The `*Deps` seam is a consistent, codebase-wide test pattern
  (8 modules), so the pattern itself is a deliberate architectural
  choice. Only this instance's granularity is an outlier. The change is
  risky, because the 89 KB test file relies on it heavily.
- **Proposed simplification:** Inject the underlying repos instead of the
  per-method pass-throughs, if the team accepts the test-file churn.
- **Class:** User design decision.

## Section 2 — Code-style

### CS1 — `Btc` breaks the "BTC stays uppercase" acronym rule

- **Claim:** The i18n key `invalidBtcAddress` lower-cases the `BTC`
  acronym.
- **Where:** `src/i18n/locales/en.ts:263`, `src/i18n/locales/uk.ts:245`,
  and
  `src/screens/account-detail/wallet-address-field/wallet-address-field.component.tsx:50`.
- **Rule it breaks:** The currency code (`'BTC'`) and the inventory's
  acronym rule (`PAN`, `IBAN`, `MCC`, `ID`, `JSON`, `BTC` stay uppercase)
  keep `BTC` uppercase everywhere else. This is a purely internal key
  with no external wire contract.
- **Proposed fix:** Rename the key to `invalidBTCAddress` in both locale
  files and its single call site.
- **Class:** Safe mechanical.

### CS2 — `maskedPan` / `counterIban` acronym casing

- **Claim:** `maskedPan` and `counterIban` lower-case the `PAN` and
  `IBAN` acronyms.
- **Where:** `src/db/schema.ts:85`,
  `src/monobank/monobank.types.d.ts:18,59`,
  `src/monobank/sync.ts:217,236,240`.
- **Rule it breaks:** The same acronym rule. But, unlike CS1, these
  mirror the literal Monobank API JSON field names (`maskedPan`,
  `counterIban` are the wire contract), which is the standard reason to
  keep external casing.
- **Proposed fix:** None recommended. Treat this as an intentional
  wire-mirror exception. If desired, document it beside the acronym rule
  so it is not re-flagged.
- **Class:** User design decision (leave as-is is the likely answer).

### CS3 — Default exports outside `*.component.tsx` / `*.screen.tsx`

- **Claim:** Several component-bearing files default-export under other
  suffixes.
- **Where:** `src/navigation/{accounts,home,statistics,settings}.stack.tsx`,
  `src/db/migrations.gate.tsx`, and `src/test-support/mock-text-tone.tsx`.
- **Rule it breaks:** The convention is "default export only in
  `*.component.tsx` / `*.screen.tsx`; named elsewhere." These files are
  React components under other suffixes (`.stack.tsx`, `.gate.tsx`, and a
  test-support `.tsx`) that default-export.
- **Proposed fix:** Either rename to the `.component.tsx` suffix (for
  example, `mock-text-tone.component.tsx`), or amend the convention to
  admit `.stack.tsx` and `.gate.tsx` as component-bearing suffixes.
- **Class:** User design decision.

### CS4 — Currency-symbol placement rule duplicated

- **Claim:** The symbol-placement rule is written twice.
- **Where:** `src/currency/format.ts:14` and `src/currency/compact.ts:81`.
- **Rule it breaks:** The "UAH suffixes the symbol, everything else
  prefixes it" rule is written twice
  (`money.currency === 'UAH' ? ... : ...`). This is exactly the kind of
  currency-mapping convention the design-system single-source-of-truth
  ethos wants in one place. A new currency with suffix placement would
  need an edit in two spots.
- **Proposed fix:** Extract one helper (for example,
  `placeSymbol(sign, body, symbol, currency)`) in `currency/` and call it
  from both `formatMoney` and `formatCompactMoney`.
- **Class:** Safe mechanical.

### Clean bills (checked, no findings)

There are no hardcoded colors or rgba values in `design-system/components`
or `screens` styles (the design-system token rule is respected). There
are no `: Repository` annotations (all repos use `satisfies`). There are
no cross-`*.screen.tsx` value imports (the import-boundary is respected).
There is no hand-rolled `pipe` or `compose`. The blank-line-before-return
rule is observed in the sampled files.

## Section 3 — Structural refactor (recommendation only — nothing moved)

The current `src/` mixes two organizing principles:

- **Feature folders (already good):** `holdings/`, `statistics/`,
  `currency/`, `dates/`, `transactions/`, `categories/`, `monobank/`,
  `crypto-sync/`, `rates/`, `auth/`.
- **Layer folders:** `repositories/`, `screens/`, `db/`, `i18n/`,
  `navigation/`, `design-system/`, `test-support/`.

The sharpest mismatch is `src/repositories/`: a feature's repository is
severed from its existing domain folder. `holdings` has 11 domain files
in `src/holdings/`, but its repo sits in
`src/repositories/holdings.repo.ts`. The same is true for `transactions`,
`categories`, and `rates`. Co-locating the repo with its domain is the
highest-value, lowest-risk structural change. It directly answers the
brief to group repositories and domain logic into feature folders.

Hooks, by contrast, are already feature-co-located
(`db/use-live-query.ts`, `auth/use-app-lock.ts`,
`i18n/use-sync-language-with-settings.ts`,
`navigation/use-scroll-to-top-on-tab-press.ts`). Leave them.

### Proposed target tree

The screens and design-system stay as shared layers, because React
Navigation and the design system are genuinely cross-feature.

```
src/
  holdings/            holding-value.ts, interest.ts, …, holdings.repo.ts        ← + repo
  transactions/        row-description.ts, …, transactions.repo.ts               ← + repo
  categories/          category-display.ts, categories.repo.ts,
                       category-overrides.repo.ts                                ← + repos
  rates/               coingecko.ts, …, rate-history.repo.ts, rates.repo.ts      ← + repos
  accounts/  (new)     accounts.repo.ts                                          ← new leaf (no domain today)
  settings/  (new)     settings.repo.ts                                          ← new leaf
  monobank/            (unchanged — already self-contained)
  crypto-sync/         (unchanged)
  statistics/          (unchanged)
  currency/ dates/ auth/ i18n/                                                   (unchanged)
  db/                  client.ts, schema.ts, migrations, keys, repository.d.ts, capture-set-tx.ts
  design-system/ navigation/ screens/ test-support/                             (shared layers, unchanged)
```

### From → to move map

- `src/repositories/holdings.repo.ts(.test.ts)` → `src/holdings/`
- `src/repositories/transactions.repo.ts(.test.ts)` → `src/transactions/`
- `src/repositories/categories.repo.ts(.test.ts)` +
  `category-overrides.repo.ts(.test.ts)` → `src/categories/`
- `src/repositories/rate-history.repo.ts(.test.ts)` +
  `rates.repo.ts(.test.ts)` → `src/rates/`
- `src/repositories/accounts.repo.ts(.test.ts)` → new `src/accounts/`
- `src/repositories/settings.repo.ts(.test.ts)` → new `src/settings/`
- `src/repositories/repository.d.ts`, `capture-set-tx.ts`,
  `__fixtures__/` → `src/db/` (shared repo infrastructure, not
  feature-specific)
- Then delete the empty `src/repositories/`.

### Caveats

This change touches import paths across most of `src/` and several
harness path assumptions. Stryker's KEEP-LIST references
`src/repositories/categories.repo.test.ts`. The `.gitleaks`, knip, and
depcheck configs and the `settings-columns.test.ts` cross-file assertion
should be re-grepped. It is a pure move with no behavior change, but it is
broad. This is a user design decision. Do not execute it without an
explicit go and a dedicated worktree.

## Safe-mechanical vs user-design-decision summary

- **Safe mechanical:** OE1 (delete the dead `entityTintBackground` /
  `ENTITY_TINT_OPACITY` plus tests), OE3 (drop the no-op
  `box.styles.ts`), CS1 (rename `invalidBtcAddress` to
  `invalidBTCAddress`), CS4 (extract the shared currency-symbol placement
  helper).
- **User design decision:** OE2 (cut vs keep the 49 component barrels),
  OE4 (flatten `SyncDeps` to repo-level injection), CS2 (the Monobank
  wire-mirror casing — likely leave as-is plus document), CS3 (the
  default-export convention for `.stack` / `.gate` / test-support), and
  SR (the whole repository co-location refactor).
