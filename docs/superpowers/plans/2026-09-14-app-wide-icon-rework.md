# App-Wide SF Symbol Icon Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan is a MAPPING REFERENCE + infrastructure spec — implementation is BLOCKED (see the Sequencing section). Do NOT begin coding until the shared-file worktree lands.**

**Goal:** Replace every SF Symbol icon literal in the app with an intended NEW icon, driven by a finalized known mapping, and report every call site the mapping does not cover as an explicit GAP with an UNRESOLVED candidate.

**Architecture:** Icon strings live in three places — a small number of central maps (`entity-symbols.ts`, DB category seeds), a large user-selectable library (`icon-picker-modal` CURATED_ICONS), and per-call-site literals scattered across screens/components. The rework touches central maps once, adds three small infrastructure seams (SymbolIcon `fallbackName`, a TextField leading-icon slot, a transaction-type ChipRow `icons` map), and rewrites each literal. Two mapping entries use iOS-26-only symbols and therefore REQUIRE the new fallback seam.

**Tech Stack:** React Native, `react-native-nitro-sfsymbols` (`SFSymbolView`, renders `systemName` only), `react-native-unistyles`, Biome/jscpd/Knip/Semgrep quality harness.

**Spec:** This document is self-contained (the governing rule + finalized mapping were handed to the planner directly). No separate spec file.

## Global Constraints

- **Governing rule:** Do NOT keep ANY old icon by default. Every call site MUST map to an intended NEW icon. Anything not covered by the Known Mapping is a GAP — it gets a PROPOSED candidate marked **UNRESOLVED**, never the old icon.
- **Minimum iOS 16.** The two iOS-26-only symbols (`text.pad.header`, `arrow.trianglehead.branch`) MUST render through a `fallbackName` (`list.bullet.rectangle` / `arrow.branch`). `SFSymbolView` renders `systemName` only and has no built-in fallback.
- Entity icons apply to **generic references only** (type defaults, form headings, empty states, section labels). They MUST NOT override a per-entity icon the user chose.
- `transaction.expense` points **UP**; `transaction.income` points **DOWN**. Intentional — do not "fix" it.
- The Other / default category default stays `square.grid.2x2`.
- Harness: `npm run check:all` at each task checkpoint, `npm run check:deep` before declaring done. Do not weaken any check to get green.

---

## 1. Inventory (source of truth)

### 1.1 Entity symbol maps — `src/holdings/entity-symbols/entity-symbols.ts`

| Line | Current icon | Purpose |
|---|---|---|
| :21 | `building.columns.fill` | `accountKindSymbol.bank` |
| :22 | `banknote` | `accountKindSymbol.cash` |
| :23 | `bitcoinsign` | `accountKindSymbol.crypto` |
| :31 | `creditcard` | `holdingTypeSymbol.card` |
| :32 | `calendar` | `holdingTypeSymbol.term_deposit` |
| :33 | `receipt` | `holdingTypeSymbol.bond` |
| :34 | `archivebox` | `holdingTypeSymbol.jar` |
| :35 | `banknote` | `holdingTypeSymbol.cash` |
| :36 | `bitcoinsign` | `holdingTypeSymbol.crypto_asset` |

**Dynamic consumers of these maps** (no literal; render whatever the map/entity supplies — changing the map changes them all): `accounts.screen.tsx:170`, `holding-card.component.tsx:98`, `account-detail.screen.tsx:83` (`accountIdentity`, falls back to `accountKindSymbol[kind]`), `account-form.screen.tsx:395` (ChipRow `icons=accountKindSymbol`), `holding-form.screen.tsx:545` (ChipRow `icons=holdingTypeSymbol`), `holding-form.screen.tsx:517` (`fallbackIcon={holdingTypeSymbol[type]}`), `entity-header-icon.component.tsx:23-24`, `entity-icon-tile.component.tsx:104`, `icon-editor.component.tsx:67`. `account-form.screen.tsx:53` `FALLBACK_ICON='square.grid.2x2'` is a standalone literal (see mapping).

### 1.2 DB-seeded category defaults — `drizzle/migrations/0002_seed_categories.sql` (transport refined to `bus` in `0017`)

| Current icon | Category | Note |
|---|---|---|
| `cart` | groceries | |
| `fork.knife` | dining | |
| `bus` | transport | refined in migration 0017 |
| `bag` | shopping | |
| `bolt` | utilities | |
| `gamecontroller` | entertainment | |
| `cross.case` | health | |
| `banknote` | cash | |
| `arrow.left.arrow.right` | transfers | |
| `square.grid.2x2` | other | |

