---
name: kiko-design-system
description: Invoke when touching theme tokens, react-native-unistyles styles, any shared design-system component (Screen, LoadingState, Box, Text, MoneyText, Button, Card, GlassSurface, BottomSheet, SymbolIcon, Switch, TextField, FieldError, FieldLabel, FieldTrigger, CurrencyBreakdown, ConvertedCaption, CurrencyField, SummaryTable, EntryCard, EntryDateHeader, ExpandToggle, EntityIconTile, CardContextMenu, ConfirmSheet, ChipRow, DayOfMonthGrid, SelectField, SelectableRow, SegmentedControl, DataTable, Divider — full current set at `src/design-system/components/`), the app-lock screen/gate UI, an entity/account/holding color, or an SF Symbol tintColor. Read before adding a color, spacing, typography, or radius value, before styling a new screen, and before wiring an entity color into a card, icon, or chart.
---

# Kiko design system

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Design system (started here)" section) and the token module itself,
`src/design-system/theme/theme.ts`, which ships `darkTheme` and `lightTheme` (spacing,
radii, typography, `colors`) plus its own entity/chart palette
(`palette.ts`). Users see dark only until the flip of change set 6. This skill states the method and
token categories; read `theme.ts`/`palette.ts` directly for the
current values rather than trusting a copy of them here.

This project skill carries domain/design knowledge. The plugin's
`design-system` workflow skill (`harness/kiko/skills/design-system/SKILL.md`)
is a separate, thin process-wrapper skill for the designer role — the
two are meant to coexist, read both.

## Reference files (read the one your task touches)

This skill is SKILL.md plus the reference files below; their `##` sections are cited by name
(`kiko-design-system's "Component set"`) exactly as SKILL.md's own sections are, and they hold
the long per-component detail that is read only when the task touches a component. Read the
file before you edit the component it describes.

- [component-set.md](component-set.md) — "Component set", part 1: the shared layout, text,
  action and surface components (`TwoPaneLayout`, `Screen`, `LoadingState`, `Box`, `Text`,
  `MoneyText`, `ConvertedCaption`, `Button` with its pinned treatments and sizes, `Card`,
  `GlassSurface`, `BottomSheet`, `SelectableRow`, `SelectField` and
  `DataTable`). Read it before you build or change any of them. The set continues in
  component-set-forms.md under "Component set (continued)".
- [component-set-forms.md](component-set-forms.md) — "Component set (continued)": the sheet,
  card, form-field and chart components (`ConfirmSheet`, `InfoHint`, `NoticeBanner`,
  the exchange history footer, `ReminderOfferCard`, `EmptyState`, `NotificationPreAlertSheet`,
  `CardContextMenu`, `ImportBalanceLine`, `HoldingCard`, `CloseHoldingSheet`, `SymbolIcon`,
  `EntityIconTile`, the section heading disclosure row, `Divider`, `Switch`, `TextField`,
  `FieldError`, `useIsMounted`, `FieldTrigger`, `CurrencyBreakdown`, `SummaryTable`, `EntryCard`,
  `EntryDateHeader`, `PairedFieldsRow`, the field and filter helpers (`deriveFieldTestID`,
  `toggleFilterValue`),
  `ExpandToggle`, `CurrencyField`, `DateRangeField`, `ChipRow`, `DayOfMonthGrid`,
  `SegmentedControl` with the tabs-vs-chips rule, the chart components (`BarChart`, `PieChart`,
  `NetWorthLine`), `ColorPicker`, `TransactionCard`, and the form header) and the rules
  "No imports across screen folders", "Scroll to the first invalid field" and
  "Empty holding picker". Read it before you build or change any of them.

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
  materials used per `GlassSurface` in component-set.md.

The ranked, file-grounded audit of the app against these axes lives at
`docs/design/2026-09-10-ios-hig-audit.md`. Read it before a design task
to see the open findings; do not restate its findings here.

## Dark-only theme

Kiko is dark-only for users: there is no appearance toggle and no runtime scheme
switching. A `light` theme is registered and no user can reach it, until the flip of change
set 6. `src/design-system/unistyles/unistyles.ts` registers
`{ dark: darkTheme, light: lightTheme }` with `initialTheme: 'dark'`, so
`adaptiveThemes` is not used either.
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

