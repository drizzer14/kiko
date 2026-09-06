# Localization (English / Ukrainian) — design spec

Date: 2026-09-06
Status: approved, pending implementation plan
Scope owner: Kiko coordinator

## Overview

Add two-language support to Kiko: English and Ukrainian. The user
picks the language from the Settings screen with an inline segmented
switch labelled by flag emoji (🇬🇧 English, 🇺🇦 Українська). Absent an
explicit choice, the app follows the device's language. This is a
UI-string and formatting change, not a data-model rework: it adds one
nullable settings column, a message catalog, a locale-aware pass over
money/date formatting, and a translation layer for the seeded default
categories.

## Goals

- English and Ukrainian, selectable from Settings, defaulting to the
  device language when unset.
- Every user-facing string in the app routed through a typed catalog,
  so a wrong or missing key is a compile-time error, not a runtime
  blank.
- Money and compact-money formatting group/punctuate correctly for
  Ukrainian (`1 234,56`) without touching the currency-symbol
  placement rules already in place.
- Numeric dates stay exactly as they are today (see decision E) —
  they are already locale-independent by design.
- The ~10 seeded default categories (`drizzle/migrations/0002_seed_categories.sql`)
  show a translated label in Ukrainian without mutating any row a
  user has renamed.

## A. Library and device detection

- Add `i18next` and `react-i18next` as real dependencies. Both are
  imported from working code — `react-i18next`'s `useTranslation`
  hook from every component that renders catalog text, and (if a
  provider is used) `I18nextProvider` — so Knip and depcheck see
  genuine usage and need no ignore-list entry. `.npmrc`'s
  `min-release-age=7` (see `CLAUDE.md` → "Dependency hygiene") applies
  at install time like any other new dependency; neither package name
  goes in `min-release-age-exclude`.
- No `react-native-localize`. Kiko is iOS-only, so the device language
  is read dependency-free from
  `NativeModules.SettingsManager.settings.AppleLanguages[0]` (a React
  Native / iOS built-in, no extra native module or pod). The value is
  a BCP-47 tag (e.g. `"uk-UA"`, `"en-US"`); only its primary subtag is
  used. Mapping: primary subtag `uk` or `ru` → `uk`; anything else →
  `en`.

## B. Message catalog

- New `src/i18n/` folder:
  - `src/i18n/index.ts` — creates and initializes the `i18next`
    instance (resources = `{ en, uk }`, `fallbackLng: 'en'`) and
    exports it, mirroring how `src/design-system/unistyles.ts` is a
    side-effect-configuring module imported first in `App.tsx` (see
    decision C).
  - `src/i18n/locales/en.ts` — the canonical English resource object,
    the source of truth for both the catalog's keys and its
    TypeScript type.
  - `src/i18n/locales/uk.ts` — the Ukrainian mirror, same key set.
- Keys are namespaced by app area, e.g. `settings.baseCurrency`,
  `common.save`, `calendar.month.january`, `categories.groceries`.
- TypeScript module augmentation types the catalog off `en.ts`
  (i18next's standard `CustomTypeOptions.resources` augmentation), so
  `t('settings.basecurrency')` (a typo) or a key that exists in `uk.ts`
  but not `en.ts` fails `tsc`/the editor, not just the runtime. This
  fits the project's strict-typing quality bar (`CLAUDE.md` → "Kiko
  quality harness").
- Ukrainian plural forms use i18next's CLDR-aware key suffixes —
  `_one`, `_few`, `_many`, `_other` — for any pluralized string (e.g.
  `transactions_one`, `transactions_few`, `transactions_many`,
  `transactions_other`). English only needs `_one` / `_other`; i18next
  picks the right suffix per language from the count passed to `t()`.

## C. Persistence and state flow

- Add a nullable `language` column to the `settings` table in
  `src/db/schema.ts` (currently at
  `src/db/schema.ts:112-130`, alongside `baseCurrency`):
  `text('language', { enum: ['en', 'uk'] })`, no `.notNull()`, no
  default. `null` means "follow the device"; `'en'` / `'uk'` means an
  explicit user choice. This mirrors `baseCurrency`'s shape (an enum
  text column) but stays nullable, unlike `baseCurrency`, since
  "unset" is a real, distinct state here. `settings` remains a single
  row keyed `id = 1` (`SETTINGS_ID` in `src/repositories/settings.repo.ts`).
- Generate the migration with drizzle-kit. The migrations folder
  (`drizzle/migrations/`) currently ends at
  `0011_add_lock_settings.sql`, so the new file is
  `drizzle/migrations/0012_add_language.sql` (drizzle-kit also
  regenerates `drizzle/migrations/meta/_journal.json` and the new
  `00XX_snapshot.json`, as every prior migration has done).
