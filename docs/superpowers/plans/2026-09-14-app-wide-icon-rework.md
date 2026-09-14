# App-Wide SF Symbol Icon Rework Implementation Plan

**Status: COMPLETE — ready to implement once `next-bank-connect` lands.** Every icon mapping is DECIDED, every gap is RESOLVED, and no AWAITING/UNRESOLVED marker remains. The only remaining precondition is the shared-file sequencing block (§5) — the parallel `next-bank-connect` worktree must integrate onto `next` first.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan is a MAPPING REFERENCE + infrastructure spec — implementation is BLOCKED only by the Sequencing section (§5). Do NOT begin coding until the shared-file worktree lands; every icon decision itself is final.**

**Goal:** Replace every SF Symbol icon literal in the app with an intended NEW icon, driven by a finalized known mapping, and report every call site the mapping does not cover as an explicit GAP with an UNRESOLVED candidate.

**Architecture:** Icon strings live in three places — a small number of central maps (`entity-symbols.ts`, DB category seeds), a large user-selectable library (`icon-picker-modal` CURATED_ICONS), and per-call-site literals scattered across screens/components. The rework touches central maps once, adds three small infrastructure seams (SymbolIcon `fallbackName`, a TextField leading-icon slot, a transaction-type ChipRow `icons` map), and rewrites each literal. Three mapping entries use known iOS-26-only symbols and therefore REQUIRE the new fallback seam; other pool symbols may also exceed iOS 16 and need verification (§3.0.5). The three user-exported SF Symbols collections (Kiko Entities 62, Kiko Categories 73, Kiko UI 39) resolve the two picker pools and the small-UI gaps (§3.0).

**Tech Stack:** React Native, `react-native-nitro-sfsymbols` (`SFSymbolView`, renders `systemName` only), `react-native-unistyles`, Biome/jscpd/Knip/Semgrep quality harness.

**Spec:** This document is self-contained (the governing rule + finalized mapping were handed to the planner directly). No separate spec file.

## Global Constraints

- **Governing rule:** Do NOT keep ANY old icon by default. Every call site MUST map to an intended NEW icon. Anything not covered by the Known Mapping is a GAP — it gets a PROPOSED candidate marked **UNRESOLVED**, never the old icon.
- **Minimum iOS 16.** The three known iOS-26-only symbols (`text.pad.header`, `arrow.trianglehead.branch`, `arrow.trianglehead.2.clockwise.rotate.90`) MUST render through a `fallbackName` (`list.bullet.rectangle` / `arrow.branch` / `arrow.triangle.2.circlepath`). `SFSymbolView` renders `systemName` only and has no built-in fallback. Additional pool symbols may also be >iOS 16 but are UNVERIFIED (§3.0.5).
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

All render sites are dynamic via `category.icon`. The ONLY category default that changes is Health (`cross.case`→`cross`, §3.0.4); it changes the seed AND ships as a guarded migration that updates existing untouched-default rows — see §4.1 M1. The other 9 category defaults are unchanged.

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
| settings navigation | `gear` | `root.navigator.tsx:82` (Settings tab) | **DECIDED** per the user's rule "gear = settings navigation option": the Settings TAB → `gear`; the System row stays `gearshape` (next row). Tab bar uses filled variants elsewhere; `gear` has no `.fill` — executor confirms on-device weight. |
| system settings | `gearshape` | `settings.screen.tsx:53` (System row) | Stays `gearshape`. |
| connect a syncable account | `lock` | `account-detail.screen.tsx:59` (Monobank Connect), `wallet-address-field.component.tsx:96` (Connect Wallet), `binance-credentials-field.component.tsx:150` (Connect Binance) | All current `link` connect buttons. |
| disconnect | `lock.open` | `account-detail.screen.tsx:307`, `crypto-sync-section.component.tsx:123` | Both currently `link.badge.plus`. **`lock.open` REPLACES the pre-existing `link.badge.plus` "add link" mismatch** — no separate action; the swap fixes the wrong glyph as part of this rework. Executor should expect the odd source glyph. |
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

Three type-default changes total: `bank`/`cash`/`card`/`term_deposit`/`bond`/(holding)`cash` stay unchanged; `jar` → `rectangle.portrait`; both crypto defaults (`crypto`, `crypto_asset`) → `bitcoinsign.circle`. **Migration split (verified — see §4.1):** only the crypto ACCOUNT default (`accountKindSymbol.crypto`) needs a data migration (M2), because the account form persists the kind default at create time. The `jar` and `crypto_asset` HOLDING defaults are pure render-time fallbacks (holdings persist a null icon until the user picks one), so the code-constant change here updates every un-customized holding with NO migration.

---

## 3. GAPS (every call site NOT covered by §2)

**Rule reminder (methodology):** each NORMAL-gap row originally got a PROPOSED candidate marked **UNRESOLVED**, never an auto-kept old icon — a human had to resolve each before implementation. **That process is now COMPLETE:** every gap below is RESOLVED (a user-finalized decision, including deliberate KEEPs where the user re-affirmed the current glyph). No row remains UNRESOLVED.

**Two icon COLLECTIONS resolved two whole gap areas — RESOLVED (§3.0), no UNRESOLVED candidates needed for them.** Each is a COLLECTION OF STANDARD SF SYMBOLS (not custom-drawn glyphs), exported from the SF Symbols app library as a JSON `symbols` array. Both files have now been read directly and their full symbol lists are embedded below (§3.0). Every OTHER uncovered icon is now RESOLVED (§3.4 onward) — the user supplied final replacements for the last open sites. Inside the resolved area, the seeded-category default mapping is now FULLY DECIDED (all 10 decided — §3.0.4; only Health changes) and iOS-availability verification stays open (§3.0.5) as the sole remaining ops/user verification task.

### 3.0 RESOLVED — the icon-picker pools + the UI-chrome pool (was PENDING-COLLECTION)

