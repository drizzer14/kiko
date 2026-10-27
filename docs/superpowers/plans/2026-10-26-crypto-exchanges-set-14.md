# Crypto exchanges 1.3-a, change set 14: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan step by step. Steps use checkbox (`- [ ]`) syntax.

**Status:** APPROVED 2026-10-26. Every S14-Q* is ruled (see "Rulings" at the end).

**Goal:** land `crypto-exchanges-1.3-a task 14/15`: the exchange catalog stored in `accounts.bankId`, the
"Exchange or wallet" picker on the crypto CREATE form (the Wallet|Binance `SegmentedControl` goes), the exchange
provider registry behind `syncJobsFor` / auto-sync / refresh and the display and disconnect copy, and the shared
provider sheet (bank and crypto) on the account detail. The demo is not changed (S14-Q2, USER).

**Architecture:** a TS-only catalog `src/crypto-sync/exchange-catalog/` (`binance`, `btc_wallet`, `other`) with
`exchangeCatalogIdOf(account)` (bank id first, then the institution); a `Partial<Record<...>>` registry
`src/crypto-sync/exchange/registry/` modelled on `bankProviderRegistry` (`src/bank-sync/registry/registry.ts`);
`ExchangeTypeField` in `src/screens/forms/exchange-type-field/` modelled on `BankTypeField`; `AddBankProviderSheet`
generalized into `ProviderSheet` (`src/screens/account-detail/provider-sheet/`, `git mv`), fed entries by each
section. No migration, no `.kiko` shape change, no demo change.

