---
name: kiko-translator
description: Invoke when touching any user-facing string, a catalogue in src/i18n/locales, a t() call, the language setting, the widget's strings, or anything rendered before the navigator (MigrationsGate, LockGate). Read before adding a string, a screen, or a widget label.
---

# Kiko translator

Source of truth: `src/i18n/` and `docs/superpowers/specs/2026-09-06-bug-hunt-tasks.md`
(T-6, T-17, T-24, T-25, T-41, T-43 — the i18n defect cluster from the
2026-09-06 bug-hunt pass). This skill states the settled contract those
fixes establish; some of them land on the `bug-hunt-fixes` branch, not
yet merged as of this writing — check `git log`/`git status` for the
current state of the files below before assuming a fix has landed.

## Never persist a display string — resolve with `t` at render time

A transaction/holding row stores data, never a rendered label. The
exchange-leg bug (T-6) is the cautionary case:
`recordExchange`/`recordExchangeCounterpart` in
`src/transactions/transactions.repo.ts` write a literal English
`description` (`` `Exchange to ${name}` ``) straight into the row — a
later language switch can never fix a row already written that way.
The correct pattern already exists in the codebase for this exact
shape: `src/transactions/default-description.ts`
(`defaultTransactionDescription`) takes a `TFunction` and resolves the
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
`uk.ts` from this alone). Check `src/i18n/locales/en.ts`'s last line
before adding a key — if it still ends `} as const;`, the T-26 fix
has not landed on this branch yet; drop the suffix as part of that
merge, not before.

## Language must be resolved before the first gate paints

`MigrationsGate` and `LockGate` (`src/migration/migrations.gate.tsx`,
`src/auth/lock-gate/lock-gate.component.tsx`) render **before**
`AppRoot` — which is the only place `useSyncLanguageWithSettings`
(`src/i18n/use-sync-language-with-settings.ts`) mounts today. A device
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

`src/design-system/components/button/button.styles.ts` forces
`textTransform: 'capitalize'` on every `Button` label. Ukrainian UI
copy is written sentence-case (e.g. `uk.ts`'s "Додати рахунок"), and
title-casing it ("Додати Рахунок") reads wrong (T-41). Do not add a
new blanket `textTransform` anywhere in the design system; if one is
ever reintroduced, it must be gated on the active language, not
applied unconditionally.

## The widget shows the in-app language, not the device language

The widget process cannot run `i18next` (see `kiko-widget`'s
"separate process" constraint), so its localized labels have to be
carried inside the snapshot the app writes rather than resolved
in-process. `NetWorthSnapshot` gaining label fields resolved with
`i18n.t` at build time in `src/widget/net-worth-snapshot.ts`'s
`buildNetWorthSnapshot`, so the widget always shows whatever language
is active *in the app* rather than the device's own language setting,
lands with the 2026-09-06 bug-hunt branch (T-24) — check that file's
current fields before assuming it's already wired in. Once it is, a
language-only settings change becomes a reason to re-write the
snapshot on its own: `src/widget/use-net-worth-widget.ts`'s `writeNow`
depending on the active/persisted language, so switching language
doesn't leave the widget's formatted strings on the old locale until
some other table changes triggers a write, is the T-43 fix and also
lands with that branch. Read both files for the current dependency
list rather than assuming either is already wired in.

## Number and currency formatting follows the active locale

`src/currency/format.ts`'s `formatMoney` takes a BCP-47 locale
parameter; callers get it from `src/i18n/active-locale.ts`
(`activeLocale()`), which maps the active i18next language to the
locale `Number.prototype.toLocaleString` needs for correct thousands/
decimal punctuation (`uk-UA` groups `1 234,56`; `en-US` groups
`1,234.56`). Never hardcode a locale string at a `formatMoney` call
site — always go through `activeLocale()` so a language switch changes
number formatting everywhere at once, including the widget snapshot.
