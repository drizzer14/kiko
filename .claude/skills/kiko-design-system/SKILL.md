---
name: kiko-design-system
description: Invoke when touching theme tokens, react-native-unistyles styles, any shared design-system component (Screen, Box, Text, MoneyText, Button, GlassSurface, BottomSheet, SymbolIcon, SwipeableRow, Switch, TextField, CurrencyBreakdown, CurrencySwitch, OptionPills), the app-lock screen/gate UI, an entity/account/holding color, or an SF Symbol tintColor. Read before adding a color, spacing, typography, or radius value, before styling a new screen, and before wiring an entity color into a card, icon, or chart.
---

# Kiko design system

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Design system (started here)" section) and the token module itself,
`src/design-system/theme.ts`, which ships a single `darkTheme` (spacing,
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

- **Touch targets** — every control is at least 44pt x 44pt. A small
  glyph needs padding or `hitSlop` to reach it.
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
no runtime scheme switching. `src/design-system/unistyles.ts` registers
a single `darkTheme` (`{ dark }`) with `initialTheme: 'dark'` — there
is nothing to pick between, so `adaptiveThemes` is not used either.
`UIUserInterfaceStyle = Dark` is pinned in `ios/Kiko/Info.plist`, which
is what keeps native chrome (bottom tab bar, stack headers/large-title
blur, system controls, the native date picker) on the dark appearance
regardless of the device's own OS setting — there is no
`Appearance.setColorScheme` call anywhere driving it live. React
Navigation's own native chrome uses `navigationDarkTheme`
(`src/navigation/dark-theme.ts`), which now sources its `colors` from
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
as `OptionPills`/`ChipRow`, not a one-off. An UNCHECKED trend-filter
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
in `src/design-system/unistyles.ts` as `themes = { dark: darkTheme }`,
with `settings: { initialTheme: 'dark' }`. There is no second theme to
switch to, so there is no `adaptiveThemes` and no runtime
`UnistylesRuntime.setTheme` call anywhere. Style components against
the theme's tokens, not literal values, so the token keys stay the one
contract every component styles against, even though there is only one
theme supplying values today. The token values live in `theme.ts`
(`darkTheme`) and `palette.ts`; read those directly rather than
restating them here.

## Component set

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
  `src/navigation/use-scroll-to-top-on-tab-press.ts`, which targets
  the tracked expanded height rather than a live height plus a band.
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
  regardless of variant. `destructiveTonal` is the iOS "tinted
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
  The shared `DISABLED_OPACITY` token
  (`src/design-system/disabled-opacity.ts`) is the ONE dimming a disabled
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
  categories.screen.tsx`) both build an icon-only control this way, plus
  `fullWidth={false}`, rather than a raw `Pressable` + `SymbolIcon`.
  (There is no separate `IconButton` primitive; the old one at
  `src/design-system/components/icon-button/` was deleted when its only
  consumer went away.)

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
- **GlassSurface** — the shared card-grouping surface: real Liquid
  Glass on iOS 26+, a themed flat fallback everywhere else, an
  optional `bordered` edge, and three neutral/tinted variants of the
  backdrop under the glass. A `tint` (an entity card) paints an OPAQUE
  `surface` backdrop and an entity-color wash — see "Entity color and
  tint" below. A `transparent` (a neutral frosted see-through PANEL —
  the settings, system, and category cards, the Statistics screen's
  chart cards, the Home net-worth card, and the transaction/ledger list
  rows on Home and holding-detail) paints a TRANSLUCENT
  `surfaceTranslucent` backdrop and no wash, so the screen behind reads
  through while the drift/pop-in stays softened; a `tint` always wins
  over it. The `transparent`-vs-`tint` split is the rule for a new
  surface: a neutral card (settings, a chart, a summary, a list row)
  reads well as a frosted panel and takes `transparent`; an entity card
  (account, holding) keeps its opaque `tint`. A list row that is also a
  `SwipeableRow` child (the holding-detail ledger) takes `transparent`
  too — `SwipeableRow` is built for a translucent card (it ramps the
  delete action in off the live `translateX`, so nothing bleeds through
  a closed glass row); pass the card's radius to `SwipeableRow`'s
  `radius` prop so the reveal clips to the same corners (GlassSurface
  defaults to `md`). Neither prop keeps the fully-live see-through material (no
  backdrop). Read `glass-surface.props.d.ts` for the exact current prop
  set rather than trusting this summary if it drifts.
- **BottomSheet** — the one bottom-sheet primitive: a transparent
  `Modal`, a full-bleed dismiss scrim, and a bottom-anchored sheet
  card owning its own safe-area-aware bottom padding. Every sheet in
  the app routes through this rather than hand-rolling
  `Modal + backdrop + Box` again. The sheet card's own BACKGROUND is a
  translucent glass panel, reusing `GlassSurface`'s `transparent`
  variant (`surfaceTranslucent`; real Liquid Glass on iOS 26+, the same
  themed flat translucent fallback elsewhere) rather than forking its
  layering — real glass/fallback branching, backdrop, and base all stay
  owned by `GlassSurface` itself. It is rendered as an
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
  `surfaceHigh` #2C2C2E) sits one level BELOW the `surfaceHigh`
  cards/controls on it, so a control (e.g. an OptionPills selected
  pill) reads as raised instead of blending into the sheet — it used
  `surfaceHigh` itself before, the same tone as a selected pill, then a
  flat opaque `sheetBackground` token before this glass pass. It caps
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
- **SymbolIcon** — wraps an SF Symbol glyph
  (`react-native-nitro-sfsymbols`); see "SF Symbol `tintColor` gotcha"
  below before passing it a color.
- **SwipeableRow** — a swipe-to-reveal-delete list row; its gesture
  arbitration and settle math are pure functions in `gesture.ts` — see
  `kiko-gestures`.
- **Switch** — a labeled toggle wrapping RN's `Switch` with theme
  track/thumb colors.
- **TextField** — a labeled text input wrapping RN's `TextInput` with
  theme tokens. Its disabled chrome (border/background/opacity) comes
  from the shared `disabledFieldStyle(theme)` helper
  (`src/design-system/disabled-field-style.ts`); `DateField` and
  `TimeField` (`src/screens/forms/`) consume the SAME helper so a
  read-only date/time field renders identically to a read-only text
  field. This is a DIFFERENT token from the pressable `DISABLED_OPACITY`
  token above (`disabled-opacity.ts`) — a disabled field is a different
  control class from a disabled pressable (e.g. Button), and the two must
  not be conflated. A third disabled-field-like control reuses
  `disabledFieldStyle`, not a fresh inline dim.
- **CurrencyBreakdown** — a two-column per-currency amount grid (code
  left, formatted `MoneyText` right), filled row-major.
- **CurrencySwitch** — a segmented base-currency toggle pill; not a
  `Button` (it is a selection control, not an action, and needs a
  transparent selected-state fill `Button` does not support).
- **OptionPills** (`src/design-system/components/option-pills/`) — a
  shared row of selectable pill options; read that folder directly
  for its current props rather than assuming it matches
  `CurrencySwitch`'s shape. Its grid defaults to an always-2-column
  wrap (`CurrencySwitch`'s 4 options, `LanguageSwitch`'s 2) via an
  optional `columns` prop (default `2`); a consumer with a different,
  known option count that must render as a single equal-width row
  instead of wrapping passes an explicit `columns={n}` matching its own
  option count. Do not add a second, parallel way to force a row count;
  extend/override `columns` instead. The SELECTED pill reads as a
  FILLED accent control: an `accent` background with an `onAccent`
  label+icon and a semibold label, mirroring `ChipRow`'s selected chip
  — not a low-contrast raised surface, so the selection stays clear on
  the low-contrast sheet background. Unselected pills stay transparent
  with a `textSecondary` label. The pill content is centered and the
  pill holds the 44pt HIG minimum touch target.
- **BarChart**, **PieChart**, **NetWorthLine** — the `react-native-svg`
  visualization components; see the dedicated `kiko-charts` skill for
  their coordinate-space and testID conventions before touching any
  of the three. `PieChart` additionally supports `innerRatio` (ring
  thickness) and `centerTotal` (an amount centered in the donut hole)
  — see `kiko-charts`.

## App-lock UI

The app-lock screen/gate components are part of the shared
screen/gate vocabulary, not a one-off: `src/auth/lock-gate/` (the
launch-time lock screen) and
`src/screens/settings/app-lock-setting/` (the settings toggle row).
Follow their existing shape — read the folders directly — when adding
a related security UI rather than inventing a new screen pattern.

## Entity color and tint

An account or holding's color is never a raw hex literal at the call
site — it goes through one shared pipeline so a swatch reads
identically everywhere that entity appears (its card, its icon tint,
its chart legend). Read `src/holdings/entity-colors.ts` and
`src/design-system/entity-tint.ts` directly for the exact functions
and their current shape; do not copy their signatures into prose here
where they can drift. As of this writing the pipeline is:

- `defaultAccountColor` / `defaultHoldingColor`
  (`src/holdings/entity-colors.ts`) — the kind/type-keyed default
  swatch a newly-created entity gets before a user overrides it.
- `resolveEntityColor` (`entity-tint.ts`) — the one function that
  picks an entity's EFFECTIVE color: the stored override if it is a
  valid hex, else the kind/type default if that resolves, else a safe
  gray fallback. Always call this rather than a bare
  `stored ?? typeDefault` — that pattern misses an empty-string stored
  value and an unmapped kind/type default (e.g. a row written under a
  since-removed enum member), both of which throw downstream instead
  of silently falling back. The gray fallback resolves from the single
  dark palette (`entityColorsDark` in `palette.ts`).
- `entityCardBackground` (`entity-tint.ts`) — a card's flat, OPAQUE
  `#RRGGBB` background (never an `rgba(...)` string; it does not go
  through `entityTintBackground`'s alpha compositing): the resolved
  color darkened toward black, fed straight to `GlassSurface`'s `tint`
  prop — darkening keeps white body text legible on the dark theme.
  Replaced a 45deg two-stop gradient wash
  (design review: a plain darker solid reads calmer than a diagonal
  blend of two near-identical hues), then a translucent flat wash
  (a device bug: darkening a color that is then stamped at low alpha
  only shifts the final pixel imperceptibly).
- `entityTintBackground` / `darkenHex` / `lightenHex`
  (`entity-tint.ts`) — the lower-level building blocks
  `entityCardBackground` composes; reach for them directly only when
  you need one flat (non-darkened) translucent tint, or one
  darkened/lightened opaque hex on its own, not the composed card
  background.

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

Separate sibling React nodes in JSX with a blank line, the same way
sibling statements are separated in `kiko-code-style`'s "Blank lines
before statement blocks" rule. This keeps distinct child elements
visually distinct.

Use title case for every heading and sub-heading shown in the UI —
screen titles, section headers — styled through the typography tokens
(see "Token categories" above). This does not cover Button labels:
buttons are actions, not headings, and case themselves per the
catalogue (see "Button" above) — English Button copy is sentence
case.