All render sites are dynamic via `category.icon`. A NEW default changes the seed AND must ship as a migration that updates existing untouched-default rows (out of scope for the icon strings themselves; note it for the executor).

### 1.3 Tab bar — `src/navigation/root.navigator.tsx`

| Line | Current icon | Purpose |
|---|---|---|
| :61 | `house.fill` | Home tab |
| :68 | `wallet.pass.fill` | Accounts tab |
| :76 | `chart.xyaxis.line` | Statistics tab |
| :82 | `gearshape.fill` | Settings tab |

### 1.4 Transaction-type chip row — `transaction-form.screen.tsx:1936-1944`

ChipRow with NO `icons` prop today — income/expense/exchange/split are TEXT-ONLY. `ChipRow` (`chip-row.component.tsx`/`chip-row.props.d.ts:19`) already supports an optional `icons?: Partial<Record<Option,string>>` map and renders a glyph per chip only when it is passed. Adding icons here is NET-NEW at the call site, using existing infra.

### 1.5 Trend filter — `trend-filter-field.component.tsx`

| Line | Current icon | Purpose |
|---|---|---|
| :200 | `line.3.horizontal.decrease.circle` | filter trigger |
| :233-267 | (text-only) | Mode / Amount / Measure OptionPills — `OptionPills` supports an optional `icon` render-prop, but no production call passes one |
| :86 | `option.icon` (dynamic) | Manual-mode category SelectableRow |

### 1.6 Settings + categories

| File:line | Current icon | Purpose |
|---|---|---|
| `settings.screen.tsx:53` | `gearshape` | System row |
| `settings.screen.tsx:68` | `dollarsign.circle` | Base Currency row |
| `settings.screen.tsx:83` | `square.grid.2x2` | Categories row |
| `system.screen.tsx:47` | `globe` | Language row |
| `app-lock-setting.component.tsx:60` | `faceid` | App Lock row |
| `settings-row.component.tsx:21` | (generic leading-icon prop) | pass-through |
| `settings-row.component.tsx:36` | `chevron.right` | disclosure chevron |
| `add-category-row.component.tsx:19` | `square.grid.2x2` | `DEFAULT_ICON` new-category default |
| `add-category-row.component.tsx:94` | `plus` | Add category |
| `categories.screen.tsx:208` | `star.fill` | default marker |
| `categories.screen.tsx:219` | `star` | set-as-default |
| `categories.screen.tsx:258` | `trash` | delete |
| `categories.screen.tsx:282` | `arrow.up.to.line` | move top |
| `categories.screen.tsx:292` | `arrow.down.to.line` | move bottom |

### 1.7 Account detail / crypto sync

| File:line | Current icon | Purpose |
|---|---|---|
| `account-detail.screen.tsx:59` | `link` | Monobank Connect |
| `account-detail.screen.tsx:64` | `arrow.triangle.2.circlepath` | Sync now |
| `account-detail.screen.tsx:267` | `clock` | last synced |
| `account-detail.screen.tsx:307` | `link.badge.plus` | Disconnect |
| `crypto-sync-section.component.tsx:92` | `clock` | last synced |
| `crypto-sync-section.component.tsx:113` | `arrow.triangle.2.circlepath` | Sync now |
| `crypto-sync-section.component.tsx:123` | `link.badge.plus` | Disconnect |
| `wallet-address-field.component.tsx:85` | `doc.on.clipboard` | paste |
| `wallet-address-field.component.tsx:96` | `link` | Connect Wallet |
| `binance-credentials-field.component.tsx:116` | `doc.on.clipboard` | paste key |
| `binance-credentials-field.component.tsx:139` | `doc.on.clipboard` | paste secret |
| `binance-credentials-field.component.tsx:150` | `link` | Connect Binance |
| `monobank-token-input.component.tsx:65` | `doc.on.clipboard` | paste token |
| `monobank-token-field.component.tsx:123` | `checkmark.circle` | Save token |
| `sync-status-line.component.tsx:30` | `checkmark.circle` | success |
| `sync-status-line.component.tsx:45` | `xmark.circle` | error |
| `entity-header-icon.component.tsx:23-24` | `identity.icon` (dynamic) | detail-screen header |

### 1.8 Calendar / date / time