**RESOLVED.** Three SF Symbols app library collection files were exported by the user and read directly (each file is a JSON object with a `symbols` array). They resolve the two picker-pool gap areas AND the 46 small-UI gaps (§3.4–§3.8); the handful of sites the collections did not cover have since been resolved by explicit user replacements (§3.6/§3.8/§3.0.4 — all KEEP the current glyph except Health). The old "shared pool" design question is DECIDED: the single shared 138-entry `CURATED_ICONS` pool is **REPLACED by TWO distinct picker pools**, and the scattered UI literals draw from a third **UI-chrome** pool.

- **Kiko Entities — 62 symbols.** The account/holding icon-PICKER pool, consumed by the IconEditor (`icon-editor.component.tsx:67`, opened from the account form and the holding form). Does NOT include the per-KIND type-defaults — those stay DECIDED in §2.4.
- **Kiko Categories — 73 symbols.** The category-picker pool (`icon-picker-modal.component.tsx:32-181`), REPLACING the old shared 138-entry `CURATED_ICONS` pool in its entirety.
- **Kiko UI — 39 entries (31 standard symbols + 8 `custom:UUID`).** The small UI/chrome pool the 46 §3 gap sites draw from. The 8 `custom:UUID` entries are NOT custom-rendered glyphs — each re-confirms a glyph ALREADY decided in §2 (see §3.0.3). So the effective NEW-symbol pool for the UI gaps is the **31 standard** Kiko UI symbols.

> **Source:** the two collections named "Kiko" (older 145-symbol draft) and any other collection are IGNORED. Only Kiko Entities, Kiko Categories, and Kiko UI govern this rework. The collection JSON carries NO iOS-availability metadata (§3.0.5).

Inside this resolved area: the per-default seeded-category mapping is FULLY DECIDED (§3.0.4 — all 10 decided; only Health changes, cross.case→cross), and iOS-availability verification stays OPEN (§3.0.5, needs ops/user verification) as the only remaining non-blocking verification.

#### 3.0.1 Kiko Entities pool (62) — account/holding IconEditor

The pool a user picks from for a SPECIFIC account or holding via the IconEditor (`icon-editor.component.tsx:67`). REPLACES the entity half of the old shared `CURATED_ICONS`.

```
archivebox                australiandollarsign      australsign
bahtsign                  banknote                  bitcoinsign
bitcoinsign.circle        brazilianrealsign         building
calendar                  cedisign                  centsign
chineseyuanrenminbisign   coloncurrencysign         creditcard
cruzeirosign              danishkronesign           document
dollarsign                dollarsign.circle         dongsign
envelope.front            eurosign                  eurosign.circle
eurozonesign              externaldrive             florinsign
folder                    francsign                 giftcard
guaranisign               hockey.puck               hryvniasign
hryvniasign.circle        indianrupeesign           kipsign
larisign                  lirasign                  malaysianringgitsign
manatsign                 millsign                  nairasign
norwegiankronesign        peruviansolessign         pesetasign
pesosign                  polishzlotysign           receipt
rectangle.portrait        rupeesign                 shekelsign
singaporedollarsign       sterlingsign              swedishkronasign
tengesign                 tray                      tugriksign
turkishlirasign           wallet.bifold             wallet.pass
wonsign                   yensign
```

#### 3.0.2 Kiko Categories pool (73) — category picker

The category-picker pool (`icon-picker-modal.component.tsx:32-181`), REPLACING the whole 138-entry `CURATED_ICONS`. Note: this is a pool of OPTIONS — the per-default seeded-category assignments are a SEPARATE decision (§3.0.4).

```
airplane                              antenna.radiowaves.left.and.right
bag                                   banknote
basket                                bed.double
bicycle                               bird
book                                  brain
briefcase                             building
bus                                   calendar.and.person
camera                                car
cart                                  cat
creditcard                            cross
cup.and.heat.waves                    cup.and.saucer
display                               dog
dumbbell                              fish
flask                                 fork.knife
fuelpump                              gamecontroller
gift                                  guitars
hammer                                handbag
hare                                  headphones
heart                                 hifispeaker
house                                 key.horizontal
laptopcomputer                        lock
lungs                                 mouth
movieclapper                          mustache
nosign                                paintbrush.pointed
paintpalette                          parkingsign
party.popper                          pawprint
phone                                 pianokeys
pizza.slice                           popcorn
repeat                                shippingbox
shoe                                  smartphone
staroflife                            stethoscope
stroller                              teddybear
tent                                  theatermasks
ticket                                tram
tshirt                                wallet.pass
wheelchair                            wineglass
xmark.triangle.circle.square
```

#### 3.0.3 Kiko UI pool (39 = 31 standard + 8 custom) — small UI/chrome gaps

The pool the 46 §3 gap sites draw from. The **31 standard** symbols below are the effective UI-gap candidate set (mapped per-site in §3.4–§3.8):

```
arrow.down.to.line                        arrow.up.to.line
arrow.trianglehead.2.clockwise.rotate.90  banknote
building.classical.columns.fill           calendar
chart.bar.fill                            chart.xyaxis.line
checkmark                                  chevron.left
chevron.left.2                            chevron.right
chevron.right.2                           clock
document.on.clipboard                     faceid
gear                                      gearshape
globe                                     house.fill
hryvniasign.circle                        lock
lock.open                                 magnifyingglass
pencil                                    plus
square.grid.2x2                           star
star.fill                                 tag
trash
```

The **8 `custom:UUID`** entries are NOT to be custom-rendered — each is exactly one of the entity/transaction glyphs ALREADY decided in §2, so they re-confirm the mapping rather than add unknowns (do not double-count them, do not treat them as unresolved). Their decided STANDARD symbols:

| Kiko UI custom entry stands for | Decided STANDARD symbol | Source |
|---|---|---|
| `entity.account` | `tray` | §2.1 |
| `entity.holding` | `text.pad.header` (fallbackName `list.bullet.rectangle`) | §2.1 (iOS-26) |
| `entity.transaction` | `arrow.up.arrow.down` | §2.1 |
| `entity.type.crypto` (account + holding crypto defaults) | `bitcoinsign.circle` | §2.4 |
| `transaction.exchange` | `arrow.left.arrow.right` | §2.1 |
| `transaction.expense` | `arrow.up` | §2.1 |
| `transaction.income` | `arrow.down` | §2.1 |
| `transaction.split` | `arrow.trianglehead.branch` (fallbackName `arrow.branch`) | §2.1 (iOS-26) |