- App start initializes i18n synchronously with the device-detected
  language, before the database has loaded, using the same pattern
  `App.tsx` already uses for Unistyles: `App.tsx` line 1–3 imports
  `./src/design-system/unistyles` first as a side-effect, "before any
  component that calls `StyleSheet.create` is imported." `src/i18n/index.ts`
  is imported the same way, at the very top of `App.tsx`, before
  `MigrationsGate` mounts — so the very first paint (including
  `MigrationsGate`'s own UI) is already in the correct device
  language.
- A small hook — `useSyncLanguageWithSettings` (new, in `src/i18n/`)
  — reads the settings row the same way `settings.screen.tsx` does
  today (`useLiveQuery(settingsRepo.getQuery(), ['settings'])`, see
  `src/db/use-live-query.ts` and
  `src/screens/settings/settings.screen.tsx:27-28`). When
  `settings.language` is non-null and differs from `i18n.language`, it
  calls `i18n.changeLanguage(settings.language)`. When it is `null`,
  it leaves the device-detected default in place. This hook is called
  once from `AppRoot` in `App.tsx` (`src/db/migrations.gate.tsx`'s
  child, i.e. after migrations have run and the `settings` table
  exists), alongside the existing `settingsRepo.ensure()` effect and
  `useAutoSync()` call at `App.tsx:24-30`.
- Add `settingsRepo.setLanguage(lang: 'en' | 'uk')` to
  `src/repositories/settings.repo.ts`, mirroring the existing
  `setBaseCurrency` (`src/repositories/settings.repo.ts:16-19`):
  `write((tx) => tx.update(settings).set({ language: lang }).where(eq(settings.id, SETTINGS_ID)))`.

## D. Settings UI

- New `LanguageSwitch` design-system component under
  `src/design-system/components/language-switch/`, mirroring
  `src/design-system/components/currency-switch/`'s file layout
  (`language-switch.component.tsx`, `language-switch.props.d.ts`,
  `index.ts`, `language-switch.component.test.tsx`).
- `CurrencySwitch` (`src/design-system/components/currency-switch/currency-switch.component.tsx`)
  is itself a thin wrapper around the shared
  `src/design-system/components/option-pills/` component — it holds
  no styles file of its own; `OptionPills` owns the
  Pressable-pill-plus-`accessibilityState` markup
  (`option-pills.component.tsx:33-43`). `LanguageSwitch` follows the
  same shape: it delegates to `OptionPills` rather than reimplementing
  the pill. `OptionPills`' `icon` slot renders an SF Symbol name
  through `SymbolIcon` (`option-pills.props.d.ts:7-9`), which cannot
  render a flag emoji glyph, so `LanguageSwitch` does not use `icon` —
  it composes the flag and the label into one string passed through
  `OptionPills`' `label` prop (`(option) => string`, e.g.
  `'en' → '🇬🇧 English'`, `'uk' → '🇺🇦 Українська'`), the same way the
  lock-grace-period picker already uses `OptionPills` text-only (per
  the comment at `option-pills.props.d.ts:8`, "Omitted for a
  text-only pill row"). `LanguageSwitch`'s props mirror
  `CurrencySwitchProps` (`currency-switch.props.d.ts`):
  `{ selected: 'en' | 'uk' | undefined; onSelect: (lang: 'en' | 'uk') => void }`.
- Add a `settings-card-language` `GlassSurface` card to
  `src/screens/settings/settings.screen.tsx`, following the existing
  `settings-card-base-currency` card exactly
  (`settings.screen.tsx:48-56`): a `GlassSurface` wrapping a
  `SettingsRow` wrapping the switch. The card reads the effective
  language — `settings?.language` if set, else the device-detected
  value from `src/i18n/index.ts` — and calls `settingsRepo.setLanguage`
  on select, the same shape as the existing
  `handleSelectCurrency` → `settingsRepo.setBaseCurrency` pair
  (`settings.screen.tsx:30-32`).

## E. Dates and numbers

- `formatMoney` (`src/currency/format.ts:4-17`) and
  `compactNumber` / `formatCompactMoney`
  (`src/currency/compact.ts:22-26`, `:71-82`) already take a `locale`
  parameter, defaulted to `'en-US'`. Add an `activeLocale()` helper
  (new, in `src/i18n/`) returning `'en-US'` for `'en'` and `'uk-UA'`
  for `'uk'` off the active i18next language, and pass it at every
  call site of these three functions. Ukrainian then groups numbers as
  `1 234,56` (space thousands separator, comma decimal) via
  `Number.prototype.toLocaleString`'s own `uk-UA` behavior — no manual
  formatting logic changes. The hand-coded currency-symbol placement
  (`formatMoney`'s `money.currency === 'UAH' ? \`${sign}${formatted} ${symbol}\` : ...`,
  same shape in `formatCompactMoney`) is untouched: only the numeric
  grouping/decimal punctuation changes with locale, not where the
  symbol sits.
- Numeric dates stay UNCHANGED. `src/dates/format.ts:1-3`'s own
  comment states the reason: "Explicit, locale-independent date
  formatting. The device locale would otherwise reorder fields (MM/DD
  vs DD/MM) or switch to 12-hour time, so every component is read off
  the Date and assembled by hand into a fixed layout." `formatDate`
  always renders `DD.MM.YYYY`, which is already correct for both
  English and Ukrainian audiences in this app — no locale parameter is
  added to `src/dates/format.ts`.
- Two spots hold spelled-out (non-numeric) date names and do change:
  - `src/screens/calendar/calendar-header/calendar-header.component.tsx` —
    the hardcoded `MONTH_NAMES` array (lines 11–24) and `WEEKDAY_NAMES`
    array (line 28) move into the catalog (e.g.
    `calendar.month.january` … `calendar.weekday.sun` …), looked up
    via `t()` instead of indexing a literal English array.
  - `src/design-system/components/net-worth-line/net-worth-line.component.tsx:135-136` —
    `formatAxisTime`'s
    `new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })`
    uses `activeLocale()` in place of the hardcoded `'en-US'`.

## F. Default category translation

- `categories` (`src/db/schema.ts:141-150`) is keyed by a STABLE
  `key` slug (the primary key); `title` is a separate, user-editable
  column. The seed migration
  (`drizzle/migrations/0002_seed_categories.sql`) inserts the ten
  built-in categories with their `key` and an English `title` (e.g.
  `('groceries', 'Groceries', 'cart')`, `('other', 'Other',
  'square.grid.2x2')`).
- Because the schema has no separate "is this the seeded default"
  flag, "not renamed by the user" is detected by comparing the row's
  current `title` against the English seed title for that `key` (a
  small `key → English title` map sourced from the seed migration
  above): if they still match, the display layer shows the catalog's
  translated label for that `key` instead of `title`; if the user has
  typed anything else into `title`, that exact stored string is shown
  unchanged, in either language. This translates the built-in
  categories without mutating any row and without needing a schema
  change — a user's own custom category names are never touched.

## Files touched / added

Added:
- `src/i18n/index.ts`, `src/i18n/locales/en.ts`,
  `src/i18n/locales/uk.ts`
- `src/i18n/active-locale.ts` (the `activeLocale()` helper, decision E)
- `src/i18n/use-sync-language-with-settings.ts` (the settings-driven
  `i18n.changeLanguage` hook, decision C)
- `src/design-system/components/language-switch/language-switch.component.tsx`,
  `.props.d.ts`, `index.ts`, `.component.test.tsx`
- `drizzle/migrations/0012_add_language.sql` (+ the drizzle-kit
  regenerated `drizzle/migrations/meta/_journal.json` and its new
  snapshot file)
- A catalog key-parity test (decision G) and the other new tests in
  decision G

Modified:
- `package.json` (`i18next`, `react-i18next` added)
- `App.tsx` (side-effect import of `src/i18n/index.ts` at the top,
  alongside the existing Unistyles import; `useSyncLanguageWithSettings()`
  called from `AppRoot`)
- `src/db/schema.ts` (`settings.language` column)
- `src/repositories/settings.repo.ts` (`setLanguage`)
- `src/screens/settings/settings.screen.tsx` (new
  `settings-card-language` card)
- `src/screens/calendar/calendar-header/calendar-header.component.tsx`
  (`MONTH_NAMES` / `WEEKDAY_NAMES` → catalog keys)
- `src/design-system/components/net-worth-line/net-worth-line.component.tsx`
  (`formatAxisTime` uses `activeLocale()`)
- `src/currency/format.ts`, `src/currency/compact.ts` call sites
  (pass `activeLocale()` instead of relying on the `'en-US'` default)
- The category display layer that resolves `categories.key` →
  `{ title, icon }` (decision F)
- The ~37 other `.tsx` files under `src/` that currently hold
  hardcoded user-facing English strings, each switched to `t('...')`
  calls against the new catalog. This is the bulk of the
  implementation effort; the exact file list is an implementation-plan
  concern, not this spec's.

## G. Testing

- A test asserting `src/i18n/locales/en.ts` and
  `src/i18n/locales/uk.ts` expose the exact same set of keys (no key
  present in one and missing from the other).
- A `LanguageSwitch` unit test mirroring
  `currency-switch.component.test.tsx`'s shape (`currency-switch.component.test.tsx:1-45`):
  pressing a segment reports the pressed language through `onSelect`,
  both flag+label pills render, and the selected segment carries
  `accessibilityState.selected`.
- A Ukrainian number-grouping test for `formatMoney` /
  `formatCompactMoney` (asserting the `1 234,56`-style grouping when
  `activeLocale()` is `'uk-UA'`, alongside the existing `'en-US'`
  cases).
- Render tests for one or two screens under each language (e.g.
  Settings and one more), asserting the catalog strings for that
  language appear.

## H. Out of scope

- A third language beyond English/Ukrainian.
- Right-to-left layout support (both English and Ukrainian are LTR).
- Runtime/remote catalog download or update — the catalog ships in
  the app bundle.
- Translating user-typed text, except the default-category case in
  decision F (a user's own category names, transaction descriptions,
  comments, account/holding names, etc. are never translated or
  altered).
