# Kiko redesign — design spec

Date: 2026-08-31
Status: approved direction, pending user review of this spec
Sub-project: native-iOS redesign (navigation, screens, design system, account-type flow, Monobank token)

## Purpose

Bring Kiko's look and interaction as close as possible to native Apple
iOS, with minimal deviation, and restructure the app around
account types. The user reviewed the current app in the emulator and
requested a redesign. This spec is the approved plan; it supersedes
the interim UI changes in the working tree (see "Relationship to the
current working tree").

The domain hierarchy is unchanged: **Account -> Holding ->
Transaction**, plus CurrencyRate and Settings (foundation spec
`2026-08-30-kiko-foundation-design.md`). The schema already supports
everything this redesign needs; no migration is required.

## Locked decisions

Each decision below was confirmed with the user during brainstorming
on 2026-08-31.

| Area | Decision |
|---|---|
| Visual target | Native Apple iOS look, minimal deviation. Dark-only. |
| Design system | `@callstack/liquid-glass` for glass surfaces, plus iOS-matched tokens on the existing react-native-unistyles theme. |
| Tab bar | React Navigation **Native Bottom Tabs** (`react-native-bottom-tabs`) — a real `UITabBarController` with iOS 26 liquid glass and SF Symbol icons. |
| Icons | `react-native-nitro-sfsymbols` for SF Symbols in content; it reuses the existing `react-native-nitro-modules` backend. |
| Navigation shape | Bottom tabs: Home, Accounts, Settings. Detail/form screens live in a native stack nested per tab. |
| Account-type flow | Create an account with a type. Bank -> connect Monobank. Cash -> set an initial value by hand. Crypto and Broker are deferred (hidden from the create UI; schema kept). |
| Monobank token | Streamlined manual capture: open `api.monobank.ua`, copy the token, one-tap paste from the clipboard, validate. No provider OAuth (needs a backend). |
| Sync trigger | Automatic on app open (throttled), plus on-demand from a connected account. No "Sync" button on Home. |
| Home content | Large centered balance in the base currency, then a merged transactions list with filters. |
| Currency selector | Moved from Home to Settings. |
| Currency display | Proper symbols (₴, $, €, ₿), not codes. |
| Transactions list | Every transaction, newest first, each row labeled with its account and its category. |
| Categories | Derived from MCC for Monobank transactions; optional manual entry for manual transactions. |
| Filters | Home list filters by account and by category (single-select to start). |
| Net worth | Exclude holdings under archived accounts (fixes tracked debt finding 3). |
| Sequencing | This spec, then a phased build; each phase a worktree, held for review. |

## Non-goals

- Crypto and Broker account interactions (deferred; schema keeps the enum values).
- Provider/corporate Monobank OAuth (needs registration, request signing, and a public webhook server).
- Light-mode theming (dark-only for now).
- Multi-select or saved filters (single-select to start).
- Manual transaction editing (create-only, unchanged).
- Android parity of the glass effect (iOS is the target).

## Feasibility findings (research)

- **No full iOS design system exists** for React Native. The realistic
  path is native platform components plus iOS-matched tokens. Native
  tab bar and glass require an **Xcode 26** build and an **iOS 26**
  runtime; both fall back gracefully to a solid native bar on older
  versions.
- **Monobank personal API has no programmatic token flow.** A token is
  created only by hand at `api.monobank.ua`. The OAuth-like flow exists
  only in the corporate API and needs provider registration, private-key
  request signing, and a public webhook. An on-device app cannot meet
  those, so the streamlined manual capture is the closest feasible flow.

## New dependencies

All three are native modules and need one `pod install`.

| Package | Purpose | Notes |
|---|---|---|
| `react-native-bottom-tabs` | Native `UITabBarController` tab bar | React Navigation Native Bottom Tabs integration. |
| `@callstack/liquid-glass` | Glass surfaces (balance header, cards) | Native `UIGlassEffect` on iOS 26; fallback below. Requires RN >= 0.80 (we run 0.87). |
| `react-native-nitro-sfsymbols` | SF Symbols in content | Uses the existing `react-native-nitro-modules` backend. |

Dependency hygiene: the `.npmrc` 7-day minimum-age rule may block a
just-published version. Pin a version older than 7 days, or add a
documented `min-release-age-exclude` entry with a reason. Any new
string-only Babel/native reference must get the same documented
exception treatment as `inline-import` and `react-native-dotenv` in
`knip.json`, `.depcheckrc.json`, and `CLAUDE.md`.

## Design system changes

Owner: `kiko:designer`.

Re-derive the color tokens in `src/design-system/theme.ts` to match
Apple's dark system palette exactly, keeping the existing token names
where possible:

| Token | Value | iOS source |
|---|---|---|
| `background` | `#000000` | systemBackground (dark) |
| `surface` | `#1C1C1E` | secondarySystemBackground |
| `surfaceHigh` | `#2C2C2E` | tertiarySystemBackground |
| `textPrimary` | `#FFFFFF` | label |
| `textSecondary` | `#EBEBF5` at 60% | secondaryLabel |
| `accent` | `#0A84FF` | systemBlue (dark) |
| `positive` | `#30D158` | systemGreen (dark) |
| `negative` | `#FF453A` | systemRed (dark) |
| `border` | `#38383A` | separator (dark) |

- Add a **currency-symbol** map (see "Currency display").
- Add **glass-surface** helpers wrapping `@callstack/liquid-glass`.
- Typography maps to iOS text styles using the San Francisco system
  font (React Native's iOS default): large title, title, headline,
  body, footnote, caption.
- Add a shared **inset-grouped list** component for Accounts and
  Settings, styled to iOS: grouped rows on `surface`, `separator`
  hairlines, section insets.

## Navigation

Owner: `kiko:developer`.

Replace the single native stack (`src/navigation/root.navigator.tsx`)
with:

- A **Native Bottom Tab navigator** with three tabs:
  - **Home** — SF Symbol `house.fill`.
  - **Accounts** — SF Symbol `wallet.pass.fill`.
  - **Settings** — SF Symbol `gearshape.fill`.
- Each tab hosts a **native stack** for its detail/form screens:
  - Home stack: Home.
  - Accounts stack: Accounts, AccountDetail, HoldingDetail,
    AccountForm, HoldingForm, TransactionForm.
  - Settings stack: Settings.
- Detail and form screens use native **large-title headers**
  (`headerLargeTitle: true`).
- Set a **dark navigation theme** on `NavigationContainer` so the
  background is truly black behind every screen. This is the root
  cause of the "background not black" report; the token was already
  `#000000`.
- Remove the "Home" title and the top-left "< Home" button.
- Update `src/navigation/types.ts`: split the single param list into
  per-tab stack param lists plus a tab param list.

## Screens

### Home

Owner: `kiko:developer`.

- **Large centered balance** at the top: net worth in the base
  currency, with the proper symbol. No title.
- **No** currency selector, "Add account", or "Sync" button.
- **Merged transactions list** below the balance: every transaction
  from every holding, newest first.
  - New repository query: transactions joined to holding and account,
    ordered by `time` descending, returning per row the amount,
    currency, description, category, account name, and holding name.
  - Each row shows amount (signed color via `MoneyText`), description,
    and a label line: account name + category.
- **Filter bar** above the list: filter by account and by category,
  single-select, with an "All" default.

### Accounts

Owner: `kiko:developer`.

- Inset-grouped list of **active accounts** (exclude
  `archivedAt != null`), each showing its converted balance.
- **Create account** (`AccountForm`): pick a type. The create UI
  offers **Bank** and **Cash** only. On create:
  - **Cash**: also collect an **initial value** and currency; create
    one `cash` holding with that balance.
  - **Bank**: create the account, then offer **Connect Monobank**.
- **AccountDetail**: holdings for the account, plus:
  - For a connected bank account, an on-demand **"Sync now"**.
  - Existing holding/transaction entry points.
- **Connect Monobank** action: store the token (Keychain), mark the
  account `institution = 'monobank'`, then run a sync that populates
  that account's holdings.

### Settings

Owner: `kiko:developer`.

- Inset-grouped list:
  - **Base currency** selector (moved from Home).
  - **Monobank token** entry (streamlined capture; see "Monobank
    token flow").
  - **Sync status**: last-sync time from `settings.lastSyncAt`.

## Currency display

Owner: `kiko:designer` (token map) + `kiko:developer` (formatter).

Change `formatMoney` in `src/currency/format.ts` to render a symbol
instead of a code, using a symbol map:

| Currency | Symbol |
|---|---|
| UAH | ₴ |
| USD | $ |
| EUR | € |
| BTC | ₿ |

Keep the per-currency decimal scale (`currencyScale`) unchanged.
Symbol placement follows the common convention: symbol before the
number for `$`/`€`/`₿`, and per locale for `₴`. Decide exact placement
in the plan; keep it consistent and tested.

## Monobank token flow

Owner: `kiko:developer`.

- A **"Get token"** button opens `https://api.monobank.ua/` in an
  in-app browser (or Safari). The user creates and copies the token
  there.
- Back in the app, a **"Paste token"** button reads the clipboard and
  fills the field. The user never types the token.
- **Validate** the pasted token against `/personal/client-info`
  before saving. On success, store it in the Keychain (`token.ts`,
  unchanged storage) and show the client name for confirmation.
- Clipboard read needs the existing RN clipboard capability; if no
  clipboard module is present, add `@react-native-clipboard/clipboard`
  (evaluate in the plan).

## Sync changes

Owner: `kiko:developer`.

- **Connect to a user account, not an auto-created one.** Today
  `ensureMonobankAccount` (`src/monobank/sync.ts:138`) finds or creates
  a single account named `'Monobank'`. Change `runSync` to accept the
  connected bank account id (the account the user created and connected)
  and upsert holdings under it. Keep the `metadata.monobankId`
  re-matching.
- **Auto-sync on app open**, throttled. Reuse the throttle pattern from
  rates refresh (`src/rates/rates-refresh.ts`, `rates.repo.latestFetchedAt`)
  against `settings.lastSyncAt`. Only run if a token and a connected
  account exist.
- **On-demand sync** from AccountDetail for a connected account.
- **Categories from MCC**: extend `mapStatementItem`
  (`src/monobank/sync.ts:85`) to set `category` from a small MCC ->
  category map. Manual transactions may set `category` via an optional
  field on the transaction form.

## Domain and data changes

Owner: `kiko:developer`.

- **No schema migration.** `accounts.kind` and the `holdings.type`
  enum already cover Bank/Cash and card/jar/deposit/bond/cash.
- **Net-worth archived fix**: exclude holdings whose parent account is
  archived. Today `home.screen.tsx:70` filters only by holding
  `closedAt`. Add an account-archived filter (and reuse it in
  `account-detail.screen.tsx:22` where relevant). Consider a repository
  query that returns only holdings under active accounts.
- **New transactions query** in `src/repositories/transactions.repo.ts`:
  a joined "all transactions with account + holding labels" read for
  the Home list.
- **Accounts list filter**: `accounts.repo.listQuery()` (or a new
  active-only query) excludes `archivedAt != null` for the Accounts
  screen and net worth.
- **Optional category on the manual transaction form**
  (`src/screens/forms/transaction-form.screen.tsx`), writing
  `transactions.category`.

## Phases

Each phase is a separate Orca worktree, delegated to role agents,
verified with `npm run check:all` and Jest, and held for user review.
Phases are ordered so the app stays runnable after each.

1. **Design system + navigation.** Add the three dependencies and pods.
   iOS-matched tokens, glass helpers, SF Symbols. Native bottom tabs,
   dark navigation theme, native large-title headers, remove the Home
   title and back button. Move existing screens under the new tabs.
2. **Home.** Large centered balance, merged transactions query and
   list, filter bar. Move the currency selector out.
3. **Accounts.** Accounts screen, create-by-type UI (Bank/Cash), Cash
   initial value, AccountDetail on-demand sync, Connect Monobank entry
   point.
4. **Settings.** Currency selector, token entry surface, sync status,
   inset-grouped styling.
5. **Token flow + auto-sync.** Streamlined token capture and validate,
   sync targeting the connected account, auto-sync on app open, MCC
   categories. Ops sets up a signed device build so the user can test
   the token flow on a physical phone.

## Relationship to the current working tree

- **Keep** the drizzle `.sql` boot fix (Group A in `HANDOFF.md`):
  `metro.config.js`, `babel.config.js`, `package.json` /
  `package-lock.json` (`babel-plugin-inline-import`), the documented
  exceptions, and `ios/Podfile.lock`. The app cannot launch without it.
- **Supersede** the interim UI work (Groups B, C, D): the Home
  "Settings" button, the white action buttons, the re-derived
  MoneyText tones, and the re-extracted form components
  (`FormTextInput`, `ChipSelector`, `SyncButton`). The redesign
  reworks these. This resolves HANDOFF open decision 2 (raw vs
  extracted forms): shared iOS components are defined by this design,
  not by the earlier dedup pressure.
- Keep the black-background token; the redesign adds the dark
  navigation theme that makes it show everywhere.

## Testing

Owner: `kiko:qa`.

- Unit: the symbol formatter (`formatMoney`), the MCC -> category map,
  the net-worth archived-account exclusion, the token-validate path,
  and the merged-transactions query mapping.
- Component: Home balance render, filter behavior, Accounts create-by-type.
- Keep the existing 98 tests green; update tests that assert the old
  code-suffix currency format or the removed Home buttons.
- E2E (Maestro) later: the account-type creation flow and the token
  capture flow.
- Device: ops provisions a signed build for the user's iPhone to test
  the token flow (phase 5).

## Risks and open items

- **iOS 26 / Xcode 26** needed for full glass and native tabs; confirm
  the local toolchain (ops) before phase 1.
- **Native tab label truncation** on iOS 26 (react-navigation issue
  12908); work around if it appears.
- **Symbol placement** per currency; finalize in the plan.
- **Clipboard module** presence; confirm in phase 5.
- **MCC map** coverage; start small, expand over time; unmapped MCC
  falls back to a generic category.

## Verification

- `npm run check:all` and Jest after each phase.
- `npm run check:deep` before declaring the whole redesign done.