#### 3.0.4 SUB-GAP (FULLY DECIDED) — seeded-category DEFAULT mapping

The Kiko Categories pool (§3.0.2) is a set of picker OPTIONS, NOT per-category default assignments. The 10 seeded category defaults live in `src/db/__fixtures__/seeded-categories.ts` (`SEEDED_CATEGORIES`), cross-checked against `drizzle/migrations/0002_seed_categories.sql` (seeds `transport` as `car`) and `0017_default_category_colors.sql` (refines `transport` `car`→`bus`). State per row (user-finalized): **9 DECIDED-KEEP** (the current glyph stays) and **1 DECIDED-CHANGE** (`health` `cross.case`→`cross`). The three previously-open rows are now settled: Utilities KEEPS `bolt`, Transfers KEEPS `arrow.left.arrow.right`, and Health CHANGES to `cross` (the only seeded-default change in the whole rework). "In pool?" is informational only — a KEEP does not require the glyph to be in the Kiko Categories picker pool (the pool governs USER-selectable options, not the seeded default a row ships with).

| Category | Current icon | In pool? | Decision | Note |
|---|---|---|---|---|
| Groceries | `cart` | yes | **DECIDED → `cart`** | keep — in pool |
| Dining | `fork.knife` | yes | **DECIDED → `fork.knife`** | keep — in pool |
| Transport | `bus` | yes | **DECIDED → `bus`** | keep — in pool |
| Shopping | `bag` | yes | **DECIDED → `bag`** | keep — in pool |
| Utilities | `bolt` | no | **DECIDED → `bolt` (stays)** | user-finalized KEEP; out-of-pool is fine for a seeded default. Earlier `house` candidate DROPPED. NO migration. |
| Entertainment | `gamecontroller` | yes | **DECIDED → `gamecontroller`** | keep — in pool |
| Health | `cross.case` | no | **DECIDED → `cross` (CHANGE)** | user-finalized change. `cross` IS in the Kiko Categories pool (§3.0.2). **Needs a guarded data migration** (see "Data migrations required" below) — categories are seeded as DB rows. |
| Cash | `banknote` | yes | **DECIDED → `banknote`** | keep — in pool |
| Transfers | `arrow.left.arrow.right` | no | **DECIDED → `arrow.left.arrow.right` (stays)** | user-finalized KEEP; out-of-pool is fine for a seeded default. Earlier `repeat` candidate DROPPED. NO migration. |
| Other | `square.grid.2x2` | no | **DECIDED → `square.grid.2x2` (stays)** | `other` keeps `square.grid.2x2` (out-of-pool, per §2.2), NO data migration. The pool's `xmark.triangle.circle.square` alternative is DROPPED. |

Only Health changes, and it needs a guarded data migration (`WHERE key = 'health' AND icon = 'cross.case'`, same shape as `0017`) to update existing untouched-default rows — see "Data migrations required" below. The other 9 rows are unchanged and need NO migration.

#### 3.0.5 SUB-GAP (OPEN — NON-BLOCKING ops/user verification) — iOS-availability against SF Symbols app / Apple docs

This is the ONLY open item in the spec, and it does NOT gate any icon DECISION or the COMPLETE status: every icon is chosen; this task only decides whether a chosen symbol ALSO needs a `fallbackName` (via the I1 seam). It is an implementation-time ops/user verification, run alongside coding, not a blocker on the plan.


App min iOS is **16**. `SFSymbolView` renders `systemName` only; a symbol whose minimum iOS is above 16 renders BLANK on an older device and MUST route through the I1 `fallbackName` seam (§4). **The collection JSON carries NO availability metadata**, and this session has no reliable Apple-docs source to confirm exact minimums — so the lists below are NOT asserted as safe. Ops/user MUST verify each flagged symbol in the SF Symbols app (which shows the introduced-in version per symbol) or Apple's SF Symbols docs before shipping, and add a `fallbackName` for any that is >iOS 16.

**Known iOS-26 (SF Symbols 7) — REQUIRES `fallbackName` (already routed through I1):**

| Symbol | Where | fallbackName candidate |
|---|---|---|
| `arrow.trianglehead.2.clockwise.rotate.90` | Kiko UI — sync-now (§3.6: `account-detail.screen.tsx:64`, `crypto-sync-section.component.tsx:113`); REPLACES current `arrow.triangle.2.circlepath` | `arrow.triangle.2.circlepath` |
| `text.pad.header` | §2.1 `entity.holding` (via Kiko UI custom re-confirm) | `list.bullet.rectangle` |
| `arrow.trianglehead.branch` | §2.1 `transaction.split` (via Kiko UI custom re-confirm) | `arrow.branch` |

**Suspected newer than iOS 16 — VERIFY version, add fallback if >16 (best-effort, NOT confirmed):**

- Kiko Entities: `document` (suspected iOS 18 / new-style name), `wallet.bifold` (suspected iOS 18), `envelope.front` (suspected iOS 18), `hockey.puck`, plus most of the LESS-COMMON currency signs (`australiandollarsign`, `australsign`, `bahtsign`, `brazilianrealsign`, `cedisign`, `chineseyuanrenminbisign`, `coloncurrencysign`, `cruzeirosign`, `danishkronesign`, `dongsign`, `eurozonesign`, `guaranisign`, `kipsign`, `larisign`, `malaysianringgitsign`, `manatsign`, `millsign`, `nairasign`, `norwegiankronesign`, `peruviansolessign`, `polishzlotysign`, `singaporedollarsign`, `swedishkronasign`, `tengesign`, `tugriksign`, `turkishlirasign`) — many of these currency marks were added across SF Symbols 5 (iOS 17) / 6 (iOS 18) and CANNOT be assumed iOS-16-safe.
- Kiko Categories: `cup.and.heat.waves` (suspected iOS 17), `key.horizontal` (suspected iOS 18), `movieclapper` (suspected iOS 17), `basket` (suspected iOS 17), `cat` / `dog` (suspected iOS 17), `mouth`, `mustache`, `calendar.and.person`, `brain`, `lungs`, `pizza.slice`, `cup.and.saucer`.

