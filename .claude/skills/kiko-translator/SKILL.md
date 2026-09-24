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

## Casing follows one rule per UI role — the single source (CASE track, 2026-09-24)

Every catalogue string's casing is decided by its UI ROLE, not by
habit or by the key's name alone — verify the role by call site (grep
`t('key')`, read the rendering component) before writing a new
string:

- **Title Case** — screen/navigation titles (`options.title` /
  `navigation.setOptions({ title })`), section headings (rendered
  `<Text variant="heading">`), sheet/modal titles (a `BottomSheet` /
  `ConfirmSheet` `header`/`title` prop).
- **Sentence case** — everything else: buttons, chips/segments, menu
  items, field labels, captions, placeholders, errors, hints. This is
  the majority role — assume sentence case for a new string unless it
  is unambiguously one of the three Title Case roles above.
- **Keep as written** — proper nouns and brand names (Kiko/Кіко,
  Monobank, Binance, Diia/Дія, Apple, NBU/НБУ, Keychain, Face ID,
  iOS), acronyms (ISIN, API, CSV, BTC, ISO codes), and a unit in
  parentheses cases per the rule of the role it sits inside.
- **uk is sentence case everywhere** — Ukrainian never switches to
  Title Case for a screen title or a section heading the way English
  does; see the next section.

A string used in TWO roles (e.g. a Settings row's own label, which is
a menu item, doubling as that screen's nav-header title) needs TWO
keys, one per role, not one key reused — `settings.dataExport.title`
(the nav title, Title Case: "Export Data") vs
`settings.dataExport.rowLabel` (the same screen's Settings-row label,
sentence case: "Export data") is the pattern; see
`accountDetail.addBankSheetTitle` vs `accountDetail.addBankAction`,
and `statementImport.chooseHoldingSheetTitle` vs
`statementImport.chooseHolding`, for the other two instances. An
`Alert.alert` title (a key ending `errorTitle`) is an ERROR, not a
screen/sheet title, even though the key name ends in `Title` — it
stays sentence case ("Export failed", not "Export Failed").

The mechanized invariant lives in
`src/i18n/locales/en.casing-by-role.test.ts` (walks the whole `en`
catalog via the shared `flattenCatalog` helper — also used by
`uk.casing.test.ts`, `en.uk.parity.test.ts`, and
`uk.catalog-rules.test.ts` — and fails on any casing violation) and
`src/i18n/locales/uk.casing.test.ts` (the uk sentence-case-everywhere
invariant). The Title Case role is an EXPLICIT key list (`TITLE_KEYS`,
`src/i18n/locales/title-keys.ts` — shared with the full-stop invariant
below), not a key-name pattern (a `Title`/`Heading`-suffixed key that
is actually a button or a field label would otherwise be silently
exempted from the sentence-case check — CASE fix round 1/5); every
other key defaults to sentence case, so a genuinely new
title/heading/sheet-title key fails this test until it is added to
`TITLE_KEYS` on purpose. Read the FAILURE MESSAGE'S key path before
assuming a new string is miscased: add a new title key to
`title-keys.ts`, not just to the catalogue.

## Final "." follows one rule per UI role too (F4 full-stop DECISION, 2026-09-24)

A second, independent axis from casing — every catalogue string's
trailing punctuation is decided by its UI ROLE, not habit:

- **No final "."** — titles, headings, sheet titles, buttons,
  chips/options, menu items, field labels, placeholders, empty
  states, alert titles, progress/status text (e.g.
  `home.syncingHoldings`), and a `"Label: {{value}}"` string (e.g.
  `migration.error: 'Migration error: {{message}}'`). A sheet title
  phrased as a real question (`settings.dataImport.confirmTitle`,
  "Replace All Data?") still ends in its own "?" — that is the
  question's punctuation, not a violation of this rule.
- **Final "." always** (or "?" when the body is itself a question) —
  option descriptions/subtitles, captions/hints, errors, toast/alert
  bodies, even for a one-word fragment (`isinNotInRegister`: "Not in
  the NBU register.").

The mechanized invariant lives in
`src/i18n/locales/en.final-stop-by-role.test.ts` (checks both `en` and
`uk` via `describe.each`). It reuses `TITLE_KEYS` for the no-final-"."
side, and checks every OTHER role with a reliable name/path/value
convention: a leaf key whose OWN name ends `Error` always ends "." or
"?" (`forms.holding.quantityError`, `columnMapping.dateColumnError`,
...; no key is ever shaped `Error_<plural suffix>` — a plural key's own
root, e.g. `skippedWrongCurrency`, never carries the `Error` suffix at
all); `*Placeholder` and `*ErrorTitle` keys never end "."; `*Message`
and `*Hint` keys always end "." (`*Message` also allows "?"); a
`kindSubtitle.*` path always
ends "."; and a value shaped like a plain `"Label: {{value}}"`
fragment (no "." in the label part) never ends "." either, except the
DECISION's one named exception (`accountDetail.unsupportedCurrencyCode`,
which keeps its period on purpose — an explicit allow-list entry, not
a pattern gap). Each of these is a safe, already-verified name/path/
value-based check for its own role — unlike the Title role, a
wrongly-matched key fails LOUDLY here (an actual violation caught),
never silently exempts something from a check it should have run.
This does not re-derive the full per-key audit for every other
always-period role (option subtitles and toast/alert bodies with no
`*Message`/`*Hint` suffix have no equally reliable name/path/value
signal to check by pattern) — add a new key to the SAME role's
existing sibling keys' punctuation, by hand, per the DECISION above.

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

## Ukrainian catalogue rules — apostrophe and the app name

Two `uk.ts` rules, enforced at runtime by
`src/i18n/locales/uk.catalog-rules.test.ts` over every nested string
value (not the source text, so a template literal or a computed value
is caught too):

- The apostrophe inside a Ukrainian word must be `’` (U+2019), never
  the ASCII `'` — e.g. "п’ять", never "п'ять".
- The app name in `uk` strings is always the Cyrillic "Кіко", never
  the Latin "Kiko". English strings keep "Kiko" — this rule applies to
  `uk.ts` only.

## Review new/changed keys before a shipping deploy

Standing workflow rule: any new or changed `en`/`uk` catalogue key is
reviewed by the user BEFORE a deploy that ships it — not after. Surface
the diff for review as part of finishing the task, not as a follow-up.
