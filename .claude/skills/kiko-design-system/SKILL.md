---
name: kiko-design-system
description: Invoke when touching theme tokens, react-native-unistyles styles, any shared design-system component (Screen, LoadingState, Box, Text, MoneyText, Button, Card, GlassSurface, BottomSheet, SymbolIcon, Switch, TextField, FieldError, FieldLabel, FieldTrigger, CurrencyBreakdown, CurrencyField, SummaryTable, EntityIconTile, CardContextMenu, ConfirmSheet, ChipRow, DayOfMonthGrid, SelectField, SelectableRow, SegmentedControl, Divider — full current set at `src/design-system/components/`), the app-lock screen/gate UI, an entity/account/holding color, or an SF Symbol tintColor. Read before adding a color, spacing, typography, or radius value, before styling a new screen, and before wiring an entity color into a card, icon, or chart.
---

# Kiko design system

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Design system (started here)" section) and the token module itself,
`src/design-system/theme/theme.ts`, which ships a single `darkTheme` (spacing,
radii, typography, `colors`) plus its own entity/chart palette
(`palette.ts`). The app is dark-only. This skill states the method and
token categories; read `theme.ts`/`palette.ts` directly for the
current values rather than trusting a copy of them here.

This project skill carries domain/design knowledge. The plugin's
`design-system` workflow skill (`harness/kiko/skills/design-system/SKILL.md`)
is a separate, thin process-wrapper skill for the designer role — the
two are meant to coexist, read both.

## iOS Human Interface Guidelines (standing reference)

Kiko is a native iOS app, so Apple's iOS Human Interface Guidelines
(HIG) are the standing reference for every token, size, surface, and
control. Apply HIG on every design task, on four axes:

- **Touch targets** — every control's TAP target is at least 44pt x
  44pt, reached through `hitSlop`, never through a bigger visual: an
  approved compact look (a `small` Button, a `ChipRow` chip) keeps its
  visible size, and `hitSlop` restores the 44pt target around it. Never
  grow a control's visible height or padding to meet the floor. The one
  exception is a row whose neighbours sit too close for `hitSlop` to
  reach 44pt without overlapping the next row's target (the raw-preview
  header rows, `raw-preview.styles.ts`'s `ROW_MIN_HEIGHT`); there a
  `minHeight` on the row's own layout box is the fallback. `DayOfMonthGrid`
  is the same case in two dimensions: each cell is a real 44pt box
  around the unchanged 34pt chip look.
- **SF Symbol sizing** — a symbol reads as a peer of the text beside
  it (see `iconSizes` under "Token categories"); it scales with its
  paired type step.
- **Spacing** — from the shared `theme.spacing` scale, never a raw
  pixel value.
- **Contrast and materials/glass** — legible contrast on the dark
  theme (WCAG AA for text), and the `GlassSurface` / `BottomSheet`
  materials used per "GlassSurface" below.

The ranked, file-grounded audit of the app against these axes lives at
`docs/design/2026-09-10-ios-hig-audit.md`. Read it before a design task
to see the open findings; do not restate its findings here.

## Dark-only theme

Kiko is dark-only: there is no appearance toggle, no light theme, and
no runtime scheme switching. `src/design-system/unistyles/unistyles.ts` registers
a single `darkTheme` (`{ dark }`) with `initialTheme: 'dark'` — there
is nothing to pick between, so `adaptiveThemes` is not used either.
`UIUserInterfaceStyle = Dark` is pinned in `ios/Kiko/Info.plist`, which
is what keeps native chrome (bottom tab bar, stack headers/large-title
blur, system controls, the native date picker) on the dark appearance
regardless of the device's own OS setting — there is no
`Appearance.setColorScheme` call anywhere driving it live. React
Navigation's own native chrome uses `navigationDarkTheme`
(`src/navigation/dark-theme/dark-theme.ts`), which now sources its `colors` from
concrete dark hex values matching the design-system dark tokens
directly, rather than an OS-trait-resolving `PlatformColor` — with a
single fixed appearance there is nothing for a semantic color to
repaint in response to. Read `dark-theme.ts` directly for the exact
field mapping rather than restating it here.