| File:line | Current icon | Purpose |
|---|---|---|
| `calendar-header.component.tsx:51` | `chevron.left.2` | prev year |
| `calendar-header.component.tsx:60` | `chevron.left` | prev month |
| `calendar-header.component.tsx:75` | `chevron.right` | next month |
| `calendar-header.component.tsx:84` | `chevron.right.2` | next year |
| `date-field.component.tsx:92` | `calendar` | date trigger |
| `date-range-field.component.tsx:215` | `calendar` | date-range trigger |
| `time-field.component.tsx:69` | `clock` | time trigger |

### 1.9 Icon-picker library — `icon-picker-modal.component.tsx:32-181`

138 entries, 10 groups. The user-selectable category-icon library. Treated as ONE gap set.

### 1.10 Other literals

| File:line | Current icon | Purpose |
|---|---|---|
| `selectable-row.component.tsx:45` | `checkmark` | selected marker |
| `edit-header-button.component.tsx:25` | `pencil` | Edit nav button |
| `card-context-menu.component.tsx:168` | `doc.on.doc` | Duplicate |
| `card-context-menu.component.tsx:175` | `trash` | Delete |
| `holding-select-field.component.tsx:99/101` | `option.icon` (dynamic) | option glyph |
| `holding-select-field.component.tsx:115` | `checkmark` | selected marker |
| `field-trigger.component.tsx:52` | (dynamic `icon` prop) | pass-through |
| `category-field.component.tsx:17` | `tag` | `PLACEHOLDER_ICON` before pick |
| `transaction-form.screen.tsx:992` | `trash` | remove return row |
| `transaction-form.screen.tsx:1005` | `plus` | add return row |
| `transaction-form.screen.tsx:1088` | `arrow.left.arrow.right` | convert to exchange |
| `transaction-form.screen.tsx:1101` | `trash` | delete tx |
| `holding-form.screen.tsx:614` | `trash` | remove contribution |
| `holding-form.screen.tsx:632` | `plus` | add contribution |
| `add-transaction-fab.component.tsx:34` | `plus` | global FAB |
| `filter-menu.component.tsx:60` | `line.3.horizontal.decrease.circle` | Home filter trigger |
| `lock-gate.component.tsx:92` | `faceid` | cold-launch lock glyph |
| `icon-editor.component.tsx:67` | (dynamic `displayIcon`) | pass-through |
| `button.component.tsx:82,88` | (shared render path) | every icon literal flows through here |

### 1.11 Key infrastructure facts (verified in code)

