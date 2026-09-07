---
name: kiko-design-system
description: Invoke when touching theme tokens, react-native-unistyles styles, any shared design-system component (Screen, Box, Text, MoneyText, Button, GlassSurface, BottomSheet, SymbolIcon, SwipeableRow, Switch, TextField, CurrencyBreakdown, CurrencySwitch, OptionPills), the app-lock screen/gate UI, an entity/account/holding color, or an SF Symbol tintColor. Read before adding a color, spacing, typography, or radius value, before styling a new screen, and before wiring an entity color into a card, icon, or chart.
---

# Kiko design system

Source of truth: `docs/superpowers/specs/2026-08-30-kiko-foundation-design.md`
("Design system (started here)" section) and the token module itself,
`src/design-system/theme.ts`, which now ships two themes —
`darkTheme` and `lightTheme` — sharing one shape (spacing, radii,
typography) but each with its own `colors` and its own per-scheme
entity/chart palette (`palette.ts`). This skill states the method and
token categories; read `theme.ts`/`palette.ts` directly for the
current values rather than trusting a copy of them here.

This project skill carries domain/design knowledge. The plugin's
`design-system` workflow skill (`harness/kiko/skills/design-system/SKILL.md`)
is a separate, thin process-wrapper skill for the designer role — the
two are meant to coexist, read both.

## Dark and light themes

Kiko ships both a dark theme and a light theme (`darkTheme` /
`lightTheme` in `theme.ts`), registered with `adaptiveThemes: true`
so a fresh install follows the OS appearance. The user can instead
pin `'light'` or `'dark'`, or go back to `'system'`; the choice is
persisted in `settings.appearance` (`src/db/schema.ts`) and applied
by the shared `applyAppearance` mapping (`src/appearance/appearance.ts`,
mapped with ts-pattern's `match().exhaustive()`), which flips
`UnistylesRuntime.setAdaptiveThemes`/`setTheme` to match. Two callers
apply it: `useSyncAppearanceWithSettings`
(`src/appearance/use-sync-appearance-with-settings.ts`), mounted from
`AppRoot` for a LIVE change from the Settings screen, and
`MigrationsGate`'s `applyPersistedAppearance`
(`src/db/migrations.gate.tsx`), which reads the persisted value and
applies it before `MigrationsGate`/`LockGate` first paint — those
gates mount before `AppRoot` does, so without this a user who pinned
`'light'`/`'dark'` would see a cold-launch flash of the OS appearance
first. Any native
surface that needs a plain `'light' | 'dark'` scheme rather than a
Unistyles theme name (a `LiquidGlassView`, a native tab bar) goes
through `resolveColorScheme` (`src/design-system/color-scheme.ts`),
not a hand-rolled mapping. Read `theme.ts`, `palette.ts`, and
`color-scheme.ts` directly for the current values and mapping rather
than trusting a copy of them here.

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

Four token categories, defined once in a single theme module:

- **color** — background, surface (per elevation level), primary
  text, secondary text, accent(s), positive-money, negative-money.
- **spacing** — a scale used for all padding/margin/gap; components
  never hardcode a pixel value for spacing.
- **typography** — font sizes/weights/line-heights for the type
  scale used across screens.
- **radii** — the corner-radius scale for surfaces and controls.

Components read tokens; they never hardcode a raw color, spacing, or
radius value inline. The same rule extends to layout: prefer a
design-system prop over an inline style whenever one exists — `Box`
has a `direction` prop, so write `<Box direction="row">`, not
`<Box style={{ flexDirection: 'row' }}>`. An inline style bypasses the
one place a layout convention is supposed to live.

## Styling layer: react-native-unistyles v3

`react-native-unistyles` (^3.3.0) is the styling layer. There are two
themes authored as Unistyles v3 theme objects — the OLED `darkTheme`
above and a matching `lightTheme` — both registered in
`src/design-system/unistyles.ts` as `{ dark, light }` (dark first) with
`adaptiveThemes: true`, so a fresh install follows the OS appearance and
`UnistylesRuntime.setTheme` can switch by name. Style components against
the theme's tokens, not literal values, so both themes (and any future
refinement) resolve from the same token keys — the token keys are the
contract, the two themes just supply different values per key. The token
values live in `theme.ts` (`darkTheme`/`lightTheme`) and
`palette.ts`; read those directly rather than restating them here.

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
  color tokens; other text usage composes on top of this.