**Could NOT confirm either way (no reliable source this session — verify before relying on iOS-16 safety):** every remaining symbol in all three pools, including the classic finance glyphs (`dollarsign`, `eurosign`, `sterlingsign`, `yensign`, `centsign`, `banknote`, `creditcard`, `bitcoinsign`, `hryvniasign`) that are very likely iOS-16-safe but are NOT machine-verified here. Treat the two lists above as the priority set to check first; confirm the rest opportunistically.

No symbol in any of the three pools was found to be a "2026-release"-named glyph BEYOND the three iOS-26 trianglehead/pad symbols already listed — but that is a name-pattern observation, not an availability guarantee.

### 3.4 Tab bar — `root.navigator.tsx`

Candidates now drawn from the **Kiko UI** pool (§3.0.3). Every row is either DECIDED or a pool-confirmed unchanged glyph — none is open.

| Line | Current | Tab | Kiko UI candidate |
|---|---|---|---|
| :61 | `house.fill` | Home | `house.fill` — Kiko UI (unchanged glyph, now pool-confirmed) |
| :68 | `wallet.pass.fill` | Accounts | **DECIDED → `tray`** — the decided standard for `entity.account` (§2.1). REPLACES the earlier `building.classical.columns.fill` candidate. |
| :76 | `chart.xyaxis.line` | Statistics | `chart.xyaxis.line` — Kiko UI (unchanged glyph, pool-confirmed; alt in pool: `chart.bar.fill`) |
| :82 | `gearshape.fill` | Settings | **COVERED** in §2.2 (→ `gear`, also in Kiko UI). Listed for completeness. |

### 3.5 Settings + categories screens

| File:line | Current | Purpose | Kiko UI candidate |
|---|---|---|---|
| `settings-row.component.tsx:36` | `chevron.right` | disclosure chevron | `chevron.right` — Kiko UI (unchanged glyph, pool-confirmed) |
| `add-category-row.component.tsx:19` | `square.grid.2x2` | new-category `DEFAULT_ICON` | **DECIDED → `tag`** — Kiko UI member. The earlier `tag` vs `square.grid.2x2` tension is RESOLVED: the new-category default is `tag`. (`other` built-in default separately stays `square.grid.2x2` — see §3.0.4.) |
| `add-category-row.component.tsx:94` | `plus` | Add category | `plus` — Kiko UI (unchanged glyph, pool-confirmed) |
| `categories.screen.tsx:208` | `star.fill` | default marker | `star.fill` — Kiko UI (unchanged glyph, pool-confirmed) |
| `categories.screen.tsx:219` | `star` | set-as-default | `star` — Kiko UI (unchanged glyph, pool-confirmed) |
| `categories.screen.tsx:258` | `trash` | delete | `trash` — Kiko UI (unchanged glyph, pool-confirmed) |
| `categories.screen.tsx:282` | `arrow.up.to.line` | move top | `arrow.up.to.line` — Kiko UI (unchanged glyph, pool-confirmed) |
| `categories.screen.tsx:292` | `arrow.down.to.line` | move bottom | `arrow.down.to.line` — Kiko UI (unchanged glyph, pool-confirmed) |
| `system.screen.tsx:47` | `globe` | Language row | `globe` — Kiko UI (unchanged glyph, pool-confirmed) |
| `app-lock-setting.component.tsx:60` | `faceid` | App Lock row | `faceid` — Kiko UI (unchanged glyph, pool-confirmed; alt in pool: `lock`) |
| `lock-gate.component.tsx:92` | `faceid` | cold-launch lock glyph | `faceid` — Kiko UI (unchanged glyph, pool-confirmed; alt in pool: `lock`) |

### 3.6 Account detail / crypto sync

| File:line | Current | Purpose | Kiko UI candidate |
|---|---|---|---|
| `account-detail.screen.tsx:64` | `arrow.triangle.2.circlepath` | Sync now | `arrow.trianglehead.2.clockwise.rotate.90` — Kiko UI candidate; **iOS-26 symbol → REQUIRES `fallbackName` `arrow.triangle.2.circlepath`** (§3.0.5 / I1) |
| `account-detail.screen.tsx:267` | `clock` | last synced | `clock` — Kiko UI (unchanged glyph, pool-confirmed) |
| `crypto-sync-section.component.tsx:92` | `clock` | last synced | `clock` — Kiko UI (unchanged glyph, pool-confirmed) |
| `crypto-sync-section.component.tsx:113` | `arrow.triangle.2.circlepath` | Sync now | `arrow.trianglehead.2.clockwise.rotate.90` — Kiko UI candidate; **iOS-26 → REQUIRES `fallbackName` `arrow.triangle.2.circlepath`** (§3.0.5 / I1) |
| `wallet-address-field.component.tsx:85` | `doc.on.clipboard` | paste | **DECIDED → `document.on.clipboard`** (Kiko UI pool spelling) |
| `binance-credentials-field.component.tsx:116` | `doc.on.clipboard` | paste key | **DECIDED → `document.on.clipboard`** (Kiko UI pool spelling) |
| `binance-credentials-field.component.tsx:139` | `doc.on.clipboard` | paste secret | **DECIDED → `document.on.clipboard`** (Kiko UI pool spelling) |
| `monobank-token-input.component.tsx:65` | `doc.on.clipboard` | paste token | **DECIDED → `document.on.clipboard`** (Kiko UI pool spelling) |
| `monobank-token-field.component.tsx:123` | `checkmark.circle` | Save token | **RESOLVED → `checkmark.circle` (KEEP, no change)** — user-finalized. Same glyph as the sync-success marker below (both are "success" affordances). No edit at this site. |
| `sync-status-line.component.tsx:30` | `checkmark.circle` | success | **RESOLVED → `checkmark.circle` (KEEP, no change)** — user-finalized. No edit at this site. |
| `sync-status-line.component.tsx:45` | `xmark.circle` | error | **RESOLVED → `xmark.circle` (KEEP, no change)** — user-finalized. No edit at this site. |