- `SymbolIcon` (`symbol.component.tsx:12`, props `symbol.props.d.ts`) wraps `SFSymbolView`. Props today: `name`, `size`, `tone`, `color`, `accessibilityLabel`. **No `fallbackName`, no `systemName`.** `SFSymbolView` renders `systemName` only.
- **No `magnifyingglass` / search icon anywhere.** There IS a search TextField — `currency-field.component.tsx:161` (the currency-picker sheet's search box). No other search input exists.
- No modal/sheet `xmark` close button exists — sheets dismiss by backdrop / hardware-back.
- **No generic entity glyph exists.** `accountIdentity` (`account-detail.screen.tsx:77-85`) resolves `account.icon ?? accountKindSymbol[account.kind]` — the fallback is the per-KIND default, not a distinct generic account glyph. Same shape for holdings (`fallbackIcon={holdingTypeSymbol[type]}`). Empty states (`accounts.screen.tsx:110`) are TEXT-ONLY, no icon. So `entity.holding` and `entity.transaction` generic glyphs have NO existing call site (see mapping notes).
- `crypto-sync-section:123` and `account-detail:307` BOTH use `link.badge.plus` for Disconnect — reads as "add link", a likely pre-existing copy/paste mismatch.

---

## 2. Known mapping applied

### 2.1 Custom → standard (finalized) — GENERIC entity glyphs + transaction glyphs

These are the GENERIC entity glyphs (heading / empty-state / section-label references), separate from the per-KIND type-defaults (which are decided in §2.4).

| Mapping item | NEW icon | Existing call site(s) it touches | Notes |
|---|---|---|---|
| `entity.account` (generic) | `tray` | `account-form.screen.tsx:53` `FALLBACK_ICON` (generic account default in HoldingIdentityField) | Generic only — must NOT override a user-chosen or kind-specific icon. This is the one existing generic-account literal. |
| `entity.holding` (generic) | `text.pad.header` (fallback `list.bullet.rectangle`) | **NONE — new addition** | No generic holding glyph exists today (`holding-form:517` uses the type-specific default). REQUIRES `fallbackName` (iOS-26 symbol). Add as a new generic entity symbol; wire only where a generic holding reference is wanted (empty state / section label) — none exists yet, so this ships as scaffolding until a consumer is added. |
| `entity.transaction` (generic) | `arrow.up.arrow.down` | **NONE — new addition** | Transactions have no icon field and no generic glyph today. Ships as scaffolding until a consumer (e.g. an empty transactions state) is added. |
| `transaction.exchange` | `arrow.left.arrow.right` | transaction-type chip (net-new, §2.3) | |
| `transaction.expense` | `arrow.up` | transaction-type chip (net-new, §2.3) | Points UP — intentional. |
| `transaction.income` | `arrow.down` | transaction-type chip (net-new, §2.3) | Points DOWN — intentional. |
| `transaction.split` | `arrow.trianglehead.branch` (fallback `arrow.branch`) | transaction-type chip (net-new, §2.3) | REQUIRES `fallbackName` (iOS-26 symbol). |

### 2.2 Listed swaps (finalized)

| Mapping item | NEW icon | Existing call site(s) | Notes |
|---|---|---|---|
| search inputs | `magnifyingglass` | `currency-field.component.tsx:161` (search TextField) | REQUIRES a NEW leading-icon slot on the shared TextField (§4). **The slot HAS a real consumer** (the CurrencyField search box) — it is not pure scaffolding, though it is the only consumer today. |
| categories generally | `tag` | `settings.screen.tsx:83` (Categories row), `category-field.component.tsx:17` (`PLACEHOLDER_ICON`, already `tag` — stays), trend-filter Manual mode (net-new pill icon, §2.3) | |
| Other / default category | `square.grid.2x2` (stays) | `0002_seed_categories.sql` `other` seed | The ONLY DB category default the mapping covers; the rest are gaps (§3). |
| settings navigation | `gear` | `root.navigator.tsx:82` (Settings tab) | **TENSION:** the gap brief also enumerates all 4 tab icons. Resolved here: Settings tab is COVERED (→`gear`); the other 3 tab icons are gaps (§3). Tab bar uses filled variants elsewhere; `gear` has no `.fill` — executor confirms on-device weight. Flagged for human confirmation. |
| system settings | `gearshape` | `settings.screen.tsx:53` (System row) | Stays `gearshape`. |
| connect a syncable account | `lock` | `account-detail.screen.tsx:59` (Monobank Connect), `wallet-address-field.component.tsx:96` (Connect Wallet), `binance-credentials-field.component.tsx:150` (Connect Binance) | All current `link` connect buttons. |
| disconnect | `lock.open` | `account-detail.screen.tsx:307`, `crypto-sync-section.component.tsx:123` | Both currently `link.badge.plus`. **Covers the pre-existing `link.badge.plus` "add link" mismatch** — the swap to `lock.open` fixes the wrong glyph incidentally; call it out so the executor knows the odd source is expected. |
| trend filter Top mode | `chart.bar.fill` | trend-filter Mode OptionPill (net-new pill icon, §2.3) | |
| Main currency setting | `hryvniasign.circle` | `settings.screen.tsx:68` (Base Currency row) | Was `dollarsign.circle`. |

### 2.3 Net-new icon additions (covered by mapping, no existing literal)

| Where | NEW icons | Mechanism |
|---|---|---|
| `transaction-form.screen.tsx:1936` chip row | income→`arrow.down`, expense→`arrow.up`, exchange→`arrow.left.arrow.right`, split→`arrow.trianglehead.branch` (fallback `arrow.branch`) | Pass an `icons` map to the existing `ChipRow` `icons` prop. Split needs `fallbackName`. |
| trend-filter Mode OptionPills (`:233-267`) | Top→`chart.bar.fill`, Manual→`tag` | Pass the existing optional `icon` render-prop on `OptionPills` (no production call passes one today). |
| CurrencyField search box (`:161`) | `magnifyingglass` | New TextField leading-icon slot (§4). |

### 2.4 Entity type-defaults — DECIDED (`entity-symbols.ts`)

The per-KIND account/holding type-defaults are DECIDED, not pending. User rule: "default icons remain unchanged" EXCEPT two changes — jar and the two crypto defaults. These are NOT gaps and NOT part of any collection — they stay in the mapping as decided rows.

| Line | Map entry | Current | New | Status |
|---|---|---|---|---|
| :21 | `accountKindSymbol.bank` | `building.columns.fill` | `building.columns.fill` | **UNCHANGED** |
| :22 | `accountKindSymbol.cash` | `banknote` | `banknote` | **UNCHANGED** |
| :23 | `accountKindSymbol.crypto` | `bitcoinsign` | `bitcoinsign.circle` | **CHANGE** |
| :31 | `holdingTypeSymbol.card` | `creditcard` | `creditcard` | **UNCHANGED** |
| :32 | `holdingTypeSymbol.term_deposit` | `calendar` | `calendar` | **UNCHANGED** |
| :33 | `holdingTypeSymbol.bond` | `receipt` | `receipt` | **UNCHANGED** |
| :34 | `holdingTypeSymbol.jar` | `archivebox` | `rectangle.portrait` | **CHANGE** |
| :35 | `holdingTypeSymbol.cash` | `banknote` | `banknote` | **UNCHANGED** |
| :36 | `holdingTypeSymbol.crypto_asset` | `bitcoinsign` | `bitcoinsign.circle` | **CHANGE** |

Three type-default changes total: `bank`/`cash`/`card`/`term_deposit`/`bond`/(holding)`cash` stay unchanged; `jar` → `rectangle.portrait`; both crypto defaults (`crypto`, `crypto_asset`) → `bitcoinsign.circle`.

---

## 3. GAPS (every call site NOT covered by §2)

**Rule reminder:** each NORMAL-gap row gets a PROPOSED candidate marked **UNRESOLVED**. None is the old icon. A human resolves each before implementation; the existing glyph may be re-affirmed by a human but is NOT auto-kept.

**Two forthcoming icon COLLECTIONS will resolve two whole gap areas — do NOT invent UNRESOLVED candidates for them.** Each is a COLLECTION OF STANDARD SF SYMBOLS (not custom-drawn glyphs); the exact symbol names will come from the user's export FILENAMES, still pending. They are structured gaps labelled **PENDING-COLLECTION** (§3.0). The collection files are **not exported yet**; their mappings will arrive from the coordinator. Every OTHER uncovered icon stays a normal UNRESOLVED gap (§3.4 onward).

### 3.0 PENDING-COLLECTION gap areas

**Open design question (shared pool):** today a SINGLE shared `CURATED_ICONS` pool (`icon-picker-modal.component.tsx:32-181`) feeds BOTH the category picker AND the account/holding IconEditor (`icon-editor.component.tsx:67`). The two collections below may SPLIT that shared pool into two distinct pools, or REPLACE it entirely — unresolved until the collection files arrive.

#### 3.0.1 PENDING-COLLECTION — "Kiko Entity" (account/holding icon-PICKER pool)

The **Kiko Entity** collection is the pool of standard SF Symbols a user picks from for a SPECIFIC account or holding (via the IconEditor). Its symbol names come from the user's still-pending export filenames. This does NOT include the per-KIND type-defaults — those are DECIDED in §2.4.

| Scope | Current | Status |
|---|---|---|
| The account/holding icon-PICKER pool (the options a user chooses from for a specific account/holding; today served by the shared `CURATED_ICONS` pool via `icon-editor.component.tsx:67`) | shared `CURATED_ICONS` | **PENDING-COLLECTION (Kiko Entity)** — names from user export filenames, not yet exported |

#### 3.0.2 PENDING-COLLECTION — "Kiko Categories" (category-picker pool + category seeds)

The **Kiko Categories** collection is the standard-SF-Symbol pool for the category picker, plus every DB-seeded category default (transport and `other` included). Its symbol names come from the user's still-pending export filenames.

| Scope | Current | Status |
|---|---|---|
| `icon-picker-modal.component.tsx:32-181` — the whole 138-entry `CURATED_ICONS` category-picker pool (10 groups) | 138 entries | **PENDING-COLLECTION (Kiko Categories)** |
| DB seed `groceries` | `cart` | **PENDING-COLLECTION (Kiko Categories)** |
| DB seed `dining` | `fork.knife` | **PENDING-COLLECTION (Kiko Categories)** |
| DB seed `transport` | `bus` (refined in `0017`) | **PENDING-COLLECTION (Kiko Categories)** |
| DB seed `shopping` | `bag` | **PENDING-COLLECTION (Kiko Categories)** |
| DB seed `utilities` | `bolt` | **PENDING-COLLECTION (Kiko Categories)** |
| DB seed `entertainment` | `gamecontroller` | **PENDING-COLLECTION (Kiko Categories)** |
| DB seed `health` | `cross.case` | **PENDING-COLLECTION (Kiko Categories)** |
| DB seed `cash` | `banknote` | **PENDING-COLLECTION (Kiko Categories)** |
| DB seed `transfers` | `arrow.left.arrow.right` | **PENDING-COLLECTION (Kiko Categories)** |
| DB seed `other` | `square.grid.2x2` | **PENDING-COLLECTION (Kiko Categories)** — note: §2.2 finalizes `other`→`square.grid.2x2` (stays); the collection governs the set as a whole and is expected to reaffirm it. |

Any resolved DB-default change needs a data migration for existing untouched-default rows.

### 3.4 Tab bar — `root.navigator.tsx`

| Line | Current | Tab | Proposed candidate |
|---|---|---|---|
| :61 | `house.fill` | Home | `house.circle.fill` — **UNRESOLVED** |
| :68 | `wallet.pass.fill` | Accounts | `tray.fill` (align with `entity.account`→`tray`) — **UNRESOLVED** |
| :76 | `chart.xyaxis.line` | Statistics | `chart.bar.xaxis` — **UNRESOLVED** |
| :82 | `gearshape.fill` | Settings | **COVERED** in §2.2 (→ `gear`). Listed here for completeness. |

### 3.5 Settings + categories screens

| File:line | Current | Purpose | Proposed candidate |
|---|---|---|---|
| `settings-row.component.tsx:36` | `chevron.right` | disclosure chevron | `chevron.forward` — **UNRESOLVED** |
| `add-category-row.component.tsx:19` | `square.grid.2x2` | new-category `DEFAULT_ICON` | `tag` — **UNRESOLVED** (tension: "categories generally→tag" vs "default stays square.grid.2x2"; may fold into the Kiko Categories collection since it is a category-default constant) |
| `add-category-row.component.tsx:94` | `plus` | Add category | `plus.circle.fill` — **UNRESOLVED** |
| `categories.screen.tsx:208` | `star.fill` | default marker | `checkmark.seal.fill` — **UNRESOLVED** |
| `categories.screen.tsx:219` | `star` | set-as-default | `checkmark.seal` — **UNRESOLVED** |
| `categories.screen.tsx:258` | `trash` | delete | `trash.fill` — **UNRESOLVED** |
| `categories.screen.tsx:282` | `arrow.up.to.line` | move top | `arrow.up.to.line.compact` — **UNRESOLVED** |
| `categories.screen.tsx:292` | `arrow.down.to.line` | move bottom | `arrow.down.to.line.compact` — **UNRESOLVED** |
| `system.screen.tsx:47` | `globe` | Language row | `character.bubble` — **UNRESOLVED** |
| `app-lock-setting.component.tsx:60` | `faceid` | App Lock row | `lock.shield` — **UNRESOLVED** |
| `lock-gate.component.tsx:92` | `faceid` | cold-launch lock glyph | `lock.shield` — **UNRESOLVED** |

### 3.6 Account detail / crypto sync

| File:line | Current | Purpose | Proposed candidate |
|---|---|---|---|
| `account-detail.screen.tsx:64` | `arrow.triangle.2.circlepath` | Sync now | `arrow.clockwise` — **UNRESOLVED** |
| `account-detail.screen.tsx:267` | `clock` | last synced | `clock.arrow.circlepath` — **UNRESOLVED** |
| `crypto-sync-section.component.tsx:92` | `clock` | last synced | `clock.arrow.circlepath` — **UNRESOLVED** |
| `crypto-sync-section.component.tsx:113` | `arrow.triangle.2.circlepath` | Sync now | `arrow.clockwise` — **UNRESOLVED** |
| `wallet-address-field.component.tsx:85` | `doc.on.clipboard` | paste | `clipboard.fill` — **UNRESOLVED** |
| `binance-credentials-field.component.tsx:116` | `doc.on.clipboard` | paste key | `clipboard.fill` — **UNRESOLVED** |
| `binance-credentials-field.component.tsx:139` | `doc.on.clipboard` | paste secret | `clipboard.fill` — **UNRESOLVED** |
| `monobank-token-input.component.tsx:65` | `doc.on.clipboard` | paste token | `clipboard.fill` — **UNRESOLVED** |
| `monobank-token-field.component.tsx:123` | `checkmark.circle` | Save token | `checkmark.circle.fill` — **UNRESOLVED** |
| `sync-status-line.component.tsx:30` | `checkmark.circle` | success | `checkmark.circle.fill` — **UNRESOLVED** |
| `sync-status-line.component.tsx:45` | `xmark.circle` | error | `exclamationmark.circle.fill` — **UNRESOLVED** |

### 3.7 Calendar / date / time

| File:line | Current | Purpose | Proposed candidate |
|---|---|---|---|
| `calendar-header.component.tsx:51` | `chevron.left.2` | prev year | `chevron.backward.2` — **UNRESOLVED** |
| `calendar-header.component.tsx:60` | `chevron.left` | prev month | `chevron.backward` — **UNRESOLVED** |
| `calendar-header.component.tsx:75` | `chevron.right` | next month | `chevron.forward` — **UNRESOLVED** |
| `calendar-header.component.tsx:84` | `chevron.right.2` | next year | `chevron.forward.2` — **UNRESOLVED** |
| `date-field.component.tsx:92` | `calendar` | date trigger | `calendar.circle` — **UNRESOLVED** |
| `date-range-field.component.tsx:215` | `calendar` | date-range trigger | `calendar.circle` — **UNRESOLVED** |
| `time-field.component.tsx:69` | `clock` | time trigger | `clock.circle` — **UNRESOLVED** |

### 3.8 Other literals

| File:line | Current | Purpose | Proposed candidate |
|---|---|---|---|
| `selectable-row.component.tsx:45` | `checkmark` | selected marker | `checkmark.circle.fill` — **UNRESOLVED** |
| `holding-select-field.component.tsx:115` | `checkmark` | selected marker | `checkmark.circle.fill` — **UNRESOLVED** |
| `edit-header-button.component.tsx:25` | `pencil` | Edit nav button | `square.and.pencil` — **UNRESOLVED** |
| `card-context-menu.component.tsx:168` | `doc.on.doc` | Duplicate | `plus.square.on.square` — **UNRESOLVED** |
| `card-context-menu.component.tsx:175` | `trash` | Delete | `trash.fill` — **UNRESOLVED** |
| `transaction-form.screen.tsx:992` | `trash` | remove return row | `trash.fill` — **UNRESOLVED** |
| `transaction-form.screen.tsx:1005` | `plus` | add return row | `plus.circle.fill` — **UNRESOLVED** |
| `transaction-form.screen.tsx:1088` | `arrow.left.arrow.right` | convert to exchange | `arrow.left.arrow.right` (aligns with `transaction.exchange`, but this is an ACTION not the type glyph) — **UNRESOLVED** |
| `transaction-form.screen.tsx:1101` | `trash` | delete tx | `trash.fill` — **UNRESOLVED** |
| `holding-form.screen.tsx:614` | `trash` | remove contribution | `trash.fill` — **UNRESOLVED** |
| `holding-form.screen.tsx:632` | `plus` | add contribution | `plus.circle.fill` — **UNRESOLVED** |
| `add-transaction-fab.component.tsx:34` | `plus` | global FAB | `plus` (FAB weight — confirm) — **UNRESOLVED** |
| `filter-menu.component.tsx:60` | `line.3.horizontal.decrease.circle` | Home filter trigger | `line.3.horizontal.decrease.circle.fill` — **UNRESOLVED** |
| `trend-filter-field.component.tsx:200` | `line.3.horizontal.decrease.circle` | filter trigger | `line.3.horizontal.decrease.circle.fill` — **UNRESOLVED** |

### 3.9 Dynamic pass-throughs (NOT gaps, NOT covered — no literal to change)

These render whatever data/map supplies and change automatically when their source (entity-symbols map, `category.icon`, or a chosen icon) changes: `accounts.screen.tsx:170`, `holding-card.component.tsx:98`, `account-detail.screen.tsx:83`, `account-form.screen.tsx:395`, `holding-form.screen.tsx:545`, `holding-form.screen.tsx:517`, `entity-header-icon.component.tsx:23-24`, `entity-icon-tile.component.tsx:104`, `icon-editor.component.tsx:67`, `holding-select-field.component.tsx:99/101`, `field-trigger.component.tsx:52`, `settings-row.component.tsx:21`, `trend-filter-field.component.tsx:86`, and the shared `button.component.tsx:82,88` render path. No action beyond changing their upstream sources.

---

## 4. Infrastructure work list (non-icon-string code changes)

| # | Change | Files | Why |
|---|---|---|---|
| I1 | Add `fallbackName?: string` to `SymbolProps` and a fallback mechanism in `SymbolIcon` (since `SFSymbolView` renders `systemName` only, the component must detect an unavailable primary symbol — or unconditionally render the fallback on the iOS floor — and substitute `fallbackName`). Needed by `entity.holding` (`text.pad.header`→`list.bullet.rectangle`) and `transaction.split` (`arrow.trianglehead.branch`→`arrow.branch`). | `symbol.props.d.ts`, `symbol.component.tsx` (+ colocated test) | Two mapping items use iOS-26-only symbols; app floor is iOS 16. |
| I2 | Add an optional leading-icon slot to the shared `TextField` (a new prop, e.g. `leadingIcon?: string`, rendered before the input via `SymbolIcon`). Wire the sole consumer: `currency-field.component.tsx:161` search box → `magnifyingglass`. | `text-field.props.d.ts`, `text-field.component.tsx` (+ test), `currency-field.component.tsx:161` | "search inputs → magnifyingglass". Only one consumer exists today. |
| I3 | Pass an `icons` map to the transaction-type `ChipRow` at `transaction-form.screen.tsx:1936` (income/expense/exchange/split). No ChipRow change — `icons` prop already exists (`chip-row.props.d.ts:19`). | `transaction-form.screen.tsx:1936` | Net-new type-chip glyphs. |
| I4 | Pass the OptionPills `icon` render-prop for trend-filter Mode (Top→`chart.bar.fill`, Manual→`tag`). No OptionPills change — render-prop already exists. | `trend-filter-field.component.tsx:233-267` | Net-new pill glyphs. |
| I5 | Add generic entity symbols for `holding` (`text.pad.header`) and `transaction` (`arrow.up.arrow.down`) to `entity-symbols.ts` (or a sibling generic map). No consumer today — ships as scaffolding; wire when a generic empty-state/section-label reference is introduced. | `entity-symbols.ts` | `entity.holding`/`entity.transaction` have no existing call site. |

Note: I1 blocks any use of `text.pad.header` / `arrow.trianglehead.branch` — sequence it FIRST among infra items.

---

## 5. Sequencing note — implementation is BLOCKED

A parallel worktree (`next-bank-connect`, currently at `8750361`) is actively editing files this rework also touches. **Do NOT start implementation until that branch lands and is integrated onto `next`.** Starting now guarantees merge conflicts on hot files.

Shared files and the inventory rows sitting in them:

| Shared file (edited by `next-bank-connect`) | Inventory rows in it |
|---|---|
| `account-form.screen.tsx` | `:53` `FALLBACK_ICON` (§2.1 → `tray`), `:395` ChipRow `icons=accountKindSymbol` (dynamic, §3.9) |
| `account-detail.screen.tsx` | `:59` Connect→`lock`, `:64` Sync (gap §3.6), `:83` identity fallback (dynamic §3.9), `:267` last-synced (gap §3.6), `:307` Disconnect→`lock.open` |
| `transaction-form.screen.tsx` | `:1936` type chip icons (I3/§2.3), `:992` remove-return (gap), `:1005` add-return (gap), `:1088` convert-to-exchange (gap), `:1101` delete-tx (gap) |
| `text-field.component.tsx` | Infra I2 (new leading-icon slot) |

**Order once unblocked:** (1) rebase this worktree onto integrated `next`; (2) infra I1 → I2 → I3/I4/I5; (3) central maps (`entity-symbols.ts` account-type set, resolved holding-type gaps, DB category seeds + migration); (4) the resolved per-call-site literals, grouped by area, one area per task; (5) `npm run check:all` at each task checkpoint, `npm run check:deep` before done. Every **UNRESOLVED** candidate in §3 must be resolved by a human before its row is coded — an unresolved row is NOT ready to implement.

---

## 6. Self-review

- **Coverage:** Every inventory row in §1 is classified — §2 (covered/net-new/decided type-defaults), §3.0 (PENDING-COLLECTION: Kiko Entity / Kiko Categories), §3.4+ (normal gap), or §3.9 (dynamic pass-through). No row is left as keep-the-old-icon.
- **Governing rule:** No normal-gap row proposes the old icon; each is marked UNRESOLVED. The two collection areas carry no invented candidates (§3.0) — their standard-SF-Symbol names arrive from the coordinator once the not-yet-exported Kiko Entity / Kiko Categories collection files (named from the user's export filenames) land. The entity type-defaults are DECIDED in §2.4 (unchanged except jar→`rectangle.portrait` and both crypto defaults→`bitcoinsign.circle`).
- **iOS floor:** Both iOS-26 symbols routed through I1 `fallbackName`.
- **Tensions flagged:** Settings-tab vs "settings navigation→gear" (§2.2/§3.4); `add-category-row` default vs "categories→tag" (§3.5); `link.badge.plus` pre-existing mismatch (§2.2).