- **MoneyText** — formats a `Money` value (see `kiko-domain`) and
  applies the positive/negative/neutral money color token from its
  sign. This is the only primitive that knows about `Money` — plain
  `Text` never receives a `Money` object directly.
- **Button** — the one action button: primary/secondary/destructive
  variants, an optional leading/trailing SF Symbol icon tinted to a
  single fixed color regardless of variant. The label has no
  `textTransform`: each catalogue supplies its own casing (English
  Button copy is sentence case; Ukrainian already is) — there is no
  style-layer transform and no per-language gate.
- **GlassSurface** — the shared card-grouping surface: real Liquid
  Glass on iOS 26+, a themed flat fallback everywhere else, an
  optional `bordered` edge, and an optional flat entity-color tint
  background — see "Entity color and tint" below.
- **BottomSheet** — the one bottom-sheet primitive: a transparent
  `Modal`, a full-bleed dismiss scrim, and a bottom-anchored sheet
  card owning its own safe-area-aware bottom padding. Every sheet in
  the app routes through this rather than hand-rolling
  `Modal + backdrop + Box` again. It caps its own height at a fixed
  66%-of-window ceiling and takes an optional `maxHeight` prop that
  can only tighten that cap further, plus a `scrollable` prop
  (defaults `true`) that wraps `children` in a `ScrollView` so
  overflow scrolls instead of clipping — a sheet that needs its own
  pinned header/footer or a scroll-to-selection ref (date-range-field,
  category-field, icon-picker-modal) passes `scrollable={false}` and
  renders its own inner `ScrollView` instead. Its drag-to-close
  grabber's pure math (`clampSheetTranslate`, `shouldDismissSheet`)
  lives in `bottom-sheet.gesture.ts` — see `kiko-gestures`. Read
  `bottom-sheet.props.d.ts` for the exact current prop set rather than
  trusting this summary if it drifts.
- **SymbolIcon** — wraps an SF Symbol glyph
  (`react-native-nitro-sfsymbols`); see "SF Symbol `tintColor` gotcha"
  below before passing it a color.
- **SwipeableRow** — a swipe-to-reveal-delete list row; its gesture
  arbitration and settle math are pure functions in `gesture.ts` — see
  `kiko-gestures`.
- **Switch** — a labeled toggle wrapping RN's `Switch` with theme
  track/thumb colors.
- **TextField** — a labeled text input wrapping RN's `TextInput` with
  theme tokens.
- **CurrencyBreakdown** — a two-column per-currency amount grid (code
  left, formatted `MoneyText` right), filled row-major.
- **CurrencySwitch** — a segmented base-currency toggle pill; not a
  `Button` (it is a selection control, not an action, and needs a
  transparent selected-state fill `Button` does not support).
- **OptionPills** (`src/design-system/components/option-pills/`) — a
  shared row of selectable pill options; read that folder directly
  for its current props rather than assuming it matches
  `CurrencySwitch`'s shape.
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
  of silently falling back. Takes an optional third `colorScheme`
  argument (`'light' | 'dark'`, defaults to `'dark'`) that only
  affects the gray fallback — it resolves the fallback gray from the
  matching per-theme palette (`entityColorsByScheme` in
  `palette.ts`), not a single hardcoded gray.
- `entityCardBackground` (`entity-tint.ts`) — a card's flat, OPAQUE
  `#RRGGBB` background (never an `rgba(...)` string; it does not go
  through `entityTintBackground`'s alpha compositing): the resolved
  color darkened (dark theme) or lightened (light theme), fed
  straight to `GlassSurface`'s `tint` prop. Direction is an optional
  second `colorScheme` argument (`'light' | 'dark'`, defaults to
  `'dark'`) — darken keeps white body text legible, lighten keeps
  black body text legible. Replaced a 45deg two-stop gradient wash
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
to **both** branches, or it silently only works on iOS 26+.

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
