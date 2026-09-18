---
name: kiko-translator
description: Invoke when touching any user-facing string, a catalogue in src/i18n/locales, a t() call, the language setting, or anything rendered before the navigator (MigrationsGate, LockGate). Read before adding a string or a screen.
---

# Kiko translator

Source of truth: `src/i18n/` and `docs/superpowers/specs/2026-09-06-bug-hunt-tasks.md`
(T-6, T-17, T-24, T-25, T-41, T-43 — the i18n defect cluster from the
2026-09-06 bug-hunt pass). This skill states the settled contract those
fixes establish; `bug-hunt-fixes` merged long ago, so every fix below
is live on the tree.

## Never persist a display string — resolve with `t` at render time

A transaction/holding row stores data, never a rendered label. The
exchange-leg bug (T-6) is the cautionary case:
`recordExchange`/`recordExchangeCounterpart` in
`src/transactions/` write a literal English
`description` (`` `Exchange to ${name}` ``) straight into the row — a
later language switch can never fix a row already written that way.
The correct pattern already exists in the codebase for this exact
shape: `defaultTransactionDescription`
(`src/transactions/`) takes a `TFunction` and resolves the
label on every call, re-evaluating against whatever language is active
now. Give a structural marker (a category key or a shared correlation
id) to anything that today gets its "what is this row" answer baked
into a persisted description, and resolve the label the same way
`defaultTransactionDescription` does — never write the resolved string
to a column. The same rule applies to a placeholder like "Never" for
last-sync (T-17, `src/screens/account-detail/format-last-sync.ts`): add
a catalogue key and thread `t` through, don't hardcode the fallback.

## The two catalogues change together; a parity test enforces it

`src/i18n/locales/en.ts` and `src/i18n/locales/uk.ts` must carry the
exact same key set. `src/i18n/locales/en.uk.parity.test.ts` walks both
objects to dotted leaf paths and asserts the two sets are equal — read
that file to see the current mechanism, do not restate the key list
here; it drifts the moment either catalogue gains a key.

**i18next plurals keep parity by carrying every form in BOTH catalogues.**
The parity test compares EXACT leaf-key sets, and `uk.ts` is typed
`typeof en` (excess keys are a `tsc` error), so a plural key defines the
SAME suffix set in both languages: Ukrainian needs `_one` / `_few` /
`_many` / `_other` (its CLDR plural categories), so English defines all
four too — English selects `_one` / `_other`; its `_few` / `_many` are
inert duplicates of the plural form kept only to satisfy both invariants.
Never make the parity test plural-aware to allow different suffix sets per
language — that would break the `typeof en` typing. The first plural in the
app is `statistics.trendFilter.button.manual` (the trend Filters button's
"{{count}} Category"/"Categories", Ukrainian "Категорія/Категорії/Категорій").
i18next resolves the right form per language at `t('...', { count })` time;
init uses the default JSON v4 plural format (see `src/i18n/index.ts`).

## Catalogue typing: `typeof en`, never `as const`

`src/i18n/i18next.d.ts` types `t()`/`useTranslation()` off `typeof en`
so a typo'd key fails `tsc`, not a runtime blank. `en.ts` must NOT be
suffixed `as const`: a literal-valued `typeof en` forces `uk.ts`'s
`typeof en` annotation to match every English string's exact literal
type, which turns one genuinely missing/extra key into hundreds of
noise errors and buries the real one (T-26 measured 261 errors in
`uk.ts` from this alone). The T-26 fix is landed — `en.ts` ends
`};`, not `} as const;` — keep it that way when adding a key.

## Language must be resolved before the first gate paints

`MigrationsGate` and `LockGate` (`src/migration/`,
`src/auth/lock-gate/lock-gate.component.tsx`) render **before**
`AppRoot` — which is the only place `useSyncLanguageWithSettings`
(`src/i18n/`) mounts today. A device
set to `en` with a persisted `settings.language` of `uk` and app-lock
on sees "Preparing database…" then an English lock screen, and only
gets Ukrainian after unlock (T-25). The fix resolves the persisted
language inside the init chain — before `MigrationsGate` reports
success — rather than waiting for `AppRoot`. Any string rendered by a
component that mounts before `AppRoot` needs to go through whatever
that resolved-language mechanism ends up being; read `App.tsx` and
`migrations.gate.tsx` for the current wiring before adding a
pre-`AppRoot` screen.

## Ukrainian is sentence case — no blanket `textTransform`

`Button` labels carry no style-layer `textTransform`; casing comes
entirely from each catalogue. Ukrainian UI copy is written
sentence-case (e.g. `uk.ts`'s "Додати рахунок"), and English `Button`
copy is written sentence case too, so neither needs — and must never
regain — a blanket transform (title-casing Ukrainian, e.g. "Додати
Рахунок", reads wrong; this was T-41). See the "Button" section in
the kiko-design-system skill for the mechanism and the current
non-transform contract; this skill only owns getting the catalogue
strings correctly cased in the first place — never rely on a style to
fix up a wrongly-cased string.

## Number and currency formatting follows the active locale

`formatMoney` (`src/currency/`) takes a BCP-47 locale parameter;
callers get it from `activeLocale()` (`src/i18n/`), which maps the
active i18next language to the locale `Number.prototype.toLocaleString`
needs for correct thousands/decimal punctuation (`uk-UA` groups
`1 234,56`; `en-US` groups `1,234.56`). Never hardcode a locale string
at a `formatMoney` call site — always go through `activeLocale()` so a
language switch changes number formatting everywhere at once.