### 3.7 Calendar / date / time

| File:line | Current | Purpose | Kiko UI candidate |
|---|---|---|---|
| `calendar-header.component.tsx:51` | `chevron.left.2` | prev year | `chevron.left.2` — Kiko UI (unchanged glyph, pool-confirmed) |
| `calendar-header.component.tsx:60` | `chevron.left` | prev month | `chevron.left` — Kiko UI (unchanged glyph, pool-confirmed) |
| `calendar-header.component.tsx:75` | `chevron.right` | next month | `chevron.right` — Kiko UI (unchanged glyph, pool-confirmed) |
| `calendar-header.component.tsx:84` | `chevron.right.2` | next year | `chevron.right.2` — Kiko UI (unchanged glyph, pool-confirmed) |
| `date-field.component.tsx:92` | `calendar` | date trigger | `calendar` — Kiko UI (unchanged glyph, pool-confirmed) |
| `date-range-field.component.tsx:215` | `calendar` | date-range trigger | `calendar` — Kiko UI (unchanged glyph, pool-confirmed) |
| `time-field.component.tsx:69` | `clock` | time trigger | `clock` — Kiko UI (unchanged glyph, pool-confirmed) |

### 3.8 Other literals

| File:line | Current | Purpose | Kiko UI candidate |
|---|---|---|---|
| `selectable-row.component.tsx:45` | `checkmark` | selected marker | `checkmark` — Kiko UI (unchanged glyph, pool-confirmed) |
| `holding-select-field.component.tsx:115` | `checkmark` | selected marker | `checkmark` — Kiko UI (unchanged glyph, pool-confirmed) |
| `edit-header-button.component.tsx:25` | `pencil` | Edit nav button | `pencil` — Kiko UI (unchanged glyph, pool-confirmed) |
| `card-context-menu.component.tsx:168` | `doc.on.doc` | Duplicate | **RESOLVED → `doc.on.doc` (KEEP, no change)** — user-finalized. No edit at this site. |
| `card-context-menu.component.tsx:175` | `trash` | Delete | `trash` — Kiko UI (unchanged glyph, pool-confirmed) |
| `transaction-form.screen.tsx:992` | `trash` | remove return row | `trash` — Kiko UI (unchanged glyph, pool-confirmed) |
| `transaction-form.screen.tsx:1005` | `plus` | add return row | `plus` — Kiko UI (unchanged glyph, pool-confirmed) |
| `transaction-form.screen.tsx:1088` | `arrow.left.arrow.right` | convert to exchange | **RESOLVED → `arrow.left.arrow.right` (KEEP)** — user-finalized as an INTENTIONAL reuse of the Exchange TYPE glyph (`transaction.exchange`→`arrow.left.arrow.right`, §2.1). This is BY DESIGN, not a collision: the "convert to exchange" action deliberately shares the Exchange type's glyph so the action reads as "make this an exchange". No distinct glyph is wanted; no edit at this site. |
| `transaction-form.screen.tsx:1101` | `trash` | delete tx | `trash` — Kiko UI (unchanged glyph, pool-confirmed) |
| `holding-form.screen.tsx:614` | `trash` | remove contribution | `trash` — Kiko UI (unchanged glyph, pool-confirmed) |
| `holding-form.screen.tsx:632` | `plus` | add contribution | `plus` — Kiko UI (unchanged glyph, pool-confirmed) |
| `add-transaction-fab.component.tsx:34` | `plus` | global FAB | `plus` — Kiko UI (unchanged glyph, pool-confirmed; confirm FAB weight on-device) |
| `filter-menu.component.tsx:60` | `line.3.horizontal.decrease.circle` | filter trigger (shared FilterMenu) | **RESOLVED → prop-driven `triggerIcon`.** `FilterMenu` is a SHARED component with 4 render sites; do NOT hardcode any icon inside it. Add a `triggerIcon?` prop and pass a value from every site: account filters → `tray`, category filters → `tag` (see §3.8.1). The old default glyph has no remaining consumer among the 4 (see the default note in §3.8.1). Infra item I6 (§4). |
| `trend-filter-field.component.tsx:200` | `line.3.horizontal.decrease.circle` | trend filter trigger | **RESOLVED → dynamic per APPLIED mode** — user-finalized. The trigger icon reflects the applied `filter.mode`: `chart.bar.fill` when Top mode is applied, `tag` (the categories glyph) when Manual mode. A small inline conditional at line 200 keyed on the existing `filter.mode` prop (the same `filter.mode` the `buttonLabel` IIFE already reads at :143–154). Infra item I7 (§4). |

### 3.8.1 FilterMenu render sites (for the I6 prop change)

`FilterMenu` (`src/screens/home/filter-menu/filter-menu.component.tsx`) is a SHARED, generic component — its props are `label` / `options` / `selected` / `onToggle` / `testID` (`filter-menu.props.d.ts:19`), none icon-specific, and its trigger glyph is hardcoded at `:60`. Grepping the tree for every render site (`<FilterMenu`) finds **4 usages across 2 files**:

| # | Render site | testID | Filters | Gets `triggerIcon`? |
|---|---|---|---|---|
| 1 | `transaction-filter-bar.component.tsx:47` (Home, via `TransactionFilterBar` at `home.screen.tsx:455`) | `account-filter-menu` | account NAMES (`home.filterAccounts`) | **`tray`** (accounts filter) |
| 2 | `transaction-filter-bar.component.tsx:55` (Home) | `category-filter-menu` | categories (`home.filterCategories`) | **`tag`** (category filter) |
| 3 | `statistics.screen.tsx:758` | `statistics-account-filter` | account NAMES (`statistics.filterAccounts`) | **`tray`** (accounts filter) |
| 4 | `statistics.screen.tsx:818` | `statistics-category-filter` | categories (`statistics.filterCategories`) | **`tag`** (category filter) |