The token categories, defined once in a single theme module (read
`src/design-system/theme/theme.ts` for the full set):

- **color** — background, surface (per elevation level), primary
  text, secondary text, accent(s), positive-money, negative-money.
- **spacing** — a scale used for all padding/margin/gap; components
  never hardcode a pixel value for spacing.
- **typography** — font sizes/weights/line-heights for the type
  scale used across screens. `largeTitle` (34pt bold, lineHeight 41,
  not Dynamic-Type scaled) mirrors the native nav-bar large title;
  use it for a full-title heading when a nav title does not fit
  (`src/design-system/theme/theme.ts`). A `Text` that is a screen
  heading passes `accessibilityRole="header"`
  (`src/design-system/components/text/text.props.d.ts`).
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
- **layout** — `paneMaxWidth` caps a pane's SCREEN CONTENT (lists,
  forms), except `Screen uncapped` and in a pane under a top tab bar (see the Screen entry
  under "Component set" in component-set.md), and never native bars;
  `hairline` is the flat two-pane divider
  width. Read `theme.ts` for the values; never restate them. Pane code
  reads `theme.layout`, never an inline width literal or
  `StyleSheet.hairlineWidth`. The divider keeps the ordinary hairline
  rule.

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
`onAccent` text/icon/checkmark — the same filled-accent selection
vocabulary as `ChipRow`, not a one-off; `TransactionCard`'s category
glyph takes `onAccent` when the card is `selected`. An UNCHECKED trend-filter
row keeps its own category's identity color instead: `SymbolIcon`
resolves an explicit `color` prop over its `tone` prop, so the row
passes `color={checked ? undefined : option.color}` — clearing
`color` (falling back to the `tone`-driven `onAccent`) only once
selected. A new accent-filled control
follows the same rule: read `theme.ts`'s own `onAccent` doc comment,
then one of these call sites, rather than reinventing the check.