`settings.appearance` (`src/db/schema.ts`) still exists as a schema
column — migrations here are additive-only, so a removed feature's
harmless column is retained rather than dropped — but it has no reader
or writer anywhere in `src/` any more; it is pinned as a documented
dead column in `src/db/settings-columns.test.ts`'s
`DOCUMENTED_READERLESS_COLUMNS` list, the same treatment as
`settings.lockGraceSeconds` (see `kiko-domain`'s "App lock / security
settings").

The dark theme itself follows the Habr method
(https://habr.com/ru/articles/499202/) for an OLED-friendly dark
theme:

- **True-black background** (`#000000`) — an OLED pixel that's fully
  off draws zero power; near-black grays don't get this benefit.
- **Desaturated accent colors** — avoid fully saturated color on a
  black background; it causes eye strain and looks harsh. Pull
  saturation down from what would look right on white.
- **Off-white primary text**, with a dimmer secondary text tone —
  not pure white. Pure white on true black causes halation (a glow/
  blur artifact around text on OLED and for some vision).
- **Elevation via translucent surface overlays**, not pure-white
  tints — a "raised" surface is true-black blended with a
  low-opacity white/gray overlay, with opacity increasing by
  elevation level, not a lighter solid gray.
- **Distinct positive and negative money colors** — a gain and a
  loss must be visually unambiguous at a glance; don't rely on a
  plus/minus sign alone once color is available.

## Token categories

Five token categories, defined once in a single theme module:

- **color** — background, surface (per elevation level), primary
  text, secondary text, accent(s), positive-money, negative-money.
- **spacing** — a scale used for all padding/margin/gap; components
  never hardcode a pixel value for spacing.
- **typography** — font sizes/weights/line-heights for the type
  scale used across screens.
- **radii** — the corner-radius scale for surfaces and controls.
- **iconSizes** — the semantic icon-size scale for SF Symbols
  (`SymbolIcon`), keyed by the same names as `typography`
  (`caption`/`body`/`heading`/`title`/`display`). Each size is its
  paired type step's `fontSize` times one fixed ratio, rounded to the
  nearest point, so a glyph stays balanced with the label beside it.
  `body` is the default `SymbolIcon` size — an icon with no explicit
  size is a body-context glyph. Read `theme.ts` for the ratio and the
  current values; never restate the numbers here. A call site passes
  `theme.iconSizes.<step>` (for example `theme.iconSizes.caption` for a
  checkmark beside caption text), never an inline literal like `18`.

Components read tokens; they never hardcode a raw color, spacing,
radius, or icon-size value inline. The same rule extends to layout: prefer a
design-system prop over an inline style whenever one exists — `Box`
has a `direction` prop, so write `<Box direction="row">`, not
`<Box style={{ flexDirection: 'row' }}>`. An inline style bypasses the
one place a layout convention is supposed to live.

**The `onAccent` rule.** Any text or icon sitting on a filled
accent/destructive BACKGROUND must use the always-white `onAccent`
color token (`theme.colors.onAccent`, `theme.ts`), never
`textPrimary` — kept as its own token, distinct from `textPrimary`,
specifically so text on a blue/red fill stays legible even if
`textPrimary`'s value ever changes; the two happen to share a value
today (both white) but that is not a guarantee to rely on. This
applies regardless of control
SIZE (`Button`'s `variantLabelColor` is derived from `variant`, not
`size`, so any `size` value gets the same token as any other for
free — read `button.component.tsx`'s current size set rather than
assuming one example here still exists) and applies
to a SELECTED icon/pill rendered on an accent fill outside `Button`
itself, not only to `Button` — `chip-row.component.tsx` and
`icon-picker-modal.component.tsx`'s selected states both switch to
`onAccent` for exactly this reason, and so does the Statistics
trend-filter sheet's selected manual-category row
(`trend-filter-field.component.tsx`'s `ManualCategoryRow`): its
selected row paints the same filled `accent` background with
`onAccent` text/icon/checkmark, REPLACING an earlier `surfaceHigh`
selected-row treatment — the same filled-accent selection vocabulary
as `ChipRow`, not a one-off. An UNCHECKED trend-filter
row keeps its own category's identity color instead: `SymbolIcon`
resolves an explicit `color` prop over its `tone` prop, so the row
passes `color={checked ? undefined : option.color}` — clearing
`color` (falling back to the `tone`-driven `onAccent`) only once
selected. A new accent-filled control
follows the same rule: read `theme.ts`'s own `onAccent` doc comment,
then one of these call sites, rather than reinventing the check.

## Styling layer: react-native-unistyles v3

`react-native-unistyles` (^3.3.0) is the styling layer. A single
Unistyles v3 theme object — the OLED `darkTheme` above — is registered
in `src/design-system/unistyles/unistyles.ts` as `themes = { dark: darkTheme }`,
with `settings: { initialTheme: 'dark' }`. There is no second theme to
switch to, so there is no `adaptiveThemes` and no runtime
`UnistylesRuntime.setTheme` call anywhere. Style components against
the theme's tokens, not literal values, so the token keys stay the one
contract every component styles against, even though there is only one
theme supplying values today. The token values live in `theme.ts`
(`darkTheme`) and `palette.ts`; read those directly rather than
restating them here.

## Locked decisions (user-approved)

Each entry is a visual the user approved. Never change or revert one —
not in a refactor, a cleanup, or a HIG pass — without the user's own
explicit approval; a change request from an agent is not approval. Add
an entry (date + value) the moment the user approves a new visual.

- **Raw-preview row height: 44pt** (2026-09-26). Every column-mapping
  raw-preview row is a real 44pt layout box (`ROW_MIN_HEIGHT`,
  `raw-preview.styles.ts`) — the one documented `minHeight` exception
  to the "hitSlop, never a bigger visual" touch-target rule above.
- **Raw preview: 5 rows from the header, with Show all / Show less**
  (2026-09-26). The preview starts AT the header row and shows 5 rows
  (`PREVIEW_ROW_COUNT`); the toggle below it expands to every scanned
  row (`HEADER_SCAN_ROW_COUNT`, 10), rows above the header included,
  and collapses back. Full contract: `kiko-statement-import`'s raw
  preview grid entry.
- **Native iOS chip/segment style** (2026-09-26). Chip: selected =
  `accent` fill + `onAccent` label, unselected = the faint
  `neutralSubtle` fill (`rgba(118,118,128,0.24)`) + `textPrimary`
  label. Segment: the `neutralSubtle` track under a `segmentSelected`
  thumb, `#747478`, with a `textPrimary` semibold label. The icon
  picker's tiles follow the chip look. See `ChipRow` and
  `SegmentedControl` under "Component set".
- **Compact chip: 34pt visible + hitSlop** (2026-09-26). Every
  `ChipRow` chip draws a 34pt `minHeight` pill with `spacing(1)`
  vertical padding at every label step, and reaches the 44pt tap
  target through `CHIP_HIT_SLOP` (`chip-row.component.tsx`, built from `CHIP_TAP_INSET`
  in `src/design-system/chip-geometry/`), never a
  taller chip.
- **Sign-colored net-worth stroke** (2026-09-26). The net-worth line's
  stroke is `positive` green at or above the dashed start reference and
  `negative` red below it, one `Polyline` per same-sign run, split at
  the fill's own crossing x — never a single fixed-color stroke. See
  `kiko-charts`' "Net-worth stroke is sign-colored per segment".
- **Paste-glyph spacing** (2026-09-26). `ClipboardTextField`'s input
  row `gap={1}` (4pt) plus the paste wrapper's
  `marginHorizontal: -theme.spacing(1)` put the glyph 12pt from the
  input and 8pt from the row's end; the `small` Button keeps its
  44pt-wide tap target. See "The paste-icon-only ghost Button
  convention" under `Button`.
- **Card titles wrap; the amount keeps its width** (2026-09-27, user
  device finding D9: a long bond name ran past the card edge and pushed
  its amount out of view). Every card or row with a user-data title next
  to an amount wraps the title the way `TransactionCard` does, never
  `numberOfLines`/ellipsis: the leading cluster (icon + title) is
  `flex: 1` with `marginRight: theme.spacing(3)`, the title sits in its
  own `flex: 1` box (`rowDescription`; a `Text` does not shrink in a row
  on its own), and the amount sits in a `flexShrink: 0` box (`rowAmount`,
  or the holding card's `valueColumn`), right-aligned at its full width.
  Short titles render exactly as before: each family keeps its own
  vertical alignment — `TransactionCard` top-aligns (`flex-start`, a
  body-size glyph), the holding-detail ledger rows stay `center`, and
  the account card (`accounts.screen.tsx` `renderAccountCard`, the main
  grid only) and the shared `HoldingCard` (also the Property and Debts
  section cards) stay
  `center` beside their taller `EntityIconTile`. The Statistics pie legend's name
  wraps in its own `legendLabel` (`flex: 1`) box beside the swatch; its
  fixed-width value/percent columns are unchanged. Rows whose label is a
  fixed short string (`SummaryTable`, the bar chart's type rows, the
  section heading rows, upcoming payments' dates) are not this pattern.
  Pinned per family by a style-contract test (`ancestorWithStyle`: the
  title's own box is `flex: 1` with no row direction, no
  `numberOfLines`). The two card tests also pin the amount's box
  `flexShrink: 0` and the lead cluster's `flex: 1`; the pie legend test
  pins its fixed-width value column instead (`width > 0`).
- **Footer "Add …" buttons lead with their entity's symbol** (2026-09-27,
  D10). Contract: "Footer 'Add …' buttons carry the entity's leading
  symbol" under `Button`.
- **Account filter rows show the account's kind glyph when it has no
  icon** (2026-09-30). The Home and Charts account filter menus show
  the same icon + color as the account card, through
  `accountIdentity`: an account with no stored icon shows its
  `accountKindSymbol` glyph in its resolved color, never an empty icon
  slot. The "All" row lines up under the glyph column:
  `filter-menu` reserves the icon slot when any option has an icon.

## UX patterns

Before acting on a UI feedback round, audit the affected screens
against this section and against how the same pattern is already
built elsewhere in the app; fix the pattern everywhere it appears, not
only the reported instance (see harness-workflow's "UI feedback
rounds: audit before fixing" — single source, do not restate its text
here).

The established patterns grouped under this heading:

- The form validation pattern — `FieldError` in "Component set" below.
- The tabs-vs-chips rule (binding) — in "Component set" below, under
  `SegmentedControl`.
- The capability-icon transparency principle — its own heading further
  down this file.
- Field placeholder and error copy — below.
- A filter never hides an active selection: a checkable filter's
  option list is scoped to the current data (e.g. the statistics
  category filter is scoped to the active date range), but a value
  the user has already SELECTED must stay listed and checked even once
  it drops out of that scope — union it back in from wherever its
  display data lives (Statistics: `categoryByKey`), rather than pruning
  the selection or letting the row vanish so the user can never find
  it to uncheck (`statistics.screen.tsx`'s
  `categoryOptions` and its twin, `trend-filter-field.component.tsx`'s
  `manualRows`, which has no display data for a hidden key and falls
  back to the bare slug as its label).
- A filter prunes a selected value only when it NO LONGER EXISTS. An
  account archived or deleted while selected leaves no checked row to
  clear it (an archived account leaves every total), so the Home and
  Statistics account filters pass the stored Set through
  `visibleSelection` (`src/design-system/visible-selection`) and filter,
  count ("Label · N") and render checked rows from the result; an empty
  result is "All". The stored Set is derived from, never rewritten. A
  value that only fell out of scope (a category outside the date range)
  is still unioned back, never pruned (the rule above).
- **SettingsRow** (`src/screens/settings/settings-row/`): `onPress`
  makes the row a `Pressable` (with a chevron). `trailing` pins an
  inline control to the label's line. The two can be combined
  (`ReminderRow`: tap opens the form, the trailing Switch pauses).
  Vertical alignment (2026-09-30, user requests): a chevron with no
  `trailing` sits on the label's FIRST line; a `trailing` control (a
  Switch) is centered on its label (the header's `headerWithTrailing`,
  for example the export-data include-secrets row; user request "Center
  Face ID setting toggle vertically to its label too.", extended to
  every Settings switch row app-wide by coordinator ruling 2026-09-30
  (apply repeated feedback app-wide; the coordinator's brief: "check
  other Settings switch rows for the same defect and fix every
  instance")); a pressable row with `children` (a
  body under the label, for example `ReminderRow`; the rule is the
  `onPress` + `children` branch in `settings-row.component.tsx`)
  centers the control and chevron on the label and body together, as a UIKit cell centers its accessory view; the body then
  wraps beside them instead of running under the switch. **Locked
  (2026-09-30, user request "Increase horizontal gap between a toggle
  and >."):** a chevron after a `trailing` control carries a
  `spacing(1)` left margin (`chevronAfterTrailing`,
  `settings-row.styles.ts`); a chevron after a plain label has none.
  **Locked (2026-09-30, user request "Increase the gap between
  reminder's title and description."):** on a pressable row with
  `children` the label and body sit `spacing(1)` apart, the same gap
  as between `ReminderRow`'s own caption lines.
  **Rule:** on iOS an accessible `Pressable` groups its children into
  ONE VoiceOver element, so a control inside a pressable row cannot be
  reached. A row that passes both `onPress` and an interactive
  `trailing` must give the row itself the control's
  `accessibilityValue`, plus an `accessibilityActions` entry and
  `onAccessibilityAction` for it (see `pauseAccessibility` in
  `reminder-row.component.tsx`). The props type enforces the two action
  props: `SettingsRowProps` is a union, so a row with both `onPress` and
  a `trailing` does not compile without `accessibilityActions` and
  `onAccessibilityAction` (the `accessibilityValue` stays a review
  item). Build the switch and its actions in ONE object and spread it
  (`reminder-row.component.tsx`'s `NO_SWITCH` fallback shows why the
  fallback is not `{}`). RNTL `getByLabelText` still finds the
  inner Switch, so a green test does not prove VoiceOver can reach it;
  list a device check.
- **Header bar items** (2026-09-30, user request: the bell separate
  from Edit). iOS 26+ draws adjacent bar button items in ONE shared
  glass capsule, and the HIG (Toolbars, "Item groupings") warns that
  items grouped in one shared capsule read as one control — two glyphs
  in one capsule look like a single combined action, so the bell keeps
  `sharesBackground: false` and gets its own capsule. Every header
  action is a native `type: 'button'` item in `unstable_headerRightItems`,
  listed left to right: `icon: { type: 'sfSymbol' }`, `label` and
  `accessibilityLabel` from the same i18n key, `tintColor:
  theme.colors.textPrimary`, `sharesBackground: false`. Never a
  `type: 'custom'` item or `headerRight` with a React view for a header
  action: UIKit sizes a native item's glyph, capsule, and 44pt target;
  a React view inside a custom item gets a different glyph size and
  capsule, so it does not read as the same kind of button as its
  neighbour. Do not use a `type: 'spacing'` item to split items:
  native-stack 7.18.9 sends it with no index, so react-native-screens
  inserts it at the trailing edge. A native item takes no `testID`; a
  test reads the item list from `setOptions` and calls its `onPress`.
  Consumers: `AccountDetail` (bell, then Edit), `HoldingDetail` (for a holding of the Property or Loans account, that account's stored icon, else its kind glyph from `accountKindSymbol`, which opens `AccountForm` for edit, then Edit; any other holding shows Edit only). A native item types its SF Symbol `name` as the symbol catalogue's union, so the stored icon goes through `accountHeaderSymbol` (`src/holdings/account-header-symbol/`): it narrows to a known name (`accountIconPool` from `src/holdings/entity-icon-pool/`, the very list the AccountForm picker offers, plus the category pool in `@kiko/design-system/components/icon-pools`, a pools-only unit apart from the picker modal, plus the two implicit kind glyphs, proved members of that union by the `Set<HeaderSymbol>` element type; a test over `accountIconPool` keeps the picker and the guard in step) and falls back to the kind glyph for any other string (a restored .kiko), because UIKit draws no image for an unknown name.
  The pre-write guard enforces both bans: Semgrep
  `kiko-header-item-native-only` denies a `headerRight`/`headerLeft` value
  other than `undefined` (a `StyleSheet.create` style and a destructuring
  read of the options are not header values) and a `type: 'custom'` item
  in either header item list, and `kiko-no-header-spacing-item` denies a `type: 'spacing'` item in either
  list (`rules/semgrep-prewrite.yml`).
- **Edit is an icon-only native bar item** (2026-09-30, locked). The
  user: "One last thing before LGTM: remove 'Edit' label from
  account/holding edit button", then, on device: "'Edit' button
  should've become an icon button with the label removed." Build it
  with `editBarItem({ label: t('common.edit'), tintColor, onPress })`
  from `@kiko/design-system/edit-bar-item`: the `pencil` SF Symbol
  (iOS 13+) as a native `type: 'button'` item, the same kind as the
  bell. `label` does not show as text in the header: native-stack maps it to the
  `UIBarButtonItem`'s `title`, and UIKit draws only the image in the bar
  when an item has both (the bell carries the "Reminders" label and shows
  no text on device). The title still shows as text in the system overflow
  ("More") menu when the bar is too narrow, and in the Large Content Viewer
  (a long-press at the largest accessibility text sizes). It is also the
  VoiceOver name ("Edit" / "Редагувати"). So never drop or empty `label`:
  a bar item without it is nameless in all three places. This overrides
  the HIG Toolbars default ("Prefer simple, recognizable symbols for
  items instead of text, except for actions like edit that aren't
  well-represented by symbols") by the user's explicit choice. A test
  asserts the item list has a `pencil` item labelled "Edit" whose
  `onPress` opens the edit form, and no `type: 'custom'` item.
- A field's own Connect (`MonobankConnectField`, `BinanceCredentialsField`,
  `WalletAddressField`, `src/design-system/components/`) is a PRIMARY
  action, so it follows the same form validation model as a Save
  button: always enabled, never `disabled={... || field.trim() ===
  ''}`. A blank required field shows its own `*RequiredError` message
  (via the field's `error` prop) on a Connect press instead —
  `disabled` stays reserved for the field's own
  in-flight `status.kind === 'checking'`.

## Field placeholder and error copy

A placeholder never repeats its own field's label — enforced, not
just convention: `placeholder` is a required prop on `DateField`,
`TimeField`, `ColumnSelectField`, and `SelectField`, so a caller must
supply distinct wording rather than default to the label text. The
established placeholder copy is "Select a …" for a picker/select
field.

A picker/select field's error message takes the "No X selected." form
(Ukrainian: "X не вибрано.") — never a synonym of the placeholder's
own verb ("choose", "pick"). Read these live keys for the exact
current wording rather than trusting a copy of it here — a new field
adds its own key alongside them, in this same form:
`columnMapping.*ColumnError` (`src/i18n/locales/en.ts`,
`src/i18n/locales/uk.ts`), `statementImport.chooseHoldingError`,
`forms.holding.loanStartDateError`,
`forms.holding.couponFrequencyRequiredError`.

A numeric field's unit goes in `TextField`'s `suffix`, never in its
label — "Annual rate" with a `%` suffix, not "Annual rate %" — so the
label never doubles the unit the field already shows. Currency fields
pass the currency glyph; every other unit is a `forms.units.*` key
(read `forms.units` in `src/i18n/locales/en.ts` for the current set; do
not copy it here). A unit shown beside a number the user types is a
PLURAL key, and `t()` gets that number as `count`, so the unit agrees
with it: `forms.units.days` via `everyDaysPluralCount`
(`src/reminders/rules/reminder-draft.ts`) gives "1 day / 7 days" and
"21 день / 2 дні / 5 днів". An empty or non-whole value gives count 0,
the form with no number (en "days", uk "днів"). A metal quantity follows
its own unit (`metalUnitSuffix`, `src/screens/forms/metal-unit-suffix/`,
shared by the create form and the Lot form); a field whose holding has
no unit passes none. `fieldSuffix` (`src/test-support/field-suffix.ts`)
reads which unit a given field shows in a test.

## Calendar week start

`KikoCalendar` (`src/calendar/kiko-calendar/`) starts its week on the
DEVICE REGION's first weekday, like a native iOS calendar app — NOT
the app language. `weekStartFor(region)`
(`src/calendar/week-start/`) maps a 2-letter region code to `0`
(Sunday) or `1` (Monday) off the FULL current CLDR `weekData/firstDay`
Sunday-first territory list (unicode-org/cldr-json,
cldr-core/supplemental/weekData.json — see the constant's own doc
comment for the source URL and check date); every other region —
including Ukraine and Kiko's European host countries, AU (Monday-first
as of CLDR-14795, ~v40), and an unresolved region — falls back to
Monday, CLDR's own default. It takes
the region as a plain argument rather than reading it itself, so it
stays a pure, directly unit-tested mapping; `deviceRegion()`
(`src/i18n/device-region/`) is the actual device read, a dependency-free
iOS-only `NativeModules.SettingsManager.settings.AppleLocale` parse —
the sibling of `deviceLanguage()`'s `AppleLanguages` read, but a
DIFFERENT NSLocale API (region, not display language) and a different
identifier format (underscore-joined ICU style, not dash-joined
BCP-47). `CalendarHeader`'s own weekday-label row rotates through the
SAME `firstDay` prop react-native-calendars forwards to it, so the
labels never drift out of alignment with the day grid, which the
library rotates internally off the identical prop.

The `weekStartFor` table now follows current CLDR `weekData` (source
URL and check date in the constant's own doc comment). Hermes's
`Intl.Locale().weekInfo` (a dependency-free ALTERNATIVE this skill
considered and rejected — Node/V8 supports the `weekInfo` getter, but
Hermes device support is unverified, and RN's Jest preset cannot tell
either way) stays unverified, with no primary source, which is why the
table path is kept. The remaining device-unverified point is only
`deviceRegion()`'s `AppleLocale` format — a wrong table entry only ever
misorders the calendar's cosmetic Sunday/Monday column choice, never a
financial figure.

### Calendar import path

`KikoCalendar` imports `Calendar` by its deep path, the package's default
export there:

```ts
import Calendar from 'react-native-calendars/src/calendar';
```

Never value-import from the package root (`import { Calendar } from
'react-native-calendars'`). The root re-exports every component (Agenda,
CalendarList, ExpandableCalendar, the timeline), and Metro does not
tree-shake, so one root value import ships all of them. The root pulls
about 704 K of lodash source, 219 K of the package, 172 K of moment, and
137 K of recyclerlistview. The deep path pulls 144 K of lodash and 60 K
of the package, with no moment and no recyclerlistview.

A type-only import from the root is fine, because Babel erases it:
`import type { DateData, CalendarProps } from 'react-native-calendars';`
(for example, `kiko-calendar.props.d.ts`). A mixed import
with an inline `type` modifier (`import { LocaleConfig, type DateData }`)
is a value import and is not allowed.

Jest: the manual mock `__mocks__/react-native-calendars/src/calendar.tsx`
renders the deep `Calendar` as a plain `View` that keeps every prop, so a
test reads `testID`/`markedDates` and calls `onDayPress` directly.
The mock needs no `jest.config.js` change. The `jest.mock` in
`jest/setup.js` covers only the bare root specifier.
`kiko-calendar.day-cell-color.test.tsx` deep-imports the real day
renderers, and neither mock intercepts them.

Enforced by the `kiko-no-root-calendars-value-import` pre-write guard
rule (Semgrep, ERROR). It flags any root `import`/`export ... from`, a
bare root side-effect import, and `require()` or dynamic `import()` of the
root, but lets `import type`/`export type` through. Test files are
excluded, because Jest never bundles.

## Component set

Every shared component here follows `kiko-code-style`'s "One component
per file, each in its own folder" rule — read it there, not restated
here.

The primitive set has grown well past the original four. This is the
real set — enumerated at `src/design-system/components/`; read that
directory listing directly rather than trusting a copy of it here, a
new component can land between reviews of this skill:

- **Screen** — the top-level screen container: true-black background,
  safe-area handling per mode (`scroll` drops the top safe-area edge
  under a large-title header), and a footer slot that clears the
  native glass tab bar's measured height. A `bleedBottom` child that
  owns the screen's true bottom edge itself (e.g. a scrollable list)
  must compute that same clearance with the shared
  `resolveBottomClearance(tabBarHeight, insetBottom)` helper exported
  from `src/design-system/components/screen/bottom-clearance.ts` —
  never re-derive it inline, or it double-counts the bottom safe-area
  inset Screen's `SafeAreaView` already reserves. Its `scroll`
  ScrollView is also the tab-root scroll container an active-tab
  re-tap returns to the top, where `HeaderHeightContext` is the LIVE
  header height — see
  `src/navigation/use-scroll-to-top-on-tab-press/use-scroll-to-top-on-tab-press.ts`, which targets
  the tracked expanded height rather than a live height plus a band.
  Settings' About block (app name/version, copyright, links) is an
  EXCEPTION to the ordinary "use `footer` only for a pinned
  always-reachable action" rule: it renders through the pinned
  `footer` slot even though it is not an action, because App Store
  Guideline 5.6 review needs it reachable without scrolling. There is
  no `fillHeight` prop — a screen whose content
  is shorter than the viewport just leaves it top-anchored; nothing in
  this codebase pins non-footer content to the bottom.
- **LoadingState** (`src/design-system/components/loading-state/`) —
  the shared "this screen's own data has not loaded yet" visual: a
  plain centered native `ActivityIndicator`, no text at all — a
  spinner needs no i18n string, so a `useDataReady` consumer
  (`kiko-architecture`'s useLiveQuery consumer rule) gating its whole
  render, or a single component gating one value inside an
  already-loaded parent (e.g. statement-import's
  `example-transaction`), never has to add one. Takes an optional
  `testID`, conventionally `<screen>-loading`. The spinner itself is
  delayed by `SPINNER_DELAY_MS` (200ms): the container (the plain
  background) renders immediately, but the `ActivityIndicator` only
  mounts once the delay elapses, so a screen whose first read resolves
  quickly (the common case, off the local op-sqlite worker) never
  flashes a spinner at all — readiness (`useDataReady`) itself is
  never delayed, only the visual spinner.
- **Box** — a generic layout container reading spacing/color/direction
  tokens (padding, gap, background, `direction="row"`).
- **Text** — the base text primitive reading the typography and tone
  color tokens; other text usage composes on top of this. Its `style`
  prop intentionally EXCLUDES `color` so the `tone` token stays
  authoritative — a tappable inline link (the pie legend's "Show all"
  toggle) uses `tone="accent"` (systemBlue), never an inline color;
  read `text.props.d.ts`/`text.styles.ts` for the current tone set.
- **MoneyText** — formats a `Money` value (see `kiko-domain`) and
  applies the positive/negative/neutral money color token from its
  sign. This is the only primitive that knows about `Money` — plain
  `Text` never receives a `Money` object directly.
- **Button** — the one action button: primary/secondary/secondaryTonal/
  destructive/destructiveTonal/ghost variants (read
  `button.props.d.ts`'s `ButtonVariant` for the exact current set
  rather than trusting a copy of it here — it grows), an optional
  leading/trailing SF Symbol icon tinted to a single fixed color
  regardless of variant. `fullWidth` defaults to `true`: pass it only
  as `fullWidth={false}`, never `fullWidth` or `fullWidth={true}`
  (Semgrep `kiko-no-redundant-button-full-width`,
  `rules/semgrep-prewrite.yml`). `destructiveTonal` is the iOS "tinted
  destructive" pattern — a translucent `negativeSubtle` fill under a
  red `negative` label (a lower-emphasis dangerous action, e.g. the
  deposit form's per-row Remove and the categories screen's per-card
  Delete — the two now share the IDENTICAL treatment: `destructiveTonal`
  + `size="small"` + a leading trash icon, so Delete reads as the same
  control as Remove everywhere it appears), NOT the solid bright
  `negative` fill of `destructive`. `secondaryTonal` is its NEUTRAL
  counterpart — a faint neutral tint from the `neutralSubtle` theme
  token (`theme.ts`, sibling of `negativeSubtle`) under an ordinary
  `textPrimary` label — the standard treatment for a lower-emphasis
  inline/standalone secondary action (e.g. the categories screen's
  "Set as default" star), replacing a plain `secondary` `surfaceHigh`
  pill for that class of control. Both tonal variants are the exception
  to the `onAccent` rule below: a same-hue (or neutral) label on a
  same-hue tint is the tinted-button convention, so the label stays
  `negative` or `textPrimary`, never `onAccent`. The label has no
  `textTransform`: each catalogue supplies its own casing (English
  Button copy is sentence case; Ukrainian already is) — there is no
  style-layer transform and no per-language gate.
  **`loading` — an in-flight write.** `loading` shows a native
  `ActivityIndicator` (in the label color) over the button's label and
  icons, which stay laid out but invisible (`hiddenContent`,
  `button.styles.ts`), so the button keeps EXACTLY its resting size; it
  ignores presses and reports `accessibilityState.busy`, and is NOT
  dimmed like `disabled` (the spinner already says why). A button whose
  press awaits a slow write (the transaction form's category-override
  sheet: Apply and "Just for this one") passes its `useSubmitOnce`
  `isSubmitting` as `loading`, and the surface it sits on stays open
  until the write is done — never a hand-rolled spinner beside a button.
  `loading` alone blocks the presses, so a button that passes both props
  drops `disabled` while `loading` and is not dimmed then. Any other submit
  keeps it `disabled` (dimmed).
  The shared `DISABLED_OPACITY` token
  (`src/design-system/disabled-opacity/disabled-opacity.ts`) is the ONE dimming a disabled
  pressable applies — `Button` reads it, and any new disabled pressable
  reuses it too, never a fresh inline `opacity`. `children` is OPTIONAL:
  an `icon` (or `trailingIcon`) with no `children` renders an ICON-ONLY
  button (the label text node is omitted so the icon is not pushed off-center
  by the label gap). An icon-only button MUST pass an `accessibilityLabel`,
  since it has no visible text for VoiceOver — this is ENFORCED, not just a
  convention: `ButtonProps` is a discriminated union (labelled vs icon-only),
  so `<Button icon="star" onPress={...} />` with no label is a COMPILE error,
  and a `__DEV__` runtime invariant in the component throws on the same shape
  for any untyped call path. This is the shared icon-only control pattern
  — the categories screen's move-to-top/move-to-bottom reorder actions
  (`variant="ghost"` + `size="small"`) and its "Set as default" star
  (`variant="secondaryTonal"` + `size="small"`, `src/screens/settings/
  categories/`) both build an icon-only control this way, plus
  `fullWidth={false}`, rather than a raw `Pressable` + `SymbolIcon`.
  (There is no separate `IconButton` primitive; the old one at
  src/design-system/components/icon-button/ was deleted when its only
  consumer went away.)

  **Three pinned button treatments, mechanized (`rules/semgrep-prewrite.yml`):**
  the account-detail Sync button ("accountDetail.syncNow") and Change bank
  button ("accountDetail.changeBankAction") are both pinned to
  `variant="secondaryTonal"` everywhere (`kiko-pinned-sync-button-variant`,
  `kiko-pinned-change-bank-button-variant`); every sheet's Cancel button
  ("common.cancel") is pinned to `variant="ghost"` AND
  `textColor={theme.colors.negative}` together, one red ghost Cancel
  everywhere (`kiko-pinned-cancel-button-style`, the
  `confirm-sheet.component.tsx` shape). A pre-write-guard deny on any of
  these three points back here.

  **Footer "Add …" buttons carry the entity's leading symbol**
  (user-approved, D10). Same shape as account detail's "Import
  statement" (`icon="doc.badge.plus"`): ONLY the `Button` `icon` prop —
  no size/tint/spacing override, no new variant. The mapping, each read
  from its one source (never a re-typed string; read the symbol names
  in `src/holdings/entity-symbols/entity-symbols.ts`): Add holding /
  account / category / transaction → `genericEntitySymbol.<entity>`;
  there is no "Add loan" footer: a loan is added through the implicit
  account's create flow, and account detail's footer is always "Add
  holding" with `genericEntitySymbol.holding`;
  Add lot → the holding's OWN type glyph (`holdingTypeSymbol[holding.type]`),
  never a fixed type's; Add contribution →
  `calendar.badge.plus` (the one call-site literal). "Update value" /
  "Update outstanding" add no entity, so they stay text-only. An
  iOS-26 generic glyph has its fallback in `genericEntitySymbolFallback`
  (`entity-symbols.ts`) and SymbolIcon's central map
  (`symbol.availability.ts`); read them there. A new footer
  "Add …" action takes its entity's glyph the same way.

  **Sizes — `regular` / `compact` / `small`** (read `button.props.d.ts`'s
  `ButtonSize` for the exact current set). `regular` is the 50pt tall
  footer/submit CTA. `compact` is a shorter inline action that still
  holds a 44pt minimum VISIBLE height — the iOS HIG touch-target floor
  met by the pill itself, no `hitSlop` needed or applied. `small` is
  DELIBERATELY SHORTER still: its visible height is `SMALL_MIN_HEIGHT`
  (34pt, `button.styles.ts`), below the 44pt floor on purpose, so it
  reads as clearly smaller than `regular`/`compact` — the 44pt HIG tap
  target is then restored via `hitSlop` (`SMALL_HIT_SLOP`,
  `button.component.tsx`, applied only when `size === 'small'`), not by
  the visible pill's own height. **This supersedes any older guidance
  that a compact/inline button should "never use hitSlop" — `small`
  exists specifically to pair a short visible pill with a `hitSlop`-
  restored 44pt tap target, by design, not as a shortcut.** Pick
  `compact` when the visible pill itself should still read close to
  full HIG height; pick `small` for the tightest inline/secondary
  actions, typically paired with `secondaryTonal` or `destructiveTonal`
  (the categories screen's Delete, "Set as default", and reorder
  controls above are all `size="small"`). Read `button.styles.ts` and
  `button.component.tsx` directly for the current height/hitSlop
  values rather than trusting a copy of the numbers here if they ever
  drift.

  **The paste-icon-only ghost Button convention.** A field that reads
  the system clipboard (the Monobank token entry, both legs of the
  Binance API key/secret entry, the crypto wallet-address field —
  `src/design-system/components/monobank-token-input/`,
  `binance-credentials-field/`, `wallet-address-field/`) pairs its
  `TextField` with an icon-only trailing `Button`:
  `variant="ghost"`, `size="small"`, `fullWidth={false}`,
  `icon="document.on.clipboard"`, `textColor={theme.colors.textSecondary}`,
  and a translated `accessibilityLabel` (VoiceOver has no label text to
  read otherwise, per the icon-only rule above). The ONE place that
  builds this row is `ClipboardTextField`
  (`src/design-system/components/clipboard-text-field/`) — every paste
  field (including Settings' import-data key field) goes through it, so
  a new paste affordance reuses it rather than re-pairing a `TextField`
  and a `Button`. Its spacing is a compact icon-button spacing: the
  input row's `gap={1}` (4pt) plus the paste wrapper's
  `marginHorizontal: -theme.spacing(1)` (`clipboard-text-field.styles.ts`'s
  `pasteButtonWrapper`) put the glyph 12pt from the input and 8pt from
  the row's end, while the `small` Button keeps its own 44pt-wide tap
  target (starting exactly at the input's edge, never overlapping it) —
  the visual spacing shrinks, never the tap target.
- **Card** (`src/design-system/components/card/`) — the shared
  CONTENT-layer surface: a solid, opaque themed fill with a defined
  hairline border, no glass/blur material at all. Every content card,
  list row, and chart container that used to be a neutral (non-tint)
  `GlassSurface` now renders through this component instead — read
  its header comment (`card.component.tsx`) for the HIG rationale
  (Liquid Glass is reserved for the NAVIGATION layer, not content).
- **GlassSurface** — the shared NAV-LAYER surface only: the tab bar,
  bottom sheets, the FAB, and the keyboard-done accessory (grep
  `<GlassSurface` for the current consumer list; content cards use
  `Card` above instead). Real Liquid Glass on iOS 26+, a themed flat
  fallback everywhere else, an optional `bordered` edge, and
  neutral/tinted variants of the backdrop under the glass. A `tint`
  (an entity card, e.g. the FAB) paints an OPAQUE `surface` backdrop
  and an entity-color wash — see "Entity color and tint" below. A
  `transparent` variant paints a TRANSLUCENT
  `surfaceTranslucent` backdrop and no wash, so the screen behind reads
  through while the drift/pop-in stays softened; a `tint` always wins
  over it. `transparent`/`bloom`/`material` are NAV-LAYER variants now
  — a new CONTENT surface (a settings row, a chart card, a summary, a
  list row) is `Card` above, not `GlassSurface transparent`; an entity
  card (account, holding) keeps `GlassSurface`'s opaque `tint`. The
  historical detail below (the categories-screen `bloom` bug, the
  `CardContextMenu`/BottomSheet consumers) predates the `Card`
  migration and documents `GlassSurface`'s own variant mechanics —
  read it for how `transparent`/`bloom`/`material` behave, not as a
  current list of content-card consumers. A list row wrapped in
  `CardContextMenu` (the holding-detail ledger's manual-transaction
  rows — see `CardContextMenu` below) takes `transparent bloom` too;
  there is no swipe-reveal layer to clip a radius around any more — the
  app's one swipe-to-delete row, `SwipeableRow`, was removed in favor of
  the touch-and-hold context menu. Neither prop keeps the fully-live see-through material (no
  backdrop). A fourth variant, `material`, is `transparent`'s sibling for a
  surface whose backdrop is STATIC while shown (BottomSheet is the first
  consumer): it keeps the fully-live see-through glass on the glass path
  (no backdrop at all, so the material samples the real content behind it —
  a true blur, not `transparent`'s partially-pinned sample) but, unlike a
  plain surface, still takes a TRANSLUCENT (not opaque) fallback fill on the
  non-glass path, so a device without Liquid Glass reads see-through too. The
  Home transaction row is a SECOND consumer that does NOT meet the static-
  backdrop condition (it is a scrolling list card, so its live sample drifts
  in lightness on scroll) but takes `material` anyway per an explicit product
  decision to match the sheet's look, knowingly accepting that drift over
  `transparent`'s partial pin — so the static-backdrop rule is the default
  guidance, not an invariant. A `tint` wins over `material` the same way it
  wins over `transparent`. Read
  `glass-surface.props.d.ts` for the exact current prop set rather than
  trusting this summary if it drifts.

  **`bloom`'s first-paint re-sample.** `bloom` (see the prop's own doc)
  opts a neutral surface into maximum live-sampling: on the real glass
  path it renders a `LiquidGlassView` with NO backdrop under it and
  `effect="clear"`. A `'clear'`-effect glass samples its backdrop exactly
  once, at native layout — there is no imperative re-sample API. Confirmed
  2026-09-12: the categories screen's category card (`transparent bloom`,
  a `react-native-sortables` `Sortable.Grid` item) rendered fully
  transparent on first paint on iOS 26+, because Sortable MEASURES an item
  first and only then transform-repositions it — the glass's one-shot
  sample fired during that measure pass, before the transform landed, with
  nothing solid behind it yet. Dragging the card "fixed" it only because a
  drag teleports the card into a portal, which remounts a fresh
  `LiquidGlassView` already in its real position. The Statistics
  account-contribution pie card (also `transparent bloom`) never showed
  this, because it is a plain `<Screen scroll>` child that lays out once,
  already in its final spot — the same combination of props, two different
  layout containers, only one of them broken. `GlassSurface` now
  compensates for this ITSELF, generically, for every `bloom` consumer: a
  one-time, two-`requestAnimationFrame`-deferred remount
  (`needsResample`/`remountToken`/`hasResampled` in the component) forces
  a fresh native `LiquidGlassView` after the surface has settled into its
  real on-screen position, whatever container placed it there. This is
  transparent to a consumer — nothing about writing `<GlassSurface
  transparent bloom>` changes — and `bloom`'s own documented no-backdrop/
  `'clear'`-effect semantics are unchanged; only the shared component
  gained a compensating one-shot re-sample. A `bloom` surface that is
  itself STATIC and never re-triggered by anything else (a settings card,
  a chart card, a list row) no longer needs a scroll/drag/animation to
  become visible — the fix lives in `GlassSurface`, not in any consumer's
  layout choice.
- **BottomSheet** — the one bottom-sheet primitive: a transparent
  `Modal`, a full-bleed dismiss scrim, and a bottom-anchored sheet
  card owning its own safe-area-aware bottom padding. Every sheet in
  the app routes through this rather than hand-rolling
  `Modal + backdrop + Box` again. The sheet card's own BACKGROUND is a
  real translucent blur MATERIAL, reusing `GlassSurface`'s `material`
  variant — a live-sampling Liquid Glass on iOS 26+ (no color-pinning
  backdrop under it, so the sheet reads as an actual blur of the
  content behind it, not a near-opaque flat panel), the same themed flat
  translucent (`surfaceTranslucent`) fallback elsewhere — rather than
  forking its layering — real glass/fallback branching, backdrop, and
  base all stay owned by `GlassSurface` itself. `material` is
  `transparent`'s sibling variant for a surface whose backdrop is STATIC
  while shown (a modal sheet): `transparent` instead pins a translucent
  backdrop under the glass to soften lightness drift on a scrolling
  CARD, a concern that does not apply to a static sheet, so a modal
  sheet takes the live-sample `material` variant instead — read
  `glass-surface.props.d.ts`'s `material` doc for the exact distinction
  and the constant-token doc comment on `theme.colors.scrim` in
  `theme.ts` (lowered 0.55 -> 0.4 alongside this change, since the sheet's
  glass now samples that same scrim). It is rendered as an
  absolutely-positioned first child of the sheet card
  (`bottom-sheet.styles.ts`'s `glassFill`), painted BEHIND the grabber
  and body that follow it in JSX. Since this is the ONE shared
  primitive, every sheet in the app gets the glass background from this
  single change point. `GlassSurface` only exposes a single ALL-corner
  `radius` (there is no top-only variant); the sheet still needs to read
  as top-rounded / bottom-flush (anchored to the screen's bottom edge),
  so `glassFill` deliberately sizes the `GlassSurface` `theme.radii.lg`
  taller than the card, past its own bottom edge — the card's own
  `overflow: 'hidden'` (added for exactly this) then clips away the
  region where `GlassSurface`'s bottom corners would otherwise curve,
  leaving a flat bottom edge and correctly-rounded top corners rather
  than a small gap leaking the dismiss scrim through the bottom
  corners. `GlassSurface`'s own `padding` prop is passed `0` on this
  layer — the card's EXISTING padding (`styles.sheet`'s
  `SHEET_PADDING_STEP`) stays the single inset, never stacked with a
  second one. The sheet is still a GROUPED surface: this translucent
  base (composited to ~rgb(17,17,18) over true-black — darker than
  `surfaceHigh` #2C2C2E) sits one level BELOW the cards/controls on
  it, so a control reads as raised instead of blending into the sheet
  (a chip or segment on it uses the faint `neutralSubtle` fill — see
  `ChipRow` and `SegmentedControl` below) — it used `surfaceHigh`
  itself before, then a flat opaque `sheetBackground` token before this
  glass pass. It caps
  its own height at a fixed 66%-of-window ceiling and takes an optional
  `maxHeight` prop that can only tighten that cap further, plus a
  `scrollable` prop (defaults `true`) that wraps `children` in a
  `ScrollView` so overflow scrolls instead of clipping — a sheet that
  needs its own pinned header/footer or a scroll-to-selection ref
  (date-range-field, category-field, icon-picker-modal) passes
  `scrollable={false}` and renders its own inner `ScrollView` instead.
  Its drag-to-close grabber's pure math (`clampSheetTranslate`,
  `shouldDismissSheet`) lives in `bottom-sheet.gesture.ts` — see
  `kiko-gestures`. Read `bottom-sheet.props.d.ts` for the exact current
  prop set rather than trusting this summary if it drifts.

  **`onDismiss` vs `onClosed` — a close-timing contract, not two names
  for the same event.** `onDismiss` fires the moment a close is
  REQUESTED (a scrim tap, or a hardware/gesture back); `onClosed`
  (optional) fires only when the underlying RN `Modal` reports its OWN
  `onDismiss` — the close ANIMATION has actually finished (iOS only; RN's
  `Modal` never fires it on Android). Anything that must not run until
  the sheet is visually gone — most importantly navigating the screen
  away — belongs on `onClosed`, not `onDismiss`: wiring a screen
  navigation to `onDismiss` pops the sheet mid-animation. Read
  `bottom-sheet.props.d.ts`'s `onDismiss`/`onClosed` doc comments as the
  source of truth. Separately, the `testID` prop produces a
  `${testID}-modal` hook on the underlying RN `Modal` itself
  (`bottom-sheet.component.tsx`), distinct from the separate
  `backdropTestID` prop, which names the dismiss-scrim `Pressable` (e.g.
  a filter menu's `${id}-backdrop`) — don't conflate the two when wiring
  a sheet's test hooks.

  The full-bleed dismiss SCRIM (a sibling of the sheet card, not the
  card's own `glassFill` above) is a SEPARATE Liquid Glass layer with a
  DEVICE BUG fix of its own: Liquid Glass draws a native specular rim at
  the edge of whatever bounds it is given (a `UIGlassEffect` property,
  not a border/inset this app draws), which at the scrim's original
  exact-screen-size bounds landed on the screen edge and read as a sharp
  1px hairline around the whole perimeter, on every Modal (all route
  through this one scrim). The fix keeps the live blur (never drops to a
  flat dim) and instead extends `styles.backdropFill`'s own bounds past
  all four screen edges by `BACKDROP_RIM_OVERSCAN` (32pt,
  `bottom-sheet.styles.ts`) — the Modal's native window still clips at
  the real screen edges regardless, so the overscan only relocates where
  the now off-screen rim falls, leaving nothing but uniform blur visible.
  The rim is only reproducible on an iOS 26+ Liquid Glass device, never
  in the simulator or a unit test — any future scrim-sizing change here
  needs on-device confirmation, not just a green test suite.

  The grabber region (`styles.grabberRegion`) also floors at
  `GRABBER_REGION_MIN_HEIGHT` (44pt, the HIG touch-target minimum) via
  `minHeight` rather than a `hitSlop` — a header-less sheet's region
  used to measure only ~21pt (padding + the 5pt pill, no header sibling
  to fill it out), under the 44pt floor with nothing to compensate.
  `minHeight` grows the region's OWN claimed bounds (still fully inside
  `grabberRegion`, still draggable) rather than expanding the Pan's
  hit-test area past that View's edges the way `hitSlop` would, so the
  fix can never bleed into the scrollable body that starts only once the
  region ends — see "Touch targets" under the standing HIG reference
  above for the general rule this follows.

  **Keyboard-aware sheet geometry.** A sheet whose content includes a
  focusable input (e.g. `CurrencyField`'s search) must not let the
  keyboard cover its own content or the floating keyboard accessory —
  `bottom-sheet.keyboard.ts` (`src/design-system/components/bottom-sheet/`)
  holds the pure, worklet-tagged math this needs: `resolveKeyboardLift`
  (how far the sheet rises — the keys' own height, not the raw keyboard
  frame), `resolveKeyboardAwareMaxHeight` (the 66% height cap re-measured
  against the currently-visible window once the keyboard has lifted the
  sheet), and `resolveKeyboardAwareBottomPadding` (the sheet's bottom
  padding while the keyboard shows, so its own glass — not the modal
  scrim — sits behind the floating accessory strip). `bottom-sheet.
  component.tsx` wires all three into its `useAnimatedStyle` alongside
  `KEYBOARD_ACCESSORY_HEIGHT` (`keyboard-done-accessory.styles.ts`, the
  accessory's fixed height) and its own `KEYBOARD_CORNER_OVERLAP`
  constant (extends the lift/padding pair to also cover the keyboard's
  rounded top corners). Every one of these functions carries its own
  `'worklet'` directive since `useAnimatedStyle` calls them directly —
  see `kiko-gestures`'s "Every function called inside a worklet needs
  its own `'worklet'` directive" rule before touching any of them, and
  read the file directly for the current derivation rather than trusting
  the numbers restated here; they drift with each device-feedback round.
  All three reduce to a no-op with no keyboard shown, so every
  keyboard-less sheet consumer sees no layout change. Reanimated's own
  `useAnimatedKeyboard()` is NOT used to drive any of this — see
  `kiko-gestures`'s "`useAnimatedKeyboard()` is banned" rule.

  **A scrollable list inside a sheet that can host a keyboard needs
  `keyboardShouldPersistTaps="handled"`.** A `FlatList`/`ScrollView`'s
  default `keyboardShouldPersistTaps` ("never") swallows the FIRST tap on
  a row while the keyboard is up — the tap dismisses the keyboard instead
  of hitting the row. `CurrencyField`'s search results list
  (`currency-field.component.tsx`) sets `keyboardShouldPersistTaps="handled"`
  for exactly this reason (the same fix `Screen`'s own background
  `ScrollView` applies for its search field, per that file's comment); any
  new sheet content that combines a focusable input with a tappable list
  below it needs the same prop.
- **SelectableRow** (`src/design-system/components/selectable-row/`) —
  the shared single-select row for a `BottomSheet` list: a 44pt-minimum
  tap target that fills with the accent background when `selected` (the
  `ChipRow` selection vocabulary), with a leading checkmark
  slot, an optional leading `icon` (SF Symbol) or `leadingText` mark
  (mutually exclusive, for a glyph with no SF Symbol form — a currency
  sign or ISO code), an optional trailing node pinned to the row's far
  right and top-aligned to the label (the bank picker's capability
  icons — see the transparency principle below), and an optional
  `description` — a second line rendered below
  the label in the SAME leading-slot-aligned column, wrapping onto
  multiple lines rather than truncating, for a subtitle explaining what
  the option means (the account-kind picker's "Real estate, car,
  valuables, money you lent" hint, `AccountKindField`,
  `src/screens/forms/account-kind-field/`). The caller owns any tone
  switching (e.g. `onAccent` once selected) on whatever it renders in
  `description`/`trailing` — `SelectableRow` does not inspect either.
  This is the ONE select-sheet row: a labeled-field-plus-`BottomSheet`
  picker (`FieldTrigger` + `BottomSheet` + a `SelectableRow` per option)
  is the shared "select field" family replacing the older inline
  `ChipRow` for a picker with more than a couple of options.
  **SelectField** (`src/design-system/components/select-field/`) is the
  GENERIC version of this shape — `label`/`sheetTitle`/`options`/
  `selected` (nullable — see below)/`onSelect`/`labels`/optional
  `subtitles`/optional `icons`/`placeholder`/`required`/`disabled`/
  `error`/`testID` — and is now the ONE shared implementation: a
  `property` account's Type-as-category field (`PropertyTypeField`,
  replacing the generic holding-type picker for that one account
  kind — see `kiko-domain`'s "`property_item`/`metal` create-form
  sections"), the `debt` account's Type-as-loan-kind field
  (`LoanKindField`, with one `loanKindSymbol` glyph per kind; 6 and
  4 long option names, too wide for a `ChipRow`), the Bond form's
  coupon-frequency picker (shared by both `BondIsinSection`'s ISIN-mode
  unmapped-frequency picker and `ManualBondFields`'s own frequency
  field), the holding-type picker, the column-mapping form's time-zone
  field (every `sourceTimeZoneIds` entry,
  `src/statement-import/column-mapping/source-time-zone.ts`), `AccountKindField`, and `ModeSelectField` all reach
  for it directly. `SelectField`'s optional `onSelectClosed(option)` runs
  once after the sheet a pick closed has finished closing (the
  `onClosed` contract above): wire a screen navigation to it, never to
  `onSelect` (`AccountKindField` forwards it). `SelectField`'s optional
  `closesWithoutAnimation(option)` names the picks whose sheet closes with
  `BottomSheet`'s `animationType="none"` (`'fade' | 'slide' | 'none'`,
  default `'fade'`), so `onSelectClosed` follows the pick at once instead of
  after the cross-dissolve (its length is inferred, unmeasured): only for a
  pick that LEAVES the screen, where the fade is just a wait (the account
  form's Property and Debt, and the holding form's Bank, Cash, Crypto,
  Metals and Broker; the holding form's other implicit kind stays in that
  form and keeps the fade). It is opt-in per call site; every other pick and
  every other sheet keeps the fade. It works because RN's iOS Modal host
  re-reads `animationType` on every props commit and uses it for the dismiss
  (`RCTModalHostViewComponentView.mm` `updateProps` sets
  `_shouldAnimatePresentation`, then `ensurePresentedOnlyIfNeeded` dismisses
  with it), so `SelectField` sets `'none'` in the SAME render that hides the
  sheet and clears it on the next open (`AccountKindField` forwards the prop,
  the owning screen decides which kinds). Jest renders a hidden Modal as
  nothing; assert the close animation with `spyOnModalAnimation(testID)`
  (`src/test-support/modal-animation-spy.ts`), which reads the TRANSITION
  render (the first render of the latest run in that state), never the last
  render or the mount render. It assumes one mounted Modal per testID; restore
  it in afterEach. Read a row's SF Symbols in a test with `glyphNamesWithin`
  (`src/test-support/glyph-names-within.ts`). `AccountKindField` and
  `ModeSelectField` (`src/screens/forms/`) are now thin wrappers over
  `SelectField` — `ModeSelectField` keeps its own caller-side `visible`
  gate (a convert has no mode toggle at all) ahead of it. `BankTypeField`
  is the one remaining hand-rolled implementation, kept apart because it
  carries extra behavior `SelectField` doesn't generalize (an
  always-last "Other bank" row (`OTHER_BANK_ID`) that states no capability, a Guideline-5.6 disclaimer, and dual
  capability icons) — retrofitting it onto `SelectField` is a separate,
  larger task. `sheetTitle` is REQUIRED and distinct from `label` — a
  field label (sentence case) and a sheet title (Title Case) are two
  different UI roles per `kiko-translator`'s casing-by-role rule, so the
  sheet header can never just reuse the label verbatim. The same REQUIRED
  `sheetTitle` prop is on every other picker-sheet field too (`DateField`,
  `TimeField`, `CategoryField`, `BankTypeField`, `HoldingSelectField`,
  `PaymentHoldingField`, `CurrencyField`, `FilterMenu`,
  `ColumnSelectField`); the trigger's `label` stays its caption and
  accessibility label. `SelectField`'s
  `selected` accepts `null` for a picker that legitimately starts with
  nothing chosen — the trigger then shows `placeholder` at
  `textSecondary`, the same "no default" contract a `ChipRow` used to
  fake by widening its option type to admit a value (`''`) that matches
  nothing. A picker whose `selected` is never actually `null` (an
  account always has a kind, a transaction always has a mode) still
  supplies a `placeholder` to satisfy the contract — it is simply never
  shown.
- **ConfirmSheet** (`src/design-system/components/confirm-sheet/`) —
  the themed confirm-or-cancel `BottomSheet`: a title, an optional
  body `message` (omitted for a bare title-only confirm), a `confirmLabel`,
  and `onConfirm`/`onCancel` — Cancel AND a scrim/back dismiss both run
  `onCancel`, a dismiss behaves like Cancel. An optional `destructive`
  flag switches the confirm button to the `destructive` Button variant
  (a red fill) instead of the accent `primary` one. This is the one
  confirm surface in the app — a delete/destructive confirmation routes
  through it rather than a native `ActionSheetIOS` or a hand-rolled
  `Modal`.
- **NoticeBanner** (`src/design-system/components/notice-banner/`) — an
  inline, non-modal notice for a state the user can keep working
  around (never an alert or sheet): a `surfaceHigh` box, a `caption`
  `textSecondary` message, and an optional `secondaryTonal` `small`
  action button. The button renders only when BOTH `actionLabel` and
  `onAction` are given. Read `notice-banner.props.d.ts` for the props.
  Find its consumers with `git grep NoticeBanner src/screens`. On the
  holding detail, a stored state the user must fix elsewhere is a
  NoticeBanner with no action, worked out on the fly from the row, in its
  own folder (`holding-detail/<name>-notice/`, `holding` prop, `null` when
  nothing is wrong): `OversizedSaleNotice` (a metal sale larger than what was held before it;
  kiko-pricing's "Stored lots are costed again once per device").
- **ReminderOfferCard** (`src/design-system/components/reminder-offer-card/`)
  — the NoticeBanner family's two-action sibling: an inline, non-modal
  invitation (never a notification, sheet, or alert, and never an
  error/warning tone). A `Card` (solid `surface` fill, hairline border,
  `md` radius) with `padding={3}` and the banner's `spacing(2)` gap, a
  `body` `textPrimary` message, then a wrapping row of a `primary` `small`
  accept and a `secondaryTonal` `small` dismiss (the user's "ghost" = faint
  tint), both `fullWidth={false}`, 44pt taps via `small`'s hitSlop. Read
  `reminder-offer-card.props.d.ts` for the props (all required but
  `testID`). Differs from NoticeBanner: a content Card (not the
  `surfaceHigh` `sm` block), body primary text (not caption secondary),
  and two required actions (not one optional tonal one). First
  consumer: `AccountDetail`'s reminder offer.
- **NotificationPreAlertSheet**
  (`src/design-system/components/notification-pre-alert-sheet/`) — the
  HIG pre-alert shown before the iOS notification prompt. It has ONE
  Continue button, never Cancel and never 'Allow', and a scrim dismiss
  continues too. The caller asks iOS from `onClosed` (the Modal's own
  `onDismiss`), so the system prompt never lands on a sheet that is
  still closing. Screens do not wire it by hand: they spread
  `useNotificationPreAlert().sheet` onto it (see kiko-architecture
  'Reminders').
- **CardContextMenu** (`src/design-system/components/card-context-menu/`)
  — wraps a grid/list card in a touch-and-hold delete (and, when an
  `onEdit`, `onDuplicate`, and/or `closeAction` is passed, an
  Edit/Duplicate/Close/Delete choice, in that order) menu. `onEdit` is
  for a row with no tap target of its own: the holding detail's
  share-change rows and lot rows (`LotRowMenu`, Edit + Delete; Delete
  is offered only while every later sale stays covered without the lot,
  and a refusal inside the write shows the shared save-error alert). A
  lot row is the user's own entry, so unlike every other derived ledger
  row it is not captioned "Computed". A transaction row keeps
  tap-to-edit and passes only `onDuplicate`. `closeAction`
  (`{ label, onPress }`, the consumer names the entry) is the account
  detail's manual holding cards ("Close holding"/"Close loan" + Delete):
  a hold there opens the action list, never the delete confirm
  directly, and the screen renders Close's own confirm
  (`CloseHoldingSheet`, a `destructive` red confirm) through
  `useCloseHoldingAction` below. Only Delete is red
  in the menu; Edit, Duplicate, and Close stay neutral. A synced holding
  passes no `closeAction`. The menu is: a
  `Gesture.LongPress()` that raises the shared `ConfirmSheet` above on a
  still hold, while a hold that MOVES fails the gesture so an enclosing
  `react-native-sortables` drag can still claim it — see `kiko-gestures`
  for the full arbitration. A non-deletable entity with no action (a
  synced account/holding) renders with no gesture at all, `<>{children}</>`,
  so a synced card stays reorderable. This replaced the app's earlier
  swipe-to-reveal-delete row (`SwipeableRow`, removed) as the one
  delete-affordance pattern; a new deletable card/row wraps in this
  rather than reintroducing a swipe gesture. No swipe actions anywhere:
  row edit/delete = long-press `CardContextMenu` (`kiko-no-swipe-action`,
  see kiko-gestures). A form has no in-form Delete: the entity is
  deleted only from its page's `CardContextMenu`, so nothing under
  `src/screens/forms/` imports `ConfirmSheet`
  (`kiko-no-confirm-sheet-in-form`, `rules/semgrep-prewrite.yml`).
- **HoldingCard** (`src/design-system/components/holding-card/`) — one
  holding as a wide row card, shared so a screen never imports another
  screen's card (`kiko-no-cross-screen-import`): the entity icon tile and
  name on the left, the holding's computed value (as of `now`) on the
  right, a smaller base-currency line for a holding in another currency,
  and the owned share of a part-owned property. A plain tap calls
  `onOpen`; it carries no long-press of its own, so a grid wraps it in
  `CardContextMenu` and `Sortable.Grid`. Consumers: the account-detail
  holding grid and the Accounts screen's Property and Debts grids.
- **CloseHoldingSheet** and `useCloseHoldingAction`
  (`src/design-system/components/close-holding-sheet/`) — the Close
  confirm for a manual holding (a `destructive` `ConfirmSheet`; the
  copy comes from `closeHoldingCopy`, loan wording for a debt-side type)
  and the hook a screen uses to wire it. The sheet is reached only
  through the hook (the folder's barrel exports only
  `useCloseHoldingAction`); a screen never imports the sheet itself.
  `useCloseHoldingAction(account)`
  returns `closeActionFor(holding)` (the `closeAction` for
  `CardContextMenu`, `undefined` for a synced holding) and `closeSheet`
  (render each hook instance's `closeSheet` once; a screen with two hook
  instances renders both). `account` is the HOLDING's own account,
  read by `isSyncedHolding`; a screen listing the implicit account's
  holdings passes that row.
- **SymbolIcon** — wraps an SF Symbol glyph
  (`react-native-nitro-sfsymbols`); see "SF Symbol `tintColor` gotcha"
  below before passing it a color.
- **EntityIconTile** (`src/design-system/components/entity-icon-tile/`)
  — the entity glyph tile (an account/holding card's icon swatch):
  takes the SF Symbol `name` plus the entity's already-RESOLVED hex
  `color` (see "Entity color and tint" below — never a raw stored/
  nullable value) and derives its own gradient from that hex via
  `entityIconTileGradient`. An optional `size` mirrors `SymbolIcon`'s
  own, defaulting to the `body` icon-size token when omitted.
  Consumers: the account card, the holding card, and the Settings >
  Reminders account heading (2026-09-30, user request), where the
  tile sits left of the `heading` name, both centered, and carries no
  `accessibilityLabel` because the name beside it already reads it.
  Tile size: 36pt (`spacing(9)`) by default; `compact` draws it one
  spacing step smaller, 32pt (`spacing(8)`), with the glyph unchanged.
  **Locked (2026-09-30, user request "Slightly decrease reminder's
  squircle size."):** the Settings > Reminders heading tile is
  `compact`; the account and holding cards keep 36pt.
- **Switch** — a toggle that wraps RN's `Switch` with theme track/thumb
  colors. With `label` it renders a labeled row (label left, toggle
  right), the toggle centered on the label. **Locked (2026-09-30, user
  request on the Face ID row "Center Face ID setting toggle vertically
  to its label too.")**; the term-deposit Recapitalization toggle and
  the other Settings switch rows are extended app-wide by coordinator
  ruling 2026-09-30 (apply repeated feedback app-wide). Without `label` it is a bare toggle whose label sits
  elsewhere in the row, and it must then get `accessibilityLabel` so
  VoiceOver names it.
- **TextField** — a labeled text input wrapping RN's `TextInput` with
  theme tokens. Its disabled chrome (border/background/opacity) comes
  from the shared `disabledFieldStyle(theme)` helper
  (`src/design-system/disabled-field-style/disabled-field-style.ts`); `DateField` and
  `TimeField` (`src/screens/forms/`) consume the SAME helper so a
  read-only date/time field renders identically to a read-only text
  field. This is a DIFFERENT token from the pressable `DISABLED_OPACITY`
  token above (`disabled-opacity.ts`) — a disabled field is a different
  control class from a disabled pressable (e.g. Button), and the two must
  not be conflated. A third disabled-field-like control reuses
  `disabledFieldStyle`, not a fresh inline dim. Its `multiline` prop
  grows the field to fit its content instead of clipping to the fixed
  44pt single-line height — pass it for any free-text input whose value
  can wrap (see `text-field.component.test.tsx` for the two behaviors
  contrasted).
- **FieldError** (`src/design-system/components/field-error/`) — the
  one inline validation-failure line a form renders DIRECTLY UNDER its
  own field (`Text variant="caption" tone="negative"`, the same tone
  `FieldLabel`'s required asterisk uses) — never next to a footer Save
  button, and never a reserved-height slot: it fades in on failure and
  the layout reflows, so a valid field shows no error node at all.
  Every
  invalid field shows its OWN error at the same Save/Import press —
  each field's message is computed from ONLY that field's own inputs,
  gated by the attempted-save flag, never by comparing against a
  single shared "first failing field" reason (that shape hides every
  error but one until the fields ahead of it are fixed one at a time,
  and un-hides the next one instead of clearing — a real reported
  bug, not a hypothetical). EVERY field with a visible error turns its
  own `FieldLabel`/`TextField`/`FieldTrigger` red (`invalid`, driven
  from that field's own `error` prop) at the same press, not just one
  — the first-invalid field in the form's top-to-bottom order is used
  ONLY to pick the scroll target, a SEPARATE concern from which fields
  turn red. A picker field takes the message through its own `error`
  prop (`CategoryField`, `HoldingSelectField`, `BankTypeField`,
  `BrokerTypeField`: each takes `error` and `required` and forwards to
  `FieldTrigger`; the account form wraps the one that renders in one
  `View` ref so a blocked Save scrolls to it), never a caller-rendered `FieldError` beside it,
  which leaves its label grey. One error that judges a GROUP of fields
  renders once under the group, and every field in the group turns its
  label red through the label-only `invalid` prop (`DateTimeRow`, which
  passes it to `DateField` and `TimeField`; `TextField`; `FieldTrigger`
  and `HoldingSelectField`). `invalid` never renders a message and is
  never set beside `error`. In the transaction form: the re-date error
  under the Date and Time row (both labels), and the split-returns error
  under the return rows (every row's "Return to N" and "Return N", plus
  the payment Amount when the returns total it or more; an empty payment
  is the Amount's own error). In the holding form, a contributions error
  turns the amount and date labels of every row it refuses red.

  Save/Import is never disabled for VALIDATION; it validates on press.
  It disables only while a submit is in flight, or when an edit's saved
  value depends on data still loading: the holding form's edit waits for
  the price book (kiko-pricing), and the transaction form's edit waits
  for the re-date boundary, only for a row the re-date rule can block
  (`isPossibleBalanceSetRow`, `src/transactions/balance-boundary/`).
  Every form composes this instead of hand-rolling its own error
  caption — see `kiko-code-style`'s "Form validation model" section for
  when to show it.
- **FieldTrigger** (`src/design-system/components/field-trigger/`) —
  the shared "labeled field that opens a picker sheet" trigger: a
  caption above a bordered row showing the current icon (or leading
  text mark) + value, tapping which opens the caller's own
  `BottomSheet`. `CategoryField`, `HoldingSelectField`,
  `ModeSelectField`, `BankTypeField` (`src/screens/forms/`),
  `SelectField` and `CurrencyField` below all compose this rather than
  re-implementing the same bordered-row JSX. Lives in
  `design-system/components/`, not
  `screens/forms/` where it used to sit — a design-system component
  must never import from `src/screens/**`, enforced by the
  `kiko-no-import-screens-outside-ui` Semgrep rule (see `kiko-linter`).
- **No imports across screen folders.** A file under
  `src/screens/<a>/` must never import from `src/screens/<b>/**`
  (relative path, `@kiko/` alias, or `jest.mock`). Move shared code to
  `src/design-system/`, a shared hook/util directory, or a barrel
  outside `src/screens/`. Enforced by `kiko-no-cross-screen-import`
  (`scripts/checks/screen-imports.js`, the guard and
  `check:screen-imports`).
- **CurrencyBreakdown** — a two-column per-currency amount grid (code
  left, formatted `MoneyText` right), filled row-major.
- **SummaryTable** (`src/design-system/components/summary-table/`) — the
  one shared "label left, value right" summary block: an optional `title`
  heading row, then a stack of `rows` (`{ key, label, value: ReactNode,
  testID? }`), each split `space-between`. Extracted from the
  holding-detail deposit/bond value-breakdown block —
  `HoldingDetailScreen` renders its own
  principal/gross/interest/tax/expected-profit rows through this (and,
  for a bond, a "Yield to maturity" text row: a two-decimal percent,
  testID `bond-yield-to-maturity`, left out when no lot has a stored
  price — the one text row in the interest table; the bond FORM shows
  the same yield, formatted by the same `yieldToMaturityText`, as a
  one-row `SummaryTable` after the purchase date with a caption
  `textSecondary` value like its ISIN summary, testID
  `bond-form-yield-to-maturity`), passing
  `<MoneyText money={...} tone={...} />` as each row's `value`, with NO
  visual change from before the extraction. The statement-import preview
  (`StatementPreviewBlock`, `statement-import/statement-preview-block/`) and the
  column-mapping result section (`MappingResult`) reuse the SAME row
  layout/alignment/styling for their own summary rows (transaction count,
  currency, date span) — never the deposit table's value/percent/tax
  COLUMNS, only its layout. The loan detail's ledger breakdown and its
  "Upcoming Payments" list (`UpcomingPayments`, one row per installment:
  date label, payment over a principal / interest caption) are
  `SummaryTable`s too. A property owned in part swaps the priced
  Cost / Value / Gain rows for Whole value / Your share / Your value /
  Cost (your share) / Gain (`sharedPropertyBreakdownRows`,
  `holding-detail.screen.tsx`; testIDs `ownership-whole-value`,
  `ownership-share`, `ownership-owned-value`, `ownership-owned-cost`,
  `ownership-gain`); "Your share" is the one text row, a `body` `Text`
  reading the share as typed plus its day (`1/3 · 33.33% since
  01.06.2025`, or `50% since …` for a percent). The two-value display
  on the holding card follows the converted-to-base line's shape: the
  owned value stays the main `MoneyText`, and a `caption`
  `textSecondary` line under it reads the share of the whole (`1/3 of
  3,000,000.00 ₴`, testID `holding-card-whole`) — only when the
  property is owned in part (`propertyOwnershipView`). `value` is always a caller-rendered `ReactNode`
  (a plain `Text` or a `MoneyText`) — `SummaryTable` itself never formats a
  value. A row's own `testID` wraps ONLY that row's value (never its
  label), so a caller migrating an existing row's testID (e.g.
  `statement-import-transaction-count`) keeps the exact same
  `toHaveTextContent` assertion it had before, scoped to the value text
  alone — RNTL's `toHaveTextContent` matcher requires an EXACT match by
  default (unlike jest-dom's substring default on web), so a testID
  spanning both label and value would break every such assertion.
- **CurrencyField** (`src/design-system/components/currency-field/`) —
  the shared currency-picker trigger + `BottomSheet`: a labeled trigger
  showing the current selection (or a placeholder) that opens a sheet
  listing a caller-supplied `options` set (defaults to every currency;
  the cash-account form passes fiat-only, the holding form its type's
  `holdingCurrencyOptions` — fiat-only for cash, the full set
  otherwise). The sheet lists fiat first, then crypto; `cryptoFirst`
  flips the two groups (each keeps its own order) — the crypto-holding
  create form sets it. Supports `hideLabel` for a caller that already labels the
  control externally (the Settings base-currency row), `required`, and
  a `disabled` read-only state. `error` follows every field's contract:
  `FieldTrigger` renders it under the trigger (reflow, not reserve, testID
  `<testID>-error`) and tints the label (the holding form's share
  Currency check). A field opens a picker sheet for one
  selection among many options; `ChipRow` below toggles inline
  among a small fixed set instead.
- **ChipRow** (`src/design-system/components/chip-row/`) — the ONE
  shared wrap-flow chips component: a compact wrap-flow row for a short
  code/label chip, never an equal-width column grid (that is
  `DayOfMonthGrid`, below). Read the folder
  directly for the current props; the load-bearing ones beyond
  `options`/`selected`/`onSelect`: `Option` is `string | number` (the
  trend-filter amount pills are `1 | 2 | 3 | 4 | 5`); `selected` accepts
  `undefined` for a PICK LIST with no single-select toggle semantics —
  `DescriptionSuggestions` passes `undefined` so no chip ever renders
  highlighted, rather than faking it with a value (`''`) that matches
  nothing. ChipRow is single-select (`selected`/`onSelect`) OR
  multi-select (`selectedValues`/`onToggle`), with the same chip look.
  The props type is a union and the two modes cannot be mixed
  (`chip-row.props.d.ts`). In multi mode the owner builds the new set:
  `onToggle` only reports the tapped value. Example: `WeekdayField`
  (`src/screens/forms/weekday-field/`). `labels` is an optional value -> display-text map;
  `labelVariant` (default `'body'`) drops the chip label a type step
  for a value sitting under its own larger section label (the
  trend-filter sheet's amount/measure rows pass `'caption'`). The chip
  keeps the approved compact look at EVERY step — a 34pt visible
  `minHeight` with `spacing(1)` vertical padding (`chip-row.styles.ts`),
  the same visible height as `Button`'s `small` size — and restores the
  44pt tap target with vertical `hitSlop` (`CHIP_HIT_SLOP`,
  `chip-row.component.tsx`), never with a taller chip. `labelVariant`
  only changes the label's type step, not the chip's size. **Selection
  look (the user-approved native iOS filter-chip style):** a selected
  chip is the `accent` fill with an `onAccent` label; an unselected chip
  is the faint `neutralSubtle` fill with a `textPrimary` label — never a
  solid dark `surface`/`surfaceHigh` pill. The icon picker's tiles
  (`icon-picker-modal.component.tsx`) follow the same look. A chip or
  segment on a glass sheet is a plain fill, never a `GlassSurface` (no
  glass on glass). See
  `kiko-statement-import`'s column-mapping section for the fullest
  worked comparison against `SegmentedControl` below. Because a
  design-system component may never import from `src/screens/**`
  (`kiko-no-import-screens-outside-ui`), `ChipRow` lives in
  `design-system/components/` since a design-system component
  (`LanguageSwitch`) renders one — the SAME reason `FieldTrigger` lives
  there too; a screen-level consumer imports it from there like any
  other design-system component.
- **DayOfMonthGrid** (`src/design-system/components/day-of-month-grid/`)
  — single-select day of month, 1 to 31, as a 7-column calendar-shaped
  grid (days 29-31 on a short last row), replacing a 31-row select sheet
  (user request 2026-09-30, "render day of month as a chips grid").
  Grounded in the iOS Reminders custom repeat "Monthly > Each" day grid
  and the HIG Pickers page ("A picker works well when displayed in
  context"; a short list suits a non-picker control). Each chip is
  ChipRow's approved look (`accent` + `onAccent` selected,
  `neutralSubtle` + `textPrimary` otherwise, `radii.sm`, 34pt), drawn
  inside a real 44pt cell with no `hitSlop` (see "Touch targets"); the
  grid pulls its footprint back with negative margins so its outer
  chips line up with the caption and the other fields. **Locked
  (user request 2026-09-30, "Use the same cell sizes/gaps in 'day of
  the month' as in 'day of the week'."):** the day chips take the weekday row's (`WeekdayField`,
  a `ChipRow`) chip height and horizontal gap from ONE shared source,
  `src/design-system/chip-geometry/` (`CHIP_MIN_HEIGHT`, `CHIP_GAP_STEP`,
  `CHIP_TAP_INSET`; read the values in `chip-geometry.ts`) — ChipRow
  and the grid both import it, never a copy. Each cell pads
  `spacing(1)` a side, so two neighbours sit 8pt apart like the
  weekday chips. The row gap stays 10pt (2 x `CHIP_TAP_INSET`), not
  ChipRow's 8pt: a 34pt chip on a 42pt pitch cannot carry a 44pt
  target without overlapping the next row's. Math on a 390pt iPhone:
  form row 358pt (390 - 2 x `spacing(4)`), grid row 366pt, cell
  52.26pt, chip 44.26 x 34pt; 7 chips + 6 gaps = 357.8pt <= 358pt. A
  content-sized ChipRow chip with a two-digit body label is ~43-44pt
  wide (label ~19-20pt + 2 x `spacing(3)`), so 7 columns hold the
  weekday chip size. The component test compares the grid against a
  rendered ChipRow and checks the 44pt cell on the narrowest 375pt
  iPhone (cell 50.1pt). It is NOT a
  `ChipRow` variant: ChipRow is a wrap-flow row, never an equal-width
  column grid. Accessibility: each cell is a `button` with
  `accessibilityState.selected`, its number as its label, and the group
  `label` as its hint (the SegmentedControl reasoning: a non-accessible
  container gives VoiceOver nothing to read, so the grid container
  carries no `accessibilityLabel`). The day number is `numberOfLines={1}`
  with `adjustsFontSizeToFit` (`minimumFontScale` 0.7, as
  `SegmentedControl`), so "31" never splits at accessibility text sizes.
  **Layout traps:** the cell width is `'14.28%'`, never `100 / 7` —
  Yoga resolves percentages in 32-bit float and wraps on a strict `>`, so
  seven exact sevenths overshoot on 390pt/414pt rows and the grid drops
  to six columns (the component test replays that float math). The
  chip inset (`CHIP_TAP_INSET` in `chip-geometry.ts`, half of the
  44pt cell minus the 34pt chip; read the value there) is the cell's
  vertical padding, not a fixed cell height, so a chip grown by Dynamic Type keeps the inset the grid's
  negative margin undoes. **Hit-testing:** the grid's negative margins
  make the outer 44pt cells overflow the parent by 5pt vertically (and
  `spacing(1)` horizontally); taps there still land only because
  Fabric does not clip overflow by default — never put the grid inside
  an `overflow: 'hidden'` parent. Props: `label`/`selected`/`onSelect`/`testID` (cells are
  `${testID}-option-<day>`). The caller renders any hint below it (the
  reminder form's short-month hint for days 29-31). Consumer: the
  reminder form's monthly schedule.
- **SegmentedControl** (`src/design-system/components/segmented-control/`)
  — a JS implementation of Apple's iOS `UISegmentedControl`, per the Human
  Interface Guidelines
  (https://developer.apple.com/design/human-interface-guidelines/segmented-controls):
  a rounded track in the faint neutral fill (`theme.colors.neutralSubtle`,
  the native iOS segmented track — the user-approved native style),
  holding N equal-width segments, with the SELECTED segment a lighter
  raised thumb (`theme.colors.segmentSelected`) under a `textPrimary`
  semibold label. The track is translucent, so the thumb's WCAG 1.4.11
  3:1 non-text contrast is checked against the track composited over
  BOTH backdrops the control sits on (true-black `background` and
  `surface`, which a card or the glass sheet composites to); that is
  why the thumb is lighter than iOS's own `#636366`, which only reaches
  ~2.4:1 over `surface`. Read `theme.ts`'s own doc comment on
  `segmentSelected` for the current hex and measured ratios rather than
  trusting a copy restated here. This is still NOT the app's other
  filled-accent selection vocabulary (`ChipRow`/`SelectableRow`) — a
  segmented control reads as its own distinct iOS control, never an
  accent fill. No segmented-control
  NATIVE library is a dependency of this app; this
  renders the same visual/interaction contract in plain
  `Pressable`/`Box`/`Text` instead of adding one. Touch target: each segment `Pressable` is a REAL layout box with
  `minHeight` 44pt and no `hitSlop` (`minHeight`, not `height`, so
  Dynamic Type can grow it). The native-matching visible track (32pt)
  and selected pill (24pt, a 4pt ring of track around it) are
  absolutely-positioned DECORATIVE insets (`pointerEvents="none"`), so
  they grow with the segment. The container carries a negative
  `marginVertical` equal to the track inset, so the parent lays the
  control out at the 32pt track and no empty band appears above or below
  it. The 44pt frame then overflows the parent, and RN 0.87 Fabric keeps
  that band touchable: the parent's `overflowInset` is built from its
  children's frames (`YogaLayoutableShadowNode::getContentBounds`), and
  `RCTViewComponentView betterHitTest` only drops an outside-bounds touch
  when `overflowInset` is zero or the view clips. So never wrap the
  control in an `overflow: 'hidden'` parent. Jest cannot hit-test; see
  `segmented-control.styles.ts` for the exact geometry rather than a copy
  of the pixel values restated here. The selected label is semibold
  (`fontWeight: '600'`), matching UIKit, composed alongside (not
  duplicating) the base label's own `textAlign: 'center'`. The 32pt
  visible track (answering a device-feedback question, "is this how iOS
  does them?" — a segment "seeming short"): this component's
  `TRACK_HEIGHT` constant matches `UISegmentedControl`'s commonly
  MEASURED intrinsic height at its standard control size — there is no
  Apple-documented public constant for this number (the HIG page above
  covers behavior and appearance, not a numeric height), so treat 32pt
  as a community-measured convention, not an Apple primary source, until
  confirmed on a real device.
  Props: `options`/`selected`/`onSelect`/`labels`/`accessibilityLabel`
  (required — every segment folds it into its own `accessibilityHint`)
  /`testID`. Accessibility: each segment keeps
  `accessibilityRole="button"` with `accessibilityState={{ selected }}`
  — NOT `"tab"`/`"tablist"`, which RN 0.87 maps to NO accessibility trait
  on iOS (confirmed against `RCTViewManager`/Fabric's
  `accessibilityPropsConversions` — only `"tabbar"` maps to a trait there.
  A `"tab"`/`"tablist"` role loses
  the Button trait VoiceOver needs to announce "can be activated"); each
  segment's own `accessibilityLabel` is its visible text, and its
  `accessibilityHint` folds in the group's `accessibilityLabel` plus a
  TRANSLATED position string (`common.segmentPosition`, "N of M" — never
  a hardcoded `"N / M"` literal, which VoiceOver would read as "N slash
  M" and which never translates). VoiceOver behavior should still be
  confirmed on a real device — Jest only asserts prop values.
  `SegmentedControl` carries no VISIBLE label prop of its own (only the
  non-visual `accessibilityLabel`) — a caller that needs a visible
  caption above it composes its own `FieldLabel` above the control, the
  same way `ChipRow` does internally (the crypto-sync Wallet/Binance
  source toggle and the Bond form's "ISIN / Manual" mode both do this).

  **The tabs-vs-chips rule (binding), quoted verbatim from the user:**
  "Tabs (SegmentedControl) are used when the selection changes the
  appearance, for example it shows different form fields (like import
  mapping's currency field). Otherwise use chips (a value selection
  that leaves the form the same)." A long-label option set — even one
  that leaves the form unchanged — still uses `SelectField`'s select
  sheet instead: a chip row's width scales with its label text, and a
  handful of long labels (the loan-kind picker's 4 kind names —
  Автокредит, Споживчий кредит, Іпотека, Позика в особи — already ran
  too wide for a comfortable chip row) breaks its wrap-flow layout,
  which `SelectField`'s list rows do not. Verify EVERY choice control
  against this rule before adding or changing one — do not assume a
  control's existing type is correct, and never move a control between
  `ChipRow`/`SegmentedControl`/`SelectField` as an unrequested DEFAULT
  without a specific instruction naming that control. Current app state
  (a representative sample, not the closed set — grep `<SegmentedControl`
  / `<ChipRow` for the current consumers):
  - `SegmentedControl` (changes fields): the reminder form's Repeat
    (frequency) selector (`ReminderFormScreen` — each frequency shows
    its own field: weekdays, day of month, or interval); the Bond
    form's ISIN/Manual mode (`BondIsinSection`,
    `src/screens/forms/holding-form/bond/bond-isin-section/`); the Lot
    form's Buy/Sell toggle (`LotFormScreen` — Buy alone shows the
    Total-cost field).
  - `ChipRow` (leaves the form the same): the reminder form's weekday
    picker (`WeekdayField`, multi-select); the holding form's metal
    form/unit chips. The reminder form's day of month uses the same chip
    look in a calendar grid (`DayOfMonthGrid`), not a select sheet.
  - `SelectField` (long list, regardless of field-change): the
    property-category and loan-kind pickers (6 and 4 options — too
    wide for a `ChipRow`); the bond coupon-frequency picker (shared by
    both the ISIN mode's unmapped-frequency picker and the Manual
    mode's own frequency field — one control everywhere it appears);
    the holding-type picker (up to 9 long type names); the account-kind
    and transaction-type pickers (`AccountKindField`/`ModeSelectField`,
    both now thin wrappers over `SelectField`). The transaction-type
    picker is a DOCUMENTED EXCEPTION to the tabs-vs-fields half of the
    rule: its choice does change visible fields (Exchange/Split add
    their own fields), which is tabs territory by the letter of the
    rule, but it stays a select sheet on purpose — 4 options on create,
    already the same shape `AccountKindField`/`BankTypeField` use, so
    converting it to `SegmentedControl` would trade one working pattern
    for another rather than fixing a real violation.
- **BarChart**, **PieChart**, **NetWorthLine** — the `react-native-svg`
  visualization components; see the dedicated `kiko-charts` skill for
  their coordinate-space and testID conventions before touching any
  of the three. `PieChart` additionally supports `innerRatio` (ring
  thickness) and `centerTotal` (an amount centered in the donut hole)
  — see `kiko-charts`.

## Capability icons — the transparency principle

The interface must be transparent about the abilities it provides to the
user: every capability an entity supports is visible (a capability icon
in a picker option's `trailing`/`description`), never hidden or implied.
A capability icon stands for exactly ONE real capability — never a
"probably true" or "usually true" one, and never gated on a build/env
flag (Guideline 5.6). The bank picker (`BankTypeField`,
`src/screens/forms/bank-type-field/`) is the exemplar: `receipt` means
"this bank has a known, dedicated statement format" — gated on the
catalog's own `statementFormatId` field, so a column-mapping-only bank
(no dedicated parser) does not show it, even though it still offers
import (through the generic column-mapping screen, which
`increase.indent` names); `increase.indent` means "column-mapping import
is available" — shown on every SPECIFIC bank row (a dedicated parser or not); the
`other` row renders no capability icons or captions; `arrow.trianglehead.2.clockwise.rotate.90`
means "this bank supports a live sync connection" — gated on the
catalog's own `connectable` field. Derive a capability icon's gate from
catalog DATA (a field on the entry), never a hard-coded id list — a
hard-coded list drifts the moment the catalog gains or loses an entry,
silently misrepresenting that entry's real capabilities.

## App-lock UI

The app-lock screen/gate components are part of the shared
screen/gate vocabulary, not a one-off: `src/auth/lock-gate/` (the
launch-time lock screen) and
`src/screens/settings/system/app-lock-setting/` (the settings toggle row).
Follow their existing shape — read the folders directly — when adding
a related security UI rather than inventing a new screen pattern.

## Entity color and tint

An account or holding's color is never a raw hex literal at the call
site — it goes through one shared pipeline so a swatch reads
identically everywhere that entity appears (its card, its icon tint,
its chart legend). Read `src/holdings/entity-colors/entity-colors.ts` and
`src/design-system/entity-tint/entity-tint.ts` directly for the exact functions
and their current shape; do not copy their signatures into prose here
where they can drift. The pipeline is:

- `defaultAccountColor` / `defaultHoldingColor`
  (`src/holdings/entity-colors/entity-colors.ts`) — the kind/type-keyed default
  swatch a newly-created entity gets before a user overrides it. A holding
  type's default color is set once, on its own descriptor
  (`src/holdings/holding-descriptor/`); `defaultHoldingColor` is derived
  from every type's descriptor, not a second hand-written map.
- `resolveEntityColor` (`entity-tint.ts`) — the one function that
  picks an entity's EFFECTIVE color: the stored override if it is a
  valid hex, else the kind/type default if that resolves, else a safe
  gray fallback. Always call this rather than a bare
  `stored ?? typeDefault` — that pattern misses an empty-string stored
  value and an unmapped kind/type default (e.g. a row written under a
  since-removed enum member), both of which throw downstream instead
  of silently falling back. The gray fallback resolves from the single
  dark palette (`entityColorsDark` in `palette.ts`). For an account
  row, call `accountIdentity` (`src/holdings/account-identity/`), which
  pairs this color with the icon fallback (see `kiko-domain`'s "Entity
  glyphs"). The Charts contribution builder
  (`src/statistics/account-contribution/account-contribution.ts`) is
  the exception: its input has no icon, so it calls
  `resolveEntityColor` directly for the color only.
- `resolveEntityColor`'s result feeds `EntityIconTile`
  (`src/design-system/components/entity-icon-tile/`), the shared
  squircle icon tile: `entityIconTileGradient` (`entity-tint.ts`)
  derives its two vertical-gradient stops (lighter top, darker bottom)
  from the one resolved hue via `lightenHex`/`darkenHex`, and
  `isLightEntityColor` (`entity-tint.ts`, a real WCAG contrast-ratio
  check, not a naive brightness average) picks a white or dark glyph
  tint so the SF Symbol on top stays legible on every palette swatch.
  `entityCardBackground`/`entityTintBackground` do not exist in the
  current module — read `entity-tint.ts` directly for the live
  exported function set (it changes; do not restate it here) rather
  than assuming either name.

**One hue, several renderings.** An entity has exactly one color, but
that color is rendered several different ways depending on context —
a flat translucent tint behind a card, an opaque SF Symbol tint, a
chart fill. Never introduce a second, parallel way to derive one of
these renderings from a hex, and never add a second hex parser either
— `entity-tint.ts` owns the one unexported `parseHex`. Extend
`entity-tint.ts` with a new named function instead, so every
rendering of an entity's color still traces back to the same
`resolveEntityColor` call. Read `entity-tint.ts` directly for its
current exported functions rather than trusting a list restated here
— a duplicated `parseHex` (and, at one point, a since-removed
`blendOverWhite` pastel-over-white blend helper) were once added
under `money-text/` and had to be moved back into `entity-tint.ts`
for exactly this reason; do not assume either name still exists
there today.

## SF Symbol `tintColor` gotcha

`react-native-nitro-sfsymbols`'s `SFSymbolView.tintColor` accepts only
`#RGB`/`#RRGGBB`/`#RRGGBBAA` hex — the native bridge parses hex
directly with no CSS color parser behind it. Most theme tokens are
already hex, but `theme.colors.textSecondary` is an `rgba(...)`
string (the iOS `secondaryLabel` translucency convention), which
`Text`/`MoneyText` handle fine (they go through React Native's own
color parser) but which `SFSymbolView` cannot parse — handed an
`rgba()` string, it silently renders the glyph in a fallback color
instead of throwing, which on this app's black background looks like
a fully invisible glyph, easy to mistake for a layout bug. Convert any
`rgba()`/`rgb()` color through `toSFSymbolTintColor`
(`symbol/symbol.color.ts`) before it reaches `tintColor` — `SymbolIcon`
already does this for both its `tone` and its explicit `color` prop;
a caller building a raw `SFSymbolView` outside `SymbolIcon` must do
the same conversion itself.

## GlassSurface `isLiquidGlassSupported` branch

This section documents `GlassSurface` itself — now a NAV-LAYER-only
component (tab bar, sheets, FAB, keyboard accessory; content cards use
`Card` — see "Entity color and tint" above and `Card`'s own bullet).
`GlassSurface` renders two structurally different trees, not one tree
with a conditional prop: `isLiquidGlassSupported` (from
`@callstack/liquid-glass`) picks between a real `LiquidGlassView` (iOS
26+) and a plain `View` with an explicit fallback background/radius.
`isLiquidGlassSupported` being `false` does **not** mean
`LiquidGlassView` is unavailable — on unsupported iOS it still renders
as a plain `View` with no glass effect — so the fallback styling lives
in the `else` branch's `View`, not as a style merged onto
`LiquidGlassView` "just in case." A new prop that changes the surface's
appearance (a new tint wash, a new border style) must be applied
to **both** branches, or it silently only works on iOS 26+. The
`transparent` variant is the canonical case: it paints its translucent
fill as a backdrop UNDER the glass on the glass path AND as the base
fill on the fallback path, so both paths read see-through.

## Wrapping a React Native primitive

Each of these primitives wraps a real React Native component
(`View`, `Text`, ...), so widen the prop type from that underlying
component's own props (`Pick` the ones that make sense, or extend the
full set) rather than redeclaring a parallel prop shape by hand.
Spread `{...props}` onto the underlying component, and place the
design system's own explicit props — `placeholderTextColor`, `style`,
whatever the primitive itself controls — **after** the spread, so a
caller passing that same prop can never silently clobber the token-
driven value the primitive is responsible for. Name that rest-props
binding `props`, not `rest` — it's the component's full prop set
minus what's already destructured, not a leftover.

For mapping a value's state to a token — the `MoneyText` sign check
above is the canonical case — avoid a nested ternary. Use a small
named helper (`isNegative()`, `isZero()`) for boolean-predicate
branching, since a helper reads cleaner there than a `match` for only
two or three boolean checks; reach for `ts-pattern` instead when the
input is a closed literal union rather than a predicate (see
`kiko-code-style`'s "`ts-pattern` for exhaustive mapping").

Components are default exports with a `.component.tsx` file suffix
(`box.component.tsx`, `money-text.component.tsx`) — see
`kiko-code-style`'s "Exports" and "File suffixes" sections for the
project-wide rule this follows.

## JSX layout conventions

**Percentage widths.** Yoga resolves `%` widths in 32-bit float and
wraps on a strict `>`, so N equal columns of `100 / N`% can drop the
last column on some row widths. Always use a slightly smaller rounded
percentage (see `DayOfMonthGrid`'s `'14.28%'`) and pin it with a test
that replays the float math.

Separate sibling React nodes in JSX with a blank line, the same way
sibling statements are separated in `kiko-code-style`'s "Blank lines
before statement blocks" rule. This keeps distinct child elements
visually distinct.

Use title case for every heading and sub-heading shown in the UI —
screen titles, section headers, sheet/modal titles — styled through
the typography tokens (see "Token categories" above). This does not
cover Button labels: buttons are actions, not headings, and case
themselves per the catalogue (see "Button" above) — English Button
copy is sentence case. Casing is decided per UI ROLE, not per
component in isolation — the full rule (which roles are Title Case
vs sentence case, the proper-noun keep-list, the uk
sentence-case-everywhere rule, and the mechanized test) is owned by
the `kiko-translator` skill's "Casing follows one rule per UI role"
section; read that before adding a new heading/title/label string.