**FINAL per-site assignment (user-decided):** account filters → `tray`, category filters → `tag`. All 4 sites pass an explicit `triggerIcon`; `transaction-filter-bar.component.tsx` (a thin wrapper rendering both Home menus) forwards `tray` to its account `FilterMenu` and `tag` to its category `FilterMenu`. **Default note:** the old glyph `line.3.horizontal.decrease.circle` now has NO consumer among these 4 sites. Executor choice: KEEP it as the `triggerIcon?` prop default (recommended — it stays a safe fallback for any future/other `FilterMenu` caller that does not pass an icon), OR make `triggerIcon` required and drop the default. There is no current caller that relies on the default either way.

### 3.8.2 Kiko UI coverage summary

**DECIDED — all §3.4–§3.8 sites resolved. Highlights:**
- `root.navigator.tsx:68` (Accounts tab) → **`tray`** (§2.1 `entity.account` standard; replaces the earlier `building.classical.columns.fill` candidate).
- `add-category-row.component.tsx:19` (new-category `DEFAULT_ICON`) → **`tag`** (resolves the `tag` vs `square.grid.2x2` tension).
- The 4 paste sites (`wallet-address-field.component.tsx:85`, `binance-credentials-field.component.tsx:116` and `:139`, `monobank-token-input.component.tsx:65`) → **`document.on.clipboard`** (Kiko UI pool spelling).
- `other` built-in category default (§3.0.4) → **`square.grid.2x2`** stays, NO migration.

**User-finalized KEEP (current glyph stays, no edit at the site):**
- `sync-status-line.component.tsx:45` — sync-error → `xmark.circle` (KEEP).
- `sync-status-line.component.tsx:30` and `monobank-token-field.component.tsx:123` — sync-success / Save token → `checkmark.circle` (KEEP; the earlier `→ checkmark` proposal was reverted).
- `card-context-menu.component.tsx:168` — Duplicate → `doc.on.doc` (KEEP).
- `transaction-form.screen.tsx:1088` — convert-to-exchange ACTION → `arrow.left.arrow.right` (KEEP, INTENTIONAL reuse of the Exchange type glyph — by design, §3.8).
- §3.0.4 seeded defaults: Utilities → `bolt` (KEEP), Transfers → `arrow.left.arrow.right` (KEEP).

**User-finalized CHANGE / behavior:**
- Health category default → `cross` (the only seeded-default change; needs a data migration — see "Data migrations required").
- `filter-menu.component.tsx:60` — all 4 FilterMenu triggers via the new I6 prop: account filters → `tray`, category filters → `tag` (§3.8.1).
- `trend-filter-field.component.tsx:200` — trend trigger → dynamic per applied mode (`chart.bar.fill` / `tag`), I7.

**Kiko UI standard symbols NOT consumed by any §3 UI-gap row:** these back the §2.2 finalized swaps or the §2.4 defaults instead, so they are used by the rework overall, just not by a §3.4–§3.8 gap:
- `gear` (§2.2 Settings tab), `gearshape` (§2.2 System row), `magnifyingglass` (§2.2 search / I2), `lock` (§2.2 Connect), `lock.open` (§2.2 Disconnect), `hryvniasign.circle` (§2.2 Base Currency), `chart.bar.fill` (§2.3 trend-filter Top mode), `banknote` (§2.4 cash defaults / Kiko Categories cash), `square.grid.2x2` (§2.2 `other` category).
- `building.classical.columns.fill` is now ORPHANED: it was only the soft Accounts-tab candidate, and the Accounts tab is DECIDED → `tray`. It maps to nothing in this rework — flag for the user in case a different site wants it, otherwise it is simply unused.

Every §3.4–§3.8 site is now DECIDED, a user-finalized KEEP, or a pool-confirmed unchanged glyph. No AWAITING/UNRESOLVED marker remains anywhere in §3.

### 3.9 Dynamic pass-throughs (NOT gaps, NOT covered — no literal to change)

These render whatever data/map supplies and change automatically when their source (entity-symbols map, `category.icon`, or a chosen icon) changes: `accounts.screen.tsx:170`, `holding-card.component.tsx:98`, `account-detail.screen.tsx:83`, `account-form.screen.tsx:395`, `holding-form.screen.tsx:545`, `holding-form.screen.tsx:517`, `entity-header-icon.component.tsx:23-24`, `entity-icon-tile.component.tsx:104`, `icon-editor.component.tsx:67`, `holding-select-field.component.tsx:99/101`, `field-trigger.component.tsx:52`, `settings-row.component.tsx:21`, `trend-filter-field.component.tsx:86`, and the shared `button.component.tsx:82,88` render path. No action beyond changing their upstream sources.

---

## 4. Infrastructure work list (non-icon-string code changes)