**Tech stack:** React Native, op-sqlite + Drizzle, Jest, fnts `maybe`/`Either`, ts-pattern.

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`: "## 8. Connect flow (R-Q10)", the
`exchange/registry/` row (section 2 layer table), set row 14/15 (section 11), the demo `.kiko` row and the logos row
(section 9), section 10 rows `forms.account.exchange*`, `forms.account.walletConnectable`,
`forms.account.bitcoinWallet`, `accountDetail.connectExchange*`, `accountDetail.changeExchangeAction`,
`accountDetail.disconnectProviderMessage.binance`, `help.topics.connectCrypto.steps.2`, `accountDetail.sourceLabel`.
Rulings: `rulings.md` (main checkout, `memory/refs/binance-multicoin-sdd-2026-10-21/`), Q10 (user: "How banks are
connected today"), the SCOPE RULE (USER, 2026-10-25) and "## Set 14 plan questions".

**Base:** `binance-set14` at be536af9 (= main, set 13 merged). Every code fact names a symbol or anchor text, never
a line. **The developer re-greps every fact on the actual base before relying on it.** Every count is a floor; the
developer measures.

## 1. Goal and scope (SCOPE RULE, user 2026-10-25)

| Item | Class | In set 14 |
|---|---|---|
| Exchange catalog in `accounts.bankId` (crypto), `exchangeCatalogIdOf` with the institution fallback | planned set 14 work (spec 8, row 14/15) | yes |
| `ExchangeTypeField` on the crypto CREATE form only; `SegmentedControl` + `accountDetail.sourceLabel` removed | planned set 14 work (Q10, USER; S14-Q3 = B, USER) | yes |
| Exchange registry: `syncJobsFor` / auto-sync / refresh skip an unwired id; display name and disconnect copy from the registry | planned set 14 work; (b) no regression of today's jobs | yes |
| `ProviderSheet` shared by bank and crypto sections; "Connect an exchange or wallet", "Change exchange" | planned set 14 work | yes |
| `accountDetail.disconnectProviderMessage.binance` says "Your BTC holding" while Binance now syncs every coin | (c) wrong caption (S14-Q4 = A) | yes, en + uk |
| `help.topics.connectCrypto.steps.2` names the "Source" toggle that this set removes | (c) wrong text after the set's own change, (b) | yes |
| en + uk copy, translator review; `exchangeDisclaimer` under the picker; no logo | compliance (ship; spec 9 logos row, C2 ruling) | yes |
| Demo builder, seed, demo text, both `.kiko` files | none: S14-Q2 (USER) keeps the demo byte-identical; reviewer reach (2.5.19) is the picker on the create form | no (byte-identical check only) |
| Keychain `kiko.<exchange>.credentials.<accountId>`, Binance byte-identical | (b) no regression; existing pin stays green unchanged | yes (pin only) |
| `exchangeHistoryPending` replacing `binanceHistoryPending`, backfill caption, "Earlier history", not-listed note, privacy policy, Notes for Review | set 15/15 | no |

BACKLOG (one line each, to `backlog-after-1.3.md` by the coordinator):
- S14-B1 (refactor): replace `balanceProviderIds` / `BalanceProviderId` in `sync-state.repo.ts`, `accounts.repo.ts`
  (`disconnectExchange`), `disconnect.ts`, `resync-request.ts`, `sync.ts`, `exchange-state-deps.ts`, `deletable.ts`
  with catalog-derived ids (S14-Q1 option C). No set 14 item needs it.
- S14-B2 (UX, bank parity): a provider picked in the account-detail sheet is session-only; the account keeps a null
  or `other` bank id, so after a later Disconnect its page asks through the sheet again (S14-Q7 = A).
- Every set 12 and set 13 backlog item stays there unchanged; set 14 touches none of their paths.

## 2. Global constraints

- G-1 TDD: failing test first, shown red (quote the red count), then code. Titles and comments carry no scenario
  id, ruling id or history; the commit message carries them. Tests never parse `src` text.
- G-2 A pin this set moves is updated in the SAME step and retitled to the new rule, never in a fix round. Known
  moves: `account-form.screen.test.tsx` (about 21 `'Binance'` segment presses, the tests "reuses the shared
  Wallet|Binance sync form (picker + fields) on the crypto create" and "shows the crypto sync form immediately on
  selecting Crypto, with no name gate"), `crypto-sync-section.component.test.tsx` (about 6), `add-bank-sheet`
  tests (moved by `git mv`). Any other red pin is a stop and report (class (b)).
- G-3 `account-form.screen.test.tsx` and `account-detail.screen.test.tsx` are over 1000 lines: edit their existing
  pins only (G-2), add NO new test there; new tests go into the new files named below.
  `bash scripts/checks/dup.sh <file>` alone on each new test file.
- G-4 Full-word identifiers; `@kiko/<feature>` barrels; every new export and file has a consumer at its own commit
  (knip flags an unused file), which is why steps 1/7, 3/7 and 4/7 carry their consumer with them;
  `match().exhaustive()` over a closed id set, never an if-chain. A runtime import cycle provider <-> registry is
  not allowed: the registry imports provider TYPES only (`import type`).
- G-5 No migration, no index, no `.kiko` shape change (`EXPORT_VERSION`, `VERSION_DECISIONS` unchanged): no
  migration review, no EXPLAIN QUERY PLAN test. Stop and ask if one appears. A crypto `bankId` already round-trips
  (`withBankAccountsBankIdBackfilled` touches `kind === 'bank'` only; the developer re-greps it).
- G-6 Guideline 2.5.19: no flag, no `SHOW_*`/`HIDE_*`; every catalog entry always listed in the picker; the sheet
  lists registry-wired connectable entries; capability icon gated on catalog DATA (`connectable`), never an id list
  (kiko-design-system "Capability icons"). No logo; the generic icon only (spec 9, C2 condition 1).
- G-7 Every `.bankId` reader is re-grepped for a crypto catalog id (`creatableHoldingTypesForAccount`,
  `column-mapping.screen.tsx` `mappingKeyFor`, `statement-import.screen.tsx`, `account-detail.screen.tsx`
  `isConnectableBank`, `bank-sync-section` `isBankProviderId(account.bankId)`): each must read `binance` /
  `btc_wallet` / `other` on a crypto account as "no bank". A reader that does not is a class (b) stop.
- G-8 No demo change (S14-Q2, USER): nothing under `e2e/screenshot/` is edited. A test that needs a connectable
  crypto account builds it as a test fixture in its own test file.
- G-9 Commits pass the pre-commit typecheck; Bash `timeout: 300000` for commits; never `--no-verify`. Writes to
  `src/` and `docs/` only with Edit/Write; renames with `git mv`. After `biome check --write`, run
  `node scripts/checks/import-order.js <file>`.
- G-10 Jest lines: literal paths FIRST, `--testPathIgnorePatterns=.stryker-tmp` LAST (`=` form); never an empty
  path list. Model: `npx jest src/crypto-sync/exchange-catalog/exchange-catalog.test.ts
  --testPathIgnorePatterns=.stryker-tmp`. `make jest-affected` for the step's wider check.
- G-11 A hand mutant is never restored with git: hand-apply with Edit, run, quote the red count, Edit back, then
  `git diff --exit-code -- <file>` exits 0.
- G-12 Mutation gates are PAUSED by the user (2026-10-25) until lifted: verify + review only. The gate text below
  stays for when the pause lifts; it runs per this set's own base, never whole-branch.

## 3. Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-10-26)

Set 14 closes none. Left open:
- `20261017T1639-kiko-binance-backfill-fix/1` (walk-state gate checks `accounts.institution`, not which
  connection): open; set 14 keys jobs on the institution as today and changes no walk write.
- `20261021T1839-kiko-binance-set9/1`, `/2`; `20261023T0356-kiko-binance-set12/1`, `/2`, `/3`: open, no sync or
  walk change; backlog file.
- `20261019T1704-kiko-account-currency/1` (inline Text mocks, `binance-credentials-field` among them): open; set 14
  adds no inline Text mock in its new test files (use the shared mock).
- `20261015T1657-kiko-binance-backfill-fix/2` (migration index check): open; no migration (G-5).
- TIMEOUT-HEAVY (`20261015T1119-kiko-harness-h7/2`, `20261017T1639-kiko-binance-backfill-fix/7`,
  `20261017T2005-kiko-harness-h8/6`): open; gates paused (G-12). If lifted and `src/i18n/locales/{en,uk}.ts` lines
  are mutated, the gate's own rerun rule applies.
- Every other gap (harness, kill-guard, Duo, iPad, loan, empty-selectors): open, unrelated.

## 4. Decisions this plan makes (ruled 2026-10-26)

- Registry (S14-Q1 = A): `exchangeProviderRegistry: Partial<Record<BalanceProviderId, ExchangeProviderEntry>>`,
  entries `binance` and `btc_wallet`; entry = `{ id, displayNameKey, disconnectMessageKey }` (no runtime sync
  import: `syncJobsFor` keeps `runCryptoSync(resyncRequest(...))`). `providerDisplayName` and the section's
  `disconnectMessage` read the entry; `syncJobsFor` builds a crypto job only for
  `isBalanceProviderId(institution) && exchangeProviderRegistry[institution] !== undefined`.
  `balanceProviderIds` stays the stored-value list (institution and `transactions.source` literals).
- Catalog: `exchangeCatalog` entries `{ id, displayName?, labelKey?, connectable, captionKey }` with `binance`
  (displayName "Binance", `forms.account.exchangeConnectable`), `btc_wallet` (`forms.account.bitcoinWallet`,
  `forms.account.walletConnectable`), `other` (`forms.account.exchangeOther`, `forms.account.exchangeOtherCaption`,
  last). `isExchangeCatalogId`, `exchangeCatalogIdOf({ bankId, institution })`: a catalog `bankId` wins; else an
  institution that is a catalog id; else null; the crypto section reads it. `visibleExchangeEntries()`: connectable
  AND registry-wired.
- `CryptoSyncForm` (`src/design-system/components/crypto-sync-form/`) becomes controlled by a `source` prop
  (`binance` -> `BinanceCredentialsField`, `btc_wallet` -> `WalletAddressField`, `other` -> nothing; `match`
  exhaustive). Step 3/7 adds `source` as optional (absent = today's toggle, for the create form only); step 4/7
  makes it required and deletes the toggle, `sourceLabels` and `accountDetail.sourceLabel`.
- Account form: a new `exchangeId` state beside `brokerId` (`AccountFormDraft` in `src/navigation/types/` gains
  it, null when absent in a stored draft); `catalogIdFor` gains the crypto arm; the picker shows on CREATE only,
  the edit form hides it (S14-Q3 = B); it is NOT required (S14-Q6 = A), starts at the placeholder (was: Wallet
  preselected), and locks with `isPickLocked` once a Connect started the row.
- `ProviderSheet` props: `title`, `entries: { id, label, captions: string[], accessibilityLabel }[]`, `onSelect`,
  `testID` prefix; the bank section passes `providerCatalog` rows (about + eligibility) and keeps the
  `add-bank-sheet` / `add-bank-option-<id>` test ids, so the bank sheet renders exactly as today.
- A sheet pick on the account detail is session-only, no `bankId` write (S14-Q7 = A).

## 5. Scenario matrix (each row is a Jest case; titles exact)

"was:" is today's result where Q10 or a set 14 ruling reverses it.

| # | Case | Test file | Title | Now | was: |
|---|---|---|---|---|---|
| P1 | picker lists every entry | `src/screens/forms/exchange-type-field/exchange-type-field.component.test.tsx` (new) | "lists every exchange catalog entry with Other last" | 3 rows, Other last | segmented control, 2 segments |
| P2 | capability icon | same | "shows the connect icon only on a connectable entry" | Binance and wallet rows, not Other | none |
| P3 | caption per entry | same | "shows each entry's capability caption under its name" | API key / public address / by hand | none |
| P4 | disclaimer | same | "shows the not-affiliated disclaimer under the trigger whether or not the sheet is open" | shown | none |
| P5 | placeholder then pick | same | "shows the placeholder until an entry is picked, then the entry's name" | placeholder | Wallet preselected |
| P6 | select | same | "reports the picked id and closes the sheet" | | |
| P7 | disabled | same | "opens no sheet when disabled" | | |
| F1 | create form | `src/screens/forms/account-form/account-form.exchange-type.test.tsx` (new) | "shows the exchange picker and no source toggle on the crypto create" | picker | toggle |
| F2 | field per pick | same | "shows the Binance key field once Binance is picked" / "shows the wallet address field once Bitcoin wallet address is picked" / "shows no connect field for Other exchange or wallet" | | wallet field at once |
| F3 | stored id | same | "saves the picked catalog id as the crypto account's bank id" | `bankId = 'binance'` | `bankId` null |
| F4 | no pick | same | "creates an unconnected crypto account with no bank id when nothing is picked" | null | null |
| F5 | lock | same | "locks the exchange picker once a Connect has started the row" | | |
| R1 | rollback Binance | same | "clears the Binance key pair when the account row cannot be inserted after picking Binance" | pair cleared, false | same, via toggle |
| R2 | rollback wallet | same | "reports not connected and inserts no row when the wallet Connect cannot insert the row" | false, no row, kind lock released | same, via toggle |
| R3 | connect-first order | same | "inserts the row with the picked bank id before the Binance connect runs" | row has `bankId 'binance'` | row `bankId` null |
| E1 | edit hides the picker (S14-Q3 = B) | same | "shows no exchange picker on the crypto edit form" | no picker | no picker (the crypto sync block is create-only) |
| C1 | catalog id from bank id | `src/crypto-sync/exchange-catalog/exchange-catalog.test.ts` (new) | "reads the catalog id from a crypto account's bank id" | | |
| C2 | null bank id + institution | same | "reads the catalog id from the institution when the bank id is null" | `binance` / `btc_wallet` | |
| C3 | precedence | same | "prefers the bank id over the institution" | | |
| C4 | none | same | "reads no catalog id from an unknown bank id and no institution" | null | |
| C5 | visible entries | same | "lists only the connectable entries the registry wires" | | |
| G1 | registry names | `src/crypto-sync/exchange/registry/registry.test.ts` (new) | "names each wired provider and its disconnect message in en and uk" | | closed `match` arms |
| S1 | unwired skip | `src/sync/sync-jobs/sync-jobs.unwired-provider.test.ts` (new; mocks the registry without `binance`) | "contributes no job for a connected account whose provider the registry does not wire" | `[]` | job built |
| S2 | wired beside unwired | same | "still builds the wired provider's job beside an unwired one" | | |
| S3 | refresh | `src/sync/use-sync-all/use-sync-all.unwired-provider.test.ts` (new) | "syncs every other account when one account's provider is not wired" | | |
| S4 | auto sync | `src/sync/use-auto-sync/use-auto-sync.unwired-provider.test.ts` (new) | "syncs every other account on open when one account's provider is not wired" | | |
| S5 | manual crypto with catalog id | `src/sync/sync-jobs/sync-jobs.test.ts` (small file) | "contributes no job for an unconnected crypto account whose bank id names an exchange" | `[]` | |
| K1 | Keychain byte-identical | `src/crypto-sync/binance/binance.credentials.test.ts` (existing, unchanged) | "is saved, read and cleared under the service string kiko.binance.credentials.<accountId> and the username binance" (and the `serviceFor` pin beside it; the developer quotes its title) | green unchanged | |
| D1 | detail: field direct | `src/screens/account-detail/crypto-sync-section/crypto-sync-section.component.connect.test.tsx` (new) | "shows the Binance key field directly when the bank id names Binance" / "shows the wallet address field directly when the bank id names the Bitcoin wallet" | | toggle |
| D2 | detail: sheet | same | "shows Connect an exchange or wallet when the bank id names no wired provider" | button | toggle |
| D3 | sheet rows | same | "lists every wired exchange and wallet in the connect sheet" | | |
| D4 | change | same | "shows the picked provider's field and Change exchange or wallet after a sheet pick" / "returns to Connect an exchange or wallet on Change exchange or wallet" / "shows no Change exchange or wallet when the bank id names the provider" | | |
| D5 | connected copy | same | "titles the disconnect confirm with the registry's name and message" | | |
| B1 | bank sheet unchanged | `src/screens/account-detail/provider-sheet/provider-sheet.component.test.tsx` (moved) | the four existing `add-bank-sheet` titles, green; plus "renders the entries and title its caller passes" | | |
| X1 | connect reach per connectable entry (test fixture) | `crypto-sync-section.component.connect.test.tsx` (new, D1's file) | "shows the connect field directly on an unconnected account of each connectable exchange catalog entry" (fixture: one crypto account per connectable `exchangeCatalog` entry, `bankId` naming it, built in the test, derived from the catalog, not a count) | field per entry | toggle, no catalog |
| X2 | no auto-sync for an unconnected fixture account | `src/sync/sync-jobs/sync-jobs.test.ts` | "contributes no job for an unconnected account of any connectable exchange catalog entry" (same fixture shape: `institution` null) | `[]` | `[]` |
| X3 | demo unchanged | `e2e/screenshot/fixtures/build-demo-snapshot.test.ts` and the other demo suites (existing, unchanged) | every existing title green unchanged, among them "leaves every account unconnected: institution null, so no auto-sync starts on a demo account" | green unchanged | green |

## 6. UI (device confirm by the user on the final tip; designer check per step)

- Account form, kind Crypto, CREATE: heading "Synchronization", `ExchangeTypeField` (FieldTrigger + BottomSheet +
  SelectableRow, BankTypeField look), the disclaimer caption under the trigger, then the picked field inline.
  Removed: the "Source" label and the Wallet|Binance `SegmentedControl` (kiko-design-system lists it as a
  `SegmentedControl` consumer and under "Native iOS chip/segment style"; the locked style itself is unchanged, this
  removes a consumer). Edit: no picker (S14-Q3 = B; the crypto sync block stays create-only as today).
- Account detail, crypto not connected: the field directly (bank id names a wired provider), else a
  `secondaryTonal` "Connect an exchange or wallet" button -> `ProviderSheet` -> field + "Change exchange" (the
  bank section's exact button pattern).
- Account detail, bank: `ProviderSheet` replaces `AddBankProviderSheet` with an identical render (B1 pins it).
- Connected crypto: unchanged layout; the Binance disconnect message text changes (S14-Q4).
- Approved visuals touched: none of the "Locked decisions" entries changes; the demo and its screenshots are
  unchanged (S14-Q2).

## 7. i18n (en + uk; translator review, kiko-translator "Review new/changed keys before a shipping deploy")

- New (texts from spec section 10): `forms.account.exchangeType`, `exchangeTypePlaceholder`,
  `exchangeTypeSheetTitle` (Title Case en; add to `src/i18n/locales/title-keys.ts`), `exchangeDisclaimer`,
  `exchangeConnectable`, `walletConnectable`, `bitcoinWallet`, `exchangeOther`, `exchangeOtherCaption`;
  `accountDetail.connectExchangeAction`, `connectExchangeSheetTitle` (title-keys.ts), `changeExchangeAction` ("Change exchange or wallet" / «Змінити біржу або
  гаманець», S14-Q8 = A; the spec row said "Change exchange" / «Змінити біржу»).
- Changed: `help.topics.connectCrypto.steps.2` (en + uk); `accountDetail.disconnectProviderMessage.binance` (en
  AND uk, the translator reviews the uk; S14-Q4 = A).
- Removed: `accountDetail.sourceLabel` (en + uk). `accountDetail.wallet` / `accountDetail.binance` (the
  `sourceLabels` labels) STAY: `providerDisplayName` reads them for the disconnect title, the not-imported line and
  the paused caption (S14-Q5 = A; the developer re-greps).
- `ProviderSheet`'s `title` prop joins `HEADING_PROPS` in `src/i18n/locales/title-keys.call-sites.test.ts`.
- Checks: `en.uk.parity.test.ts`, `en.casing-by-role.test.ts`, `en.final-stop-by-role.test.ts`,
  `uk.casing.test.ts`, `uk.catalog-rules.test.ts`, `title-keys.call-sites.test.ts`;
  `npm run check:component-i18n-namespace`.

## 8. Demo (unchanged, S14-Q2 = USER)

- Set 14 edits nothing under `e2e/screenshot/`: no seed account, no `bankId` on the demo Binance account, no
  `build-demo-snapshot.ts` mapping change, no `demo-text.ts` change, no regen.
- The connect-reach and no-auto-sync invariants (X1, X2) move to a TEST FIXTURE: one connectable crypto account per
  connectable `exchangeCatalog` entry, built inside the test file, not the demo.
- Reviewer reach (2.5.19): the picker on the crypto create form reaches the Binance and wallet connect fields.
- Check (step 7/7): `git diff --exit-code be536af9 -- e2e/screenshot/fixtures` exits 0 (both
  `kiko-demo-{en,uk}.kiko` byte-identical) and `build-demo-snapshot.test.ts`, `generate-demo-kiko.test.ts`,
  `screenshot-seed.test.ts` green unchanged.
- Spec sentences this reverses (step 6/7 scribe list): the demo `.kiko` row in section 9 ("Two connectable demo
  accounts ... (set 14)", "so set 14 changes that mapping", "set 14" in the regen list) and section 11 row 14/15
  (`build-demo-snapshot.ts` (crypto `bankId` kept), the `binance` and `btc_wallet` demo accounts, the demo regen,
  "demo invariant per connectable catalog entry").

## 9. Files (measured floor; the developer measures)

Mutable source files, at least 13, cap 30: `exchange-catalog.ts`, `registry.ts` (new),
`exchange-type-field.component.tsx` (new), `provider-sheet.component.tsx` (moved), `crypto-sync-form.component.tsx`,
`account-form.screen.tsx`, `crypto-sync-section.component.tsx`, `bank-sync-section.component.tsx`, `sync-jobs.ts`,
`provider.ts`, `src/i18n/locales/{en,uk}.ts`, `title-keys.ts`, `src/navigation/types/types.d.ts` (type only).
`deletable.ts` is in spec row 14/15 but unchanged under S14-Q1 A. The number that counts:
`KIKO_MUTATION_BASE=<set 14 base sha> make mutable` (step 7/7).

---

### step 1/7: exchange registry, sync jobs, display and disconnect copy

Class: planned + (b) + (c) (S14-Q4 = A). No UI layout change.
Files: `src/crypto-sync/exchange/registry/{registry.ts,registry.test.ts,index.ts}` (new),
`src/crypto-sync/provider/provider.ts`, `src/sync/sync-jobs/sync-jobs.ts`, `sync-jobs.test.ts`,
`sync-jobs.unwired-provider.test.ts`, `use-sync-all.unwired-provider.test.ts`,
`use-auto-sync.unwired-provider.test.ts` (new), `crypto-sync-section.component.tsx` (`disconnectMessage` reads the
registry), `src/i18n/locales/{en,uk}.ts` (S14-Q4, en + uk). About 12 files (the three new test files are small).
- [ ] Red first: G1, S1, S2, S3, S4, S5, X2 (S5 and X2 may pass at once: quote them as guards, not reds). Quote
      the count.
- [ ] Code: registry, `syncJobsFor` lookup, `providerDisplayName` via the entry; type-only import of provider
      types in the registry (G-4).
- Check: the new files green; `provider.test.ts`, `sync-jobs.test.ts`, `use-auto-sync.test.ts`,
  `use-sync-all.test.ts`, `crypto-sync-section.component*.test.tsx`, `disconnect.test.ts` green;
  `binance.credentials.test.ts` green unchanged (K1); knip; `npm run check:feature-imports`.
- Estimate source: bank registry rows (`kiko-*` bank-provider tasks) if any; else "no similar row".

### step 2/7: ProviderSheet for banks

Class: planned. Bank render unchanged.
Files: `git mv src/screens/account-detail/add-bank-sheet src/screens/account-detail/provider-sheet` (component,
props, styles, test, index renamed to `provider-sheet.*`), `bank-sync-section.component.tsx`,
`src/i18n/locales/title-keys.call-sites.test.ts` (HEADING_PROPS). About 7 files.
- [ ] Red first: B1's new title "renders the entries and title its caller passes" (quote red), the four moved
      titles green.
- [ ] Code: generic props (section 4); `visibleCatalogEntries` moves to the bank section (or `bank-sync/` beside
      `providerCatalog`) since the sheet no longer reads a catalog.
- Check: `provider-sheet` test, `bank-sync-section.component.test.tsx`, `account-detail.screen.test.tsx` green
  unchanged; `title-keys.call-sites.test.ts`; `npm run check:screen-imports`.
- Estimate source: no similar row.

### step 3/7: catalog and the crypto account detail

Class: planned. The create form keeps today's toggle until 4/7 (optional `source`).
Files: `src/crypto-sync/exchange-catalog/{exchange-catalog.ts,exchange-catalog.test.ts,index.ts}` (new),
`crypto-sync-form.component.tsx` (optional `source`), `crypto-sync-section.component.tsx`,
`crypto-sync-section.component.connect.test.tsx` (new), `crypto-sync-section.component.test.tsx` (moved pins),
`src/i18n/locales/{en,uk}.ts` (`accountDetail.connectExchange*`, `changeExchangeAction`, and the catalog's
`forms.account.bitcoinWallet` / `exchangeConnectable` / `walletConnectable` / `exchangeOther` /
`exchangeOtherCaption`), `title-keys.ts`. About 10 files.
- [ ] Red first: C1-C5, D1-D5, X1 (its fixture built in the test from `exchangeCatalog`). Quote the count.
- [ ] Code: section not-connected branch per section 6 with `ProviderSheet` entries from
      `visibleExchangeEntries()` (label + capability caption); the section reads `exchangeCatalogIdOf`.
- Check: new files green; `account-detail.screen.test.tsx` green unchanged; parity and casing suites (section 7).
- Estimate source: no similar row.

### step 4/7: the picker on the account create form (the toggle goes)

Class: planned. The ONLY step that removes the `SegmentedControl`.
Files: `src/screens/forms/exchange-type-field/{exchange-type-field.component.tsx,exchange-type-field.props.d.ts,
exchange-type-field.component.test.tsx,index.ts}` (new), `account-form.screen.tsx`, `src/navigation/types/types.d.ts`
(`AccountFormDraft.exchangeId`), `account-form.exchange-type.test.tsx` (new), `account-form.screen.test.tsx` (moved
pins, G-2), `crypto-sync-form.component.tsx` (`source` required, toggle and `sourceLabels` deleted),
`src/i18n/locales/{en,uk}.ts` (`forms.account.exchangeType*`, `exchangeDisclaimer`; `accountDetail.sourceLabel`
removed), `title-keys.ts`. About 12 files: above 8 because knip needs the field's consumer in the same commit.
- [ ] Red first: P1-P7, F1-F5, R1-R3 (E1 may pass at once: quote it as a guard). Quote the count.
- [ ] Code: field modelled on `BankTypeField` (capability icon gated on `connectable`, generic icon, no logo);
      form state, `catalogIdFor` crypto arm, lock; the picker renders on create only (S14-Q3 = B).
- Check: new files green; `account-form.screen.test.tsx`, `account-form.account-currency.test.tsx`,
  `accounts.stack.draft.navigator.test.tsx`, `use-draft-param.test.ts` green; `grep -rn "sourceLabel" src e2e`
  empty; the designer checks the field against `BankTypeField`.
- Estimate source: the `BankTypeField` / broker picker task rows if the estimator finds them; else "no similar row".

### step 5/7: help text and translator review

Class: (c) + compliance. Files: `src/i18n/locales/{en,uk}.ts` (`help.topics.connectCrypto.steps.2`), the spec
section 10 rows if the translator changes a uk text (same commit).
- [ ] Red first: none (copy); the help-topic suites that read step texts, if any, are updated with it (developer
      greps `connectCrypto`). `help.topics.connectCrypto.steps.2` landed in step 4/7 (the help-topics pins need it
      once `accountDetail.sourceLabel` goes).
- [ ] Translator review of every set 14 key (section 7), the uk `disconnectProviderMessage.binance` among them,
      recorded in the step report.
- Check: section 7 suites; `__tests__/spec-test-rows.test.ts` and `__tests__/docs-known-limit.test.ts` if the spec
  changed.
- Estimate source: set 8's copy step (`kiko-binance-set8`).

### step 6/7: spec alignment, reviews, retrospect, scribe, device confirm

- [ ] Spec: section 8 / row 14/15 / registry row aligned to the built registry (S14-Q1), the test titles of
      section 5 named in the spec, S14 rulings into section 1; the picker is create-only (S14-Q3 = B).
- [ ] Scribe list of spec sentences S14-Q2 reverses (section 8): the section 9 demo `.kiko` row's set 14 parts
      ("Two connectable demo accounts ... (set 14)", "so set 14 changes that mapping", "set 14" in the regen
      list) and the section 11 row 14/15 demo items (`build-demo-snapshot.ts` (crypto `bankId` kept), the
      `binance` and `btc_wallet` demo accounts, the demo regen, "demo invariant per connectable catalog entry",
      which becomes the test-fixture invariant X1/X2).
- [ ] `kiko:reviewer` G1 = steps 1/7-3/7. Top question: "can an account lose its sync job, or gain one, or show
      the wrong provider's field or copy, for any (bank id, institution) pair?"
- [ ] `kiko:reviewer` G2 = steps 4/7-5/7, then the whole branch at the tip BEFORE BATCH READY. No migration: no
      migration review.
- [ ] `kiko:designer` on the picker, the sheet and the account detail. The USER confirms on device: the account
      form crypto kind on create, the account detail not connected, the provider sheet.
- [ ] `kiko:retrospect` over both skill locations and `harness/kiko/agents/` (at least kiko-design-system
      "SegmentedControl" consumer list and "Capability icons", kiko-domain "bankId is identity-only",
      kiko-compliance demo reviewability (reach through the create-form picker, demo unchanged),
      kiko-architecture registry pointers), then `kiko:scribe` commits; a `harness/kiko` change bumps the plugin
      version. The report names the drift-fix sha or "no drift found".
- Estimate source: no similar row.

### step 7/7: demo unchanged, gates and BATCH READY

- [ ] Orchestrator: `git diff --exit-code be536af9 -- e2e/screenshot/fixtures` exits 0 (both `.kiko` files
      byte-identical); `git diff --name-only be536af9 -- e2e/screenshot` empty; the demo suites of section 8 green
      unchanged (X3).
- [ ] Orchestrator: `KIKO_MUTATION_BASE=<set 14 base sha> make mutable`: quote the list and `mutable files: N
      (cap 30)`.
- [ ] Coordinator, ONLY if the user lifted the pause (G-12): `bash scripts/job-queue.sh gate <worktree>
      "crypto-exchanges-1.3-a task 14/15 deep" <base> <head>` (detached; await the exit code).
- [ ] Coordinator: `bash scripts/job-queue.sh verify <worktree> "crypto-exchanges-1.3-a task 14/15 verify"` once at
      the tip, tree clean, rerun until green. No agent runs `make verify`.
- [ ] BATCH READY names the base sha, the `make mutable` count, the demo byte-identical result, the reviewer
      verdicts, the scribe sha, the device confirm, the S14-Q rulings and the translator review.
- Estimate source: set 13's gate rows (`kiko-binance-set13`).

## Review focus

1. `syncJobsFor`: an unwired id throws or drops the other accounts' jobs; a manual crypto account with a catalog
   bank id gets a job.
2. Bank id readers (G-7): a crypto `binance` / `btc_wallet` read as a bank somewhere.
3. Connect-first: the row inserted without the picked bank id, or the pair left in the Keychain on a failed insert.
4. Sheet and field: a non-connectable or unwired entry offered as connectable; a capability icon from an id list;
   the picker shown on the edit form.
5. Demo: any file under `e2e/screenshot/` changed.

## Rulings (S14-Q1 ... S14-Q8)

Source: `rulings.md` (main checkout, `memory/refs/binance-multicoin-sdd-2026-10-21/`), "## Set 14 plan questions".

| Id | Ruling | Who | Date |
|---|---|---|---|
| S14-Q1 | A: registry keyed by today's provider ids `binance` + `btc_wallet`; `balanceProviderIds` stays the stored-value list; catalog-derived ids everywhere is backlog S14-B1 | COORDINATOR | 2026-10-26 |
| S14-Q2 | No demo change: set 14 edits neither the demo builder nor the two `.kiko` files (no new account, no `bankId` on the demo Binance account); the demo check is byte-identical (step 7/7); a test that needs a connectable account uses a test fixture (X1, X2); the reversed spec sentences go to the scribe (step 6/7) | USER | 2026-10-26 |
| S14-Q3 | B: the "Exchange or wallet" picker shows only on create; the edit form hides it (E1) | USER | 2026-10-26 |
| S14-Q4 | A: fix the wrong Binance disconnect text now, en + uk, the translator reviews the uk (SCOPE RULE (c)) | COORDINATOR | 2026-10-26 |
| S14-Q5 | A: keep `accountDetail.wallet` / `accountDetail.binance`; only `accountDetail.sourceLabel` goes | COORDINATOR | 2026-10-26 |
| S14-Q6 | A: the picker is optional, placeholder first, no new error key | USER | 2026-10-26 |
| S14-Q7 | A: a provider picked in the account-detail sheet is not saved to `bankId`; backlog S14-B2 | COORDINATOR | 2026-10-26 |
| S14-Q8 | A: `accountDetail.changeExchangeAction` reads "Change exchange or wallet" / «Змінити біржу або гаманець» | COORDINATOR | 2026-10-26 |

Backlog S14-B1, S14-B2 (section 1): accepted by the coordinator, 2026-10-26.