**The shared selected surface** (`src/design-system/selected-surface/`): `OnAccentContext`,
`useIsOnAccent` and `selectedSurfaceStyles.fill` (the accent fill plus border). `Text` and
`SymbolIcon` switch to `onAccent` inside it by themselves. A selected list row sets `selected` on
`Card`, `SettingsRow` or `HoldingCard`; it never hand-sets a fill or an `onAccent` color.
`EntityIconTile` keeps its identity color on the fill (pending the user's live check, R34).

## Styling layer: react-native-unistyles v3

`react-native-unistyles` (3.6.0) is the styling layer. A single
Unistyles v3 theme object — the OLED `darkTheme` above, beside the unreachable `lightTheme` —
is registered in `src/design-system/unistyles/unistyles.ts` as
`themes = { dark: darkTheme, light: lightTheme }`,
with `settings: { initialTheme: 'dark' }`. Nothing switches themes, so there is no
`adaptiveThemes` and no runtime
`UnistylesRuntime.setTheme` call anywhere. Style components against
the theme's tokens, not literal values, so the token keys stay the one
contract every component styles against, whichever theme supplies values.
The token values live in `theme.ts` (`darkTheme`, `lightTheme`) and
`palette.ts`; read those directly rather than restating them here.
The light values come from `docs/design/light-palette/palette.json`, pinned by
`src/design-system/palette/light-palette-source.test.ts`; change the JSON, never a light hex alone.
The palette check reads `palette.ts` by text position, and code placed above the
`chartSeriesDark` block failed it: keep that block in place and put new light sets below it.

## Locked decisions (user-approved)

Each entry is a visual the user approved. Never change or revert one —
not in a refactor, a cleanup, or a HIG pass — without the user's own
explicit approval; a change request from an agent is not approval. Add
an entry (date + value) the moment the user approves a new visual.

Component entries in the reference files carry their own **Locked** marks; this list names
every one of them, so scan this list rather than the reference files for what is locked.

- **EntityIconTile compact in Settings > Reminders** (2026-09-30). The account heading tile is
  `compact` (32pt); the account and holding cards keep 36pt. See `EntityIconTile` in
  component-set-forms.md.
- **Switch toggle centered on its label** (2026-09-30). A labeled `Switch` row centers the toggle
  on the label (the Face ID row; extended app-wide). See `Switch` in component-set-forms.md.
- **DayOfMonthGrid shares the weekday cell size** (2026-09-30). The day chips take the weekday
  row's chip height and horizontal gap from one shared source. See `DayOfMonthGrid` in
  component-set-forms.md.
- **NetWorthLine current-day label** (2026-10-19). No background; the
  amount/date gap sits on the scrub line's top end; the label stays fixed
  while dragging; at accessibility sizes it stops under the card title
  (see `kiko-charts` "NetWorthLine scrub line").
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
  `SegmentedControl` under "Component set (continued)".
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
  on its own), and the amount sits in a `flexShrink: 0` box (`rowAmount`;
  the holding card's `valueColumn`; the account card's `AccountTotal`
  `column`, `src/screens/accounts/account-total/`), right-aligned at
  its full width.
  Short titles render exactly as before: each family keeps its own
  vertical alignment — `TransactionCard` top-aligns (`flex-start`, a
  body-size glyph), and so does the shared `EntryCard` that the holding-detail
  ledger rows use (`rowMain` is `flex-start`; a USER-APPROVED change of the
  locked visual, 2026-10-23, Q4 = B: the amount sits at the top, its caption —
  time only — sits directly under it in one right column, and the
  scheduled split lines stay below the whole row; a derived row's marker
  (Scheduled / Projected / Computed) is the `EntryCard` subtitle, smaller `textSecondary` text
  under the label, from `derivedMarker` in `holding-detail.screen.tsx`; a past lot has none, and
  the scheduled loan row passes "Loan payment" + "Scheduled"; a USER-APPROVED round 3 change,
  2026-10-25, of the earlier title form). The subtitle sits under the wrapped title in the same
  `rowDescription` box, `spacing(2)` under the label: the same step as `TransactionCard`'s gap
  between its title row and its meta row (a user request, 2026-10-25; see
  `entry-card.styles.ts` `rowDescriptionWithSubtitle` and `transaction-card.component.tsx`). The
  account card (`accounts.screen.tsx` `renderAccountCard`, the main
  grid only) and the shared `HoldingCard` (also the Property and Debts
  section cards) stay
  `center` beside their taller `EntityIconTile`. The Statistics pie legend's name
  wraps in its own `legendLabel` (`flex: 1`) box beside the swatch; its
  fixed-width value/percent columns are unchanged. Rows whose label is a
  fixed short string (`SummaryTable`, the bar chart's type rows) are
  not this pattern. The Accounts screen's
  Property and Debts section headings are user data (the implicit
  account's name) and DO follow it (`ImplicitAccountHeading`).
  `TransactionCard`'s `money` prop is optional (a transaction template's
  amount is optional): omitted, the `rowAmount` box and its `MoneyText`
  do not render and the title cluster keeps its `flex: 1` row; with
  `money` the output is unchanged.
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
- **iOS < 26 fallback look: the old solid chrome** (2026-10-08, user option
  A). A device without Liquid Glass (`isLiquidGlassSupported === false`,
  e.g. iOS 18.7) reads like the pre-glass app, and iOS 26/27 do not change
  by a pixel. Three parts: (1) the `BottomSheet` card is the opaque
  `theme.colors.sheetBackground` (#1C1C1E) through `sheetFallbackFill`, not
  a `GlassSurface` (whose `material`/`bloom` fallback is a translucent
  `surfaceTranslucent` fill, which reads as a flat black dim on a sheet;
  the sheet's fallback look does not depend on that shared primitive);
  (2) its scrim is
  `theme.colors.scrimFallback` (black 0.55), while `scrim` (0.4) stays the
  glass path's tint; (3) every large-title native stack takes
  `screenOptions={largeTitleScreenOptions}`
  (`src/navigation/large-title-screen-options/`), which on this tier adds
  `headerBlurEffect: 'systemChromeMaterialDark'` plus `headerLargeStyle:
  { backgroundColor: 'transparent' }` (the at-rest large title stays
  transparent, only the scrolled bar blurs), because react-native-screens
  builds a transparent appearance with no background effect there. On
  iOS 26+ it passes neither option. A new large-title stack, or a screen
  that sets `headerLargeTitle` itself, spreads that helper rather than
  setting `headerLargeTitle: true` inline. Device-confirm on an iOS 18
  device, not in the simulator or Jest.
- **Long titles use the fitting-large-title layout** (2026-10-15, locked, user: "Everything
  lgtm"; no shorter titles applied). The user approved this on a live device, and it locks:
  (1) the fit is measured, not guessed: `useTitleFit` measures the title in the native
  large-title font, and an estimate only covers the first frame;
  (2) a title that does not fit shows in full as a wrapping `largeTitle` heading, the first
  scroll content, never truncated or shrunk;
  (3) the bar is empty at rest, with no bar title while the heading is on screen;
  (4) once the heading scrolls under the bar, the bar shows the full title inline;
  (5) the bar stays translucent: `headerTransparent` true and `headerShadowVisible` true,
  with `headerLargeTitle` off, so content lays out under it as under a large title;
  (6) the iOS < 26 look is kept: transparent at rest, blurred once content scrolls under it,
  and iOS 26+ passes no extra option;
  (7) the original titles stay as they are. A long title is never shortened or renamed to
  make it fit; a shorter name needs the user's own request.
  Changing any of these, or the numbers they rest on, needs the user's explicit approval.
  Mechanism: every large-title native stack passes `screenLayout={fittingLargeTitleLayout}`
  (`src/navigation/fitting-large-title/`); a new large-title stack adds it too. It measures the
  title (`useTitleFit`) in the native large-title font, against the width of its own pane in a
  split window (`usePaneWidth`) and the window's otherwise; a title that does not fit shows in full
  as a wrapping `LargeTitleHeading` (`src/design-system/components/large-title-heading/`) as
  the first content. `Screen` in scroll mode hosts the heading; a custom list screen renders
  `LargeTitleHeading` itself and wires its scroll with `useLargeTitleScroll`, as `HoldingDetail`
  does (`src/screens/holding-detail/holding-detail.screen.tsx`). A screen that mounts no heading
  keeps the native title (the hosting guard). While the heading shows, the bar uses
  `largeTitleHeadingOptions` (`src/navigation/large-title-screen-options/`): `headerLargeTitle`
  false together with `headerTransparent` true and `headerShadowVisible` true. Never switch
  `headerLargeTitle` off alone: native-stack then makes the bar opaque and lays content out
  below it. The bar title appears once the heading scrolls under the bar. Every pane, the left
  companion pane beside a trailing side bar included, uses the native large title while the
  title fits; a title that does not fit wraps as the heading below the bar.
  `largeTitleRestoredOptions(screenOptions)` puts the native large title back and returns the
  screen's own `headerTransparent`, `headerShadowVisible` and `headerTitle`, read before the
  switch (`undefined` where the screen set none): the screen's own values from before the
  switch. A value the screen changes during heading mode is not kept (setOptions cannot remove
  a key). Never restore with fixed values. Device-confirm: Jest cannot show bar translucency.
- **Tables has a small title in an opaque bar** (2026-11-04; user: "A: Small title
  (Recommended)"). A normal small title, content below it, Tables only: an exception to "every
  pane uses the native large title". The Statistics stack sets `headerLargeTitle: false` on it
  (`src/navigation/statistics-stack/statistics.stack.tsx`); the Home stack sets only
  `headerShown: true`.
- **The Statistics Tables button stays 44 pt and full width** (2026-11-04; user: "As it is now").
  It is `size="compact"` (`src/screens/statistics/statistics.screen.tsx`), an exception to the
  inline secondary rule. The chevron is removed (user: "Remove it (Recommended)"): `icon` only.
  It is the first child of the untagged `Box`, above the filter bar. Its press state is backlog.
- **Tips were removed by user ruling** (2026-10-09: "Hints still look bad, let's remove them
  for now"). There is no tip card, tip hook, or subtle-accent token; do not bring back a
  first-use tip, or its old look (tinted accent fill, lightbulb glyph, close button), without
  asking the user first. `InfoHint` stays allowed.
- **EmptyState action is primary + small** (2026-10-08). 34pt tall, 44pt
  tap via `SMALL_HIT_SLOP`, not full width, never the regular 50pt. Pinned
  by `empty-state.component.test.tsx`.
- **Duo side-bar content aligns to the native title** (2026-10-29, user ruling, FLAG 1). On the
  Duo side-bar poses the content margin is the native title's, not the base one: on iOS 27.1
  the bar-hosted large title ignores the bar margin and the bar's title position
  adjustment and starts at x 20. The value lives in
  `src/design-system/components/screen/use-content-margin.ts`;
  see `Screen` in component-set.md, which points back here.

## UX patterns

Before acting on a UI feedback round, audit the affected screens
against this section and against how the same pattern is already
built elsewhere in the app; fix the pattern everywhere it appears, not
only the reported instance (see harness-workflow's "UI feedback
rounds: audit before fixing" — single source, do not restate its text
here).

The established patterns grouped under this heading:

- The form validation pattern — `FieldError` in "Component set (continued)"
  (component-set-forms.md).
- The tabs-vs-chips rule (binding) — in "Component set (continued)" (component-set-forms.md),
  under `SegmentedControl`.
- The capability-icon transparency principle — its own heading further
  down this file.
- Field placeholder and error copy — below.
- A form separates its field block from the next section with the shared `Divider`
  (`src/design-system/components/divider/`), written `<Divider testID="form-divider" />`. It is
  a direct child of the form's gap `Box`, with the default spacing and full width: no inset, no
  spacing prop, no wrapper. It goes after the last field of the block and before the next
  section. A section that exists only in edit mode (for example the category screen's rules
  section) carries its divider inside the same condition, so a create-mode form shows neither.
  Copy the placement from `src/screens/forms/account-form/account-form.screen.tsx` and
  `src/screens/forms/holding-form/holding-form.screen.tsx`.
- Content that APPEARS in response to a press (a banner, a confirmation) is silent to
  VoiceOver: pair it with `AccessibilityInfo.announceForAccessibility(t(...))` using the same
  i18n string as the visible text.
- A filter never hides an active selection: a checkable filter's
  option list is scoped to the current data (e.g. the statistics
  category filter is scoped to the active date range), but a value
  the user has already SELECTED must stay listed and checked even once
  it drops out of that scope — union it back in from wherever its
  display data lives (Statistics: `categoryByKey`, handled with `keptKeys` in
  `src/statistics/statistics-filter-scope/statistics-filter-scope.ts`), rather than pruning
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
  result is "All". The stored Set is derived from, never rewritten. The
  options themselves come from `accountsForFilter`
  (`src/holdings/implicit-account/`): every live account, except a live
  implicit account with no holding at all (its last holding deleted, which
  also deleted its transactions); one with only a closed holding stays
  listed, because that history still counts. No total reads it
  directly; a stored selection of a left-out account is pruned to All (that
  account holds nothing). A value that only fell out of scope (a category outside the date range)
  is still unioned back, never pruned (the rule above).
- **SettingsRow** (`src/screens/settings/settings-row/`): `selected?: boolean` marks the row
  with the shared selected surface (`accessibilityState.selected`; it keeps a caller's radius);
  `onPress`
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
  theme.colors.textPrimary` (a form's Save is the exception: prominent and
  accent, see "Form Save and Cancel" below), `sharesBackground: false`. Never a
  `type: 'custom'` item or `headerRight` with a React view for a header
  action: UIKit sizes a native item's glyph, capsule, and 44pt target;
  a React view inside a custom item gets a different glyph size and
  capsule, so it does not read as the same kind of button as its
  neighbour. Do not use a `type: 'spacing'` item to split items:
  native-stack 7.18.9 sends it with no index, so react-native-screens
  inserts it at the trailing edge. A native item takes no `testID`; a
  test reads the item list from `setOptions` and calls its `onPress`.
  Consumers: `AccountDetail` (bell, then Edit; Edit only for an implicit property or debt
  account, which takes no new reminders), `CategoryForm` (edit mode: a star via
  `useFormHeaderItems` `extraItems`, before Save; the star is `star.fill` and disabled on the
  default category, a state marker; shown only once the category row is read), `HoldingDetail`
  (Edit only, for every holding: a Property or Loans holding has no account button; the implicit
  account is reached from its section heading on the Accounts screen, see "Section heading
  disclosure row" in component-set-forms.md, and edited from its AccountDetail's Edit pencil). A
  native item types its SF Symbol `name` as the symbol catalogue's union, so a symbol read from a
  stored value (not a literal) would need a guard against an unknown name, because UIKit draws no
  image for one.
  The pre-write guard enforces both bans: Semgrep
  `kiko-header-item-native-only` denies a `headerRight`/`headerLeft` value
  other than `undefined` (a `StyleSheet.create` style and a destructuring
  read of the options are not header values) and a `type: 'custom'` item
  in either header item list, and `kiko-no-header-spacing-item` denies a `type: 'spacing'` item in either
  list (`rules/semgrep-prewrite.yml`).
- **Form Save and Cancel live in the native nav bar.** Every form under
  `src/screens/forms/` calls `useFormHeaderItems`
  (`src/screens/forms/use-form-header-items/`). Save is the trailing
  item: a prominent, accent-tinted `type: 'button'` with the label
  `common.save` (no per-form Save label key). The hook takes
  `extraItems`, listed before Save (see its file for the option). Cancel is the leading
  plain `textPrimary` item and shows only when native-stack's
  `canGoBack` is false (the form is the first screen of its stack or
  pane); when a back button shows, the back button is the cancel. Save
  is never in a form's `Screen` footer. A secondary action (ruling
  2026-10-11: the Edit template form's "Create transaction") may stay
  in the footer as a lone secondary button. The same holds on a `bleedTop` list screen: the
  recurring series screen's footer button ('Not a recurring charge' / 'Remove mark') is the lone
  secondary footer action. The transaction form's convert action is
  another: the builder `footerActionOf` in
  `src/screens/forms/transaction-form/footer-action/` decides its footer
  ("Create transaction" on a template edit, else the "Exchange" button
  when eligible and not converting; `secondaryTonal`); see the
  `footer={...}` call sites. A native bar button does not
  end editing, so a value derived on blur is settled in the save path
  (see `kiko-code-style`'s "Form validation model"). Tests use the
  helpers in `src/test-support/form-header-items.ts`, never
  `getByText('Save')`.
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
  `BinanceCredentialsField` also takes an optional `onStoredWhileUnmounted`, called
  instead of `onConnect` when the field unmounted after the Keychain write stored the pair.
  Both callbacks receive the write's `BinanceWriteToken`; `CryptoSyncForm`'s `onConnectBinance`
  and `onBinanceStoredWhileUnmounted` carry the same type. The pair leaves the field only into
  `fetchAccount` (the check) and `saveCredentials`. `CryptoSyncForm` takes a required `source`
  and renders that source's field, nothing for `'other'`; the caller picks the source.
  `BinanceCredentialsField` checks `isBinanceCoolingDown` after the blank-field check and
  before `fetchAccount`. On a cooling account it shows the localized
  `accountDetail.binanceCoolingDown` text, makes no request or write, and keeps the typed
  pair, so a later press connects once the cooldown ends. After that check it also checks
  `isBinanceSyncRunning` and shows `accountDetail.binanceSyncStillRunning`.
  `MonobankConnectField` takes a required `accountId` prop; after the blank check it checks
  `isMonobankSyncRunning(accountId)` and shows `accountDetail.monobankSyncStillRunning`,
  with no request.
- The "Connect first" reminder (user-approved 2026-10-08, create form only).
  Typed input in a Connect field that was not connected turns the FIRST
  Save press into a reminder: nothing saves, and the hint appears directly
  under that field's Connect button and scrolls into view. It is not a
  validation error, so it is the informational hint style (caption,
  `textSecondary`, no error tone) with an `info.circle` icon, rendered by the
  shared `InfoHint` (`src/design-system/components/info-hint/`): the icon is a `SymbolIcon` at the caption icon-size token,
  top-left, the text takes the rest of the row so it wraps beside the icon,
  and the row is one accessible element labelled by the message (the icon is
  decorative). `InfoHint` serves two hints: this reminder and the Template tab's
  no-templates hint under the template select
  (`src/screens/forms/transaction-form/template-select/template-select.component.tsx`);
  that select also carries the "Add template" row (`emptyAction`, hidden while the list loads;
  the hint stays), and `transaction-form.screen.tsx` pushes the create form (params with
  its `handbackId`: see "Empty holding picker");
  the plain hint (`forms.account.importOnlyBankHint`) stays a bare caption
  `Text`. Any other informational hint with no action stays a bare caption
  Text. A
  SECOND Save press saves the account unconnected, storing nothing typed.
  Editing the input, pressing Connect, or the field unmounting starts over;
  a successful connect reports the input as no longer typed, so an empty or
  connected source saves on the first press, and a later edit of a connected
  field reminds again. The field keeps its input and takes a `reminder` prop
  (`ConnectReminder`, `src/design-system/connect-reminder/`) to report whether
  anything is typed; `useConnectReminder`
  (`src/screens/forms/account-form/use-connect-reminder/`) holds the state.
  The hint copy is `forms.account.connectHint`, naming the source's own
  Connect button label; it makes no claim about what is stored.

## Field placeholder and error copy

A placeholder never repeats its own field's label — enforced, not
just convention: `placeholder` is a required prop on `DateField`,
`TimeField`, `ColumnSelectField`, and `SelectField`, so a caller must
supply distinct wording rather than default to the label text. The
established placeholder copy is "Select a …" for a picker/select
field.

`DateField` takes an optional `maxDate` (unix ms, capped at the local day
it falls on): a later day is greyed out and cannot be pressed; omitted,
every day is pickable. `DateTimeRow`, `ExchangeFields` and
`ConvertExchangeFields` forward it to their `DateField`. It caps the day
only. Read `src/screens/forms/date-field/date-field.props.d.ts`.

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

## Capability icons — the transparency principle

The interface must be transparent about the abilities it provides to the
user: every capability an entity supports is visible (a capability icon
in a picker option's `trailing`/`description`), never hidden or implied.
A capability icon stands for exactly ONE real capability — never a
"probably true" or "usually true" one, and never gated on a build/env
flag (Guideline 2.5.19). The bank picker (`BankTypeField`,
`src/screens/forms/bank-type-field/`) is the exemplar: `receipt` means
"this bank has a known, dedicated statement format" — gated on the
catalog's own `statementFormatId` field, so a column-mapping-only bank
(no dedicated parser) does not show it, even though it still offers
import (through the generic column-mapping screen, which
`increase.indent` names); `increase.indent` means "column-mapping import
is available" — shown on every bank row (a dedicated parser or not), the `other`
row included, from one `COLUMN_MAPPING_SYMBOL` constant; the `other` row shows
no connect or statement-format icon and no caption; `arrow.trianglehead.2.clockwise.rotate.90`
means "this bank supports a live sync connection" — gated on the
catalog's own `connectable` field. The exchange picker (`ExchangeTypeField`,
`src/screens/forms/exchange-type-field/`) is the second consumer: the same connect icon,
gated on the exchange catalog's `connectable` field (`src/crypto-sync/exchange-catalog/`;
read the entries there); every row has a capability caption; the Other row shows its
caption and no icon. Derive a capability icon's gate from
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
  of silently falling back. The gray fallback resolves from
  `entityColorsDark` in `palette.ts`; the light twins sit beside it. For an account
  row, call `accountIdentity` (`src/holdings/account-identity/`), which
  pairs this color with the icon fallback (see `kiko-domain`'s "Entity
  glyphs"); for a holding, call its twin `holdingIdentity`
  (`src/holdings/holding-identity/`) under the same rule, because copies
  of the pairing drift apart. The Charts contribution builder
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

**One hue, several renderings.** An entity has exactly one color, but
that color is rendered several different ways depending on context —
the icon tile's two-stop gradient, an opaque SF Symbol tint, a
chart fill (a card itself stays neutral and untinted). Never introduce a second, parallel way to derive one of
these renderings from a hex, and never add a second hex parser either
— `entity-tint.ts` owns the one unexported `parseHex`. Extend
`entity-tint.ts` with a new named function instead, so every
rendering of an entity's color still traces back to the same
`resolveEntityColor` call. Read `entity-tint.ts` directly for its
current exported functions rather than trusting a list restated here
— a duplicated `parseHex` was once added under `money-text/` and had to
be moved back into `entity-tint.ts` for exactly this reason.

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

## SF Symbol availability

The deployment target is iOS 18.2, and `SFSymbolView` draws a symbol the
running OS does not know as a BLANK glyph, not an error. So every symbol
the app can draw MUST exist on iOS 18.2: there is no per-symbol fallback
map and `SymbolIcon` passes the name straight to the native view. A symbol
newer than 18.2 (for example the iOS-26 `text.pad.header`, which the generic
holding glyph used to be) is replaced by an older one that reads the same
(`list.bullet.rectangle`), not shimmed at runtime. `receipt` (iOS 18.2) is
the newest symbol in use. `SymbolIcon` has no `fallbackName` prop: it
hands the native view `fallbackName={name}`, always a string (a `null`
`fallbackName` crashes Release; `symbol.component.test.tsx` pins it). A
native header or tab-bar item has no `fallbackName` prop; the same rule
covers it.

The deployment target lives in three build places that must agree: the six
`IPHONEOS_DEPLOYMENT_TARGET` lines of `ios/Kiko.xcodeproj/project.pbxproj`,
`platform :ios` in `ios/Podfile`, and the Podfile's `post_install` pod floor
(`Gem::Version.new(...)`).
`__tests__/test-support/deployment-target.test.ts` reads those files as text
(`__tests__/test-support/deployment-target.ts`) and fails when any of them
differs from the ONE constant `DEPLOYMENT_TARGET`
(`__tests__/test-support/sf-symbol-catalogue.ts`). That check lives there, not
in the guard, because it reads `ios/`, which Stryker's sandbox does not copy,
and the guard imports `src/` modules so Stryker would run it there.
`__tests__/symbol-deployment-target.test.tsx` is the guard. It reads the
`sf-symbols-typescript` catalogue as text (the `@name SF Symbols N.M` and
`iOS vX.Y+` JSDoc, plus the `| 'name'` lines) and fails when a symbol the
app can draw is unknown to it or newer than the target. It collects the
entity maps, both icon pools and the pools the forms open, the Edit bar
item and the Reminders bell, the tab bar, and every quoted literal in
`src/` that equals a catalogue name (a name built at runtime is out of its
reach). Raising the target again is one edit to `DEPLOYMENT_TARGET` plus the
build files, then `pod install`; lowering it needs every symbol re-checked
by the same guard.

## FAB edge

The add-transaction FAB sits on the window's vertical-bar side: `FAB_SIDE` in
`src/screens/home/add-transaction-fab/add-transaction-fab.styles.ts` maps `useVerticalBarEdge()`
(`leading` to left, `trailing` to right, `none` to right). In a companion pane the side is the fold
side. Read the file for the current map (R33).

## GlassSurface `isLiquidGlassSupported` branch

This section documents `GlassSurface` itself — now a NAV-LAYER-only
component (tab bar, sheets, FAB, keyboard accessory; content cards use
`Card` — see "Entity color and tint" above and `Card`'s own bullet in component-set.md).
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
last column on some row widths. For N equal wrapping columns whose widths sum to 100%
(`flexWrap`), use a slightly smaller rounded percentage (see `SEVEN_COLUMN_WIDTH` in
`src/design-system/seven-column-width/`) and pin it with a test that replays the float math. A
single `%` cap beside a `flex: 1` sibling with no `flexWrap` (for example `maxWidth: '60%'` in the
recurring series row) cannot drop a column, so it needs neither.

Separate sibling React nodes in JSX with a blank line, the same way
sibling statements are separated in `kiko-code-style`'s "Blank lines
before statement blocks" rule. This keeps distinct child elements
visually distinct.

Use title case for every heading and sub-heading shown in the UI —
screen titles, section headers, sheet/modal titles — styled through
the typography tokens (see "Token categories" above). This does not
cover Button labels: buttons are actions, not headings, and case
themselves per the catalogue (see `Button` in component-set.md) — English Button
copy is sentence case. Casing is decided per UI ROLE, not per
component in isolation — the full rule (which roles are Title Case
vs sentence case, the proper-noun keep-list, the uk
sentence-case-everywhere rule, and the mechanized test) is owned by
the `kiko-translator` skill's "Casing follows one rule per UI role"
section; read that before adding a new heading/title/label string.