| # | Change | Files | Why |
|---|---|---|---|
| I1 | Add `fallbackName?: string` to `SymbolProps` and a fallback mechanism in `SymbolIcon` (since `SFSymbolView` renders `systemName` only, the component must detect an unavailable primary symbol — or unconditionally render the fallback on the iOS floor — and substitute `fallbackName`). Needed by `entity.holding` (`text.pad.header`→`list.bullet.rectangle`), `transaction.split` (`arrow.trianglehead.branch`→`arrow.branch`), and sync-now (`arrow.trianglehead.2.clockwise.rotate.90`→`arrow.triangle.2.circlepath`). | `symbol.props.d.ts`, `symbol.component.tsx` (+ colocated test) | Three known iOS-26 symbols; app floor is iOS 16. Further pool symbols may need `fallbackName` once §3.0.5 verification completes. |
| I2 | Add an optional leading-icon slot to the shared `TextField` (a new prop, e.g. `leadingIcon?: string`, rendered before the input via `SymbolIcon`). Wire the sole consumer: `currency-field.component.tsx:161` search box → `magnifyingglass`. | `text-field.props.d.ts`, `text-field.component.tsx` (+ test), `currency-field.component.tsx:161` | "search inputs → magnifyingglass". Only one consumer exists today. |
| I3 | Pass an `icons` map to the transaction-type `ChipRow` at `transaction-form.screen.tsx:1936` (income/expense/exchange/split). No ChipRow change — `icons` prop already exists (`chip-row.props.d.ts:19`). | `transaction-form.screen.tsx:1936` | Net-new type-chip glyphs. |
| I4 | Pass the OptionPills `icon` render-prop for trend-filter Mode (Top→`chart.bar.fill`, Manual→`tag`). No OptionPills change — render-prop already exists. | `trend-filter-field.component.tsx:233-267` | Net-new pill glyphs. |
| I5 | Add generic entity symbols for `holding` (`text.pad.header`) and `transaction` (`arrow.up.arrow.down`) to `entity-symbols.ts` (or a sibling generic map). No consumer today — ships as scaffolding; wire when a generic empty-state/section-label reference is introduced. | `entity-symbols.ts` | `entity.holding`/`entity.transaction` have no existing call site. |
| I6 | Add an optional `triggerIcon?: string` prop to the shared `FilterMenu`, rendered by the trigger `SymbolIcon` at `filter-menu.component.tsx:60` (`name={triggerIcon}`). Pass a value from ALL 4 render sites: account filters → `tray` (`transaction-filter-bar.component.tsx:47`, `statistics.screen.tsx:758`), category filters → `tag` (`transaction-filter-bar.component.tsx:55`, `statistics.screen.tsx:818`). `TransactionFilterBar` forwards `tray` to its account menu and `tag` to its category menu. The old default glyph `line.3.horizontal.decrease.circle` has no remaining consumer — KEEP it as the prop default for future callers (recommended) or make the prop required (executor choice, §3.8.1). See §3.8.1 for the render-site list. | `filter-menu.props.d.ts`, `filter-menu.component.tsx:60`, `transaction-filter-bar.component.tsx:47`/`:55`, `statistics.screen.tsx:758`/`:818` (+ tests) | Account filters read as accounts → `tray`; category filters read as categories → `tag`. Do NOT hardcode any icon inside the shared component. |
| I7 | Make the trend-filter trigger icon at `trend-filter-field.component.tsx:200` DYNAMIC on the applied `filter.mode`: `name={filter.mode === 'manual' ? 'tag' : 'chart.bar.fill'}`. `filter` is already a prop (`TrendFilterFieldProps.filter: TrendFilter`, with `mode: 'top' | 'manual'`), read at `:143–154` by `buttonLabel` — no new state, no plumbing. | `trend-filter-field.component.tsx:200` (+ test) | The trigger reflects the applied mode: Top→`chart.bar.fill`, Manual→`tag` (categories glyph). |

Note: I1 blocks any use of `text.pad.header` / `arrow.trianglehead.branch` — sequence it FIRST among infra items. I6/I7 are independent of I1 and of each other.

### 4.1 Data migrations required

Only ONE data migration is needed in the entire rework — the Health category default. The jar/crypto entity-default changes (§2.4) split by table: the crypto **account** default persists at create time and needs a migration; the jar and crypto **holding** defaults are pure render-time fallbacks and need NONE. Each migration is hand-authored (data-only, no schema change, no meta snapshot — same shape as `0017_default_category_colors.sql`) and guarded so it only touches rows that still hold the seeded/created default, preserving any icon a user picked themselves.

| # | What changes | Guard (WHERE) | New value | Why a migration IS needed (evidence) |
|---|---|---|---|---|
| M1 | Health category default | `key = 'health' AND icon = 'cross.case'` | `cross` | Categories are SEEDED as DB rows (`0002_seed_categories.sql` inserts `('health', 'Health', 'cross.case')`), so existing installs store `icon = 'cross.case'` in the `categories` table. Changing the seed alone does not touch already-seeded rows. Same class as `0017`'s `transport` `car`→`bus`. |
| M2 | Crypto ACCOUNT default | `kind = 'crypto' AND icon = 'bitcoinsign'` | `bitcoinsign.circle` | The account form PERSISTS the kind-default icon at create time — NOT a render-time fallback. `account-form.screen.tsx:82` seeds `icon` state to `accountKindSymbol[INITIAL_KIND]` (never null on create), `:349` re-sets it to `accountKindSymbol[nextKind]` on kind change, and `:152–153` / `:323–324` persist it via `accountsRepo.setIcon(...)` (`if (icon !== null)`). So an un-customized crypto account stores `icon = 'bitcoinsign'`; changing the code constant alone would leave those rows on the old glyph. |

**NO migration needed (verified pure render-time fallbacks — the code-constant change in §2.4 alone updates every un-customized entity):**
- **Jar holding default** (`holdingTypeSymbol.jar` `archivebox`→`rectangle.portrait`): the holding form starts `icon` state at `null` on create (`holding-form.screen.tsx:213`) and only persists it when non-null (`:496–497` `if (icon !== null) holdingsRepo.setIcon(...)`), so an un-customized jar stores `icon = null`. Every render site resolves `holding.icon ?? holdingTypeSymbol[holding.type]` (`holding-card.component.tsx:98`, `holding-detail.screen.tsx:72`, `transaction-form.screen.tsx:451`), so changing the constant updates them all at render time.
- **Crypto_asset holding default** (`holdingTypeSymbol.crypto_asset` `bitcoinsign`→`bitcoinsign.circle`): identical mechanism — holdings persist `null` when un-customized (`holding-form.screen.tsx:213`/`:496–497`) and render through the same `?? holdingTypeSymbol[...]` fallback. No stored `bitcoinsign` to migrate.

**Discrepancy with the coordinator's assumption, flagged:** the coordinator expected THREE migrations (Health + jar + crypto account&holding). The code shows only TWO: Health (M1) and the crypto ACCOUNT default (M2). Jar and the crypto HOLDING default are computed render-time fallbacks (`entity.icon ?? map[type]` with a null-until-picked create path), so they are updated by the §2.4 code-constant change alone with NO data migration. The asymmetry is real and rooted in the two forms differing: the ACCOUNT form seeds+persists the kind default at create, while the HOLDING form leaves the icon null until the user picks one.

---

## 5. Sequencing note — implementation is BLOCKED

A parallel worktree (`next-bank-connect`, currently at `8750361`) is actively editing files this rework also touches. **Do NOT start implementation until that branch lands and is integrated onto `next`.** Starting now guarantees merge conflicts on hot files.

Shared files and the inventory rows sitting in them:

| Shared file (edited by `next-bank-connect`) | Inventory rows in it |
|---|---|
| `account-form.screen.tsx` | `:53` `FALLBACK_ICON` (§2.1 → `tray`), `:395` ChipRow `icons=accountKindSymbol` (dynamic, §3.9) |
| `account-detail.screen.tsx` | `:59` Connect→`lock`, `:64` Sync (gap §3.6), `:83` identity fallback (dynamic §3.9), `:267` last-synced (gap §3.6), `:307` Disconnect→`lock.open` |
| `transaction-form.screen.tsx` | `:1936` type chip icons (I3/§2.3 — the only edit here); `:992` remove-return, `:1005` add-return, `:1088` convert-to-exchange, `:1101` delete-tx are all user-finalized KEEPs (unchanged glyph → no edit) |
| `text-field.component.tsx` | Infra I2 (new leading-icon slot) |

**Order once unblocked:** (1) rebase this worktree onto integrated `next`; (2) infra I1 → I2 → I3/I4/I5, then I6/I7 (independent of I1); (3) central maps (`entity-symbols.ts` account-type set → `bitcoinsign.circle`/`rectangle.portrait`, DB category seed for Health → `cross`) plus the two data migrations M1 (Health) and M2 (crypto account) from §4.1; (4) the resolved per-call-site literals, grouped by area, one area per task (skipping every user-finalized KEEP site — those need no edit); (5) `npm run check:all` at each task checkpoint, `npm run check:deep` before done. Every icon decision in §2/§3 is now DECIDED — no row is left UNRESOLVED, so no per-row human gate remains before coding; the only precondition is the shared-file integration above. The one open non-blocking task is §3.0.5 iOS-availability verification (ops/user), which adds a `fallbackName` to any pool symbol found to be >iOS 16.

---

## 6. Self-review

- **Spec COMPLETE — every gap RESOLVED.** No AWAITING-USER-REPLACEMENT and no UNRESOLVED marker remains anywhere in the document. The only open item is the non-blocking §3.0.5 iOS-availability verification (ops/user), which does not gate any icon DECISION — it only decides whether a decided symbol also needs a `fallbackName`.
- **Coverage:** Every inventory row in §1 is classified — §2 (covered/net-new/decided type-defaults), §3.0 (RESOLVED pools: Kiko Entities 62 / Kiko Categories 73 / Kiko UI 39=31+8), §3.4–§3.8 (UI sites now DECIDED, user-finalized KEEP, or pool-confirmed unchanged), or §3.9 (dynamic pass-through). No row is left as an open "keep-the-old-icon?" question; every KEEP is a deliberate, user-finalized decision.
- **Pools RESOLVED:** the three collection files were read directly and their full symbol lists are embedded (§3.0.1/§3.0.2/§3.0.3). The old shared 138-entry `CURATED_ICONS` is REPLACED by two picker pools (Entities → IconEditor, Categories → category picker). The 8 Kiko UI `custom:UUID` entries re-confirm §2 entity/transaction glyphs (not double-counted, not unknown); the effective UI-gap candidate set is the 31 standard Kiko UI symbols.
- **The 8 final user resolutions applied:** sync-error `xmark.circle` (KEEP), sync-success/Save token `checkmark.circle` at both sites (KEEP), Duplicate `doc.on.doc` (KEEP), convert-to-exchange action `arrow.left.arrow.right` (KEEP — intentional reuse of the Exchange type glyph, by design), filter-menu triggers → `tray` for account filters and `tag` for category filters, at all 4 sites via the shared-safe I6 prop (default glyph now has no consumer — kept as fallback or dropped, executor choice), trend-filter trigger → dynamic per applied mode (I7), Utilities `bolt` (KEEP), Health `cross.case`→`cross` (CHANGE + migration M1), Transfers `arrow.left.arrow.right` (KEEP).
- **Seeded-category defaults FULLY DECIDED:** §3.0.4 is now 10/10 decided — 9 KEEP (Groceries/Dining/Transport/Shopping/Utilities/Entertainment/Cash/Transfers/Other) and 1 CHANGE (Health→`cross`, the sole seeded-default change and the sole category migration).
- **Data migrations verified (§4.1):** exactly TWO — M1 Health category (`WHERE key='health' AND icon='cross.case'` → `cross`) and M2 crypto ACCOUNT default (`WHERE kind='crypto' AND icon='bitcoinsign'` → `bitcoinsign.circle`). Jar and crypto_asset HOLDING defaults need NO migration (pure render-time `entity.icon ?? map[type]` fallbacks with a null-until-picked create path). This corrects the coordinator's three-migration assumption to two, with file:line evidence.
- **iOS floor:** three iOS-26 symbols routed through I1 `fallbackName` — `text.pad.header`→`list.bullet.rectangle`, `arrow.trianglehead.branch`→`arrow.branch`, and the sync-now `arrow.trianglehead.2.clockwise.rotate.90`→`arrow.triangle.2.circlepath`. Broader pool availability stays §3.0.5 (non-blocking).
- **Tensions RESOLVED — none remain:** `add-category-row` default → `tag` (§3.5); `other` category → `square.grid.2x2` stays, no migration (§3.0.4); Accounts tab → `tray` (soft `building.classical.columns.fill` candidate dropped/orphaned, §3.8.2); Settings TAB → `gear` while the System row stays `gearshape` (§2.2/§3.4); the `link.badge.plus` Disconnect mismatch resolved by disconnect → `lock.open` (§2.2); convert-to-exchange re-uses the Exchange glyph BY DESIGN, not a collision (§3.8). **No tensions remain flagged. Spec COMPLETE — ready to implement once `next-bank-connect` lands.**
