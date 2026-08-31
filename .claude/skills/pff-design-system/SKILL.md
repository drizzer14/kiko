---
name: pff-design-system
description: Invoke when touching theme tokens, react-native-unistyles styles, or any of the shared primitives (Screen, Box, Text, MoneyText). Read before adding a color, spacing, typography, or radius value, and before styling a new screen.
---

# PFF design system

Source of truth: `docs/superpowers/specs/2026-08-30-pff-foundation-design.md`
("Design system (started here)" section). The actual token file
(`theme.ts`) is built in a later task; this skill states the method
and token categories now so every screen built before then already
follows the plan, not the final values (which don't exist yet).

This project skill carries domain/design knowledge. The plugin's
`design-system` workflow skill (`harness/pff/skills/design-system/SKILL.md`)
is a separate, thin process-wrapper skill for the designer role — the
two are meant to coexist, read both.

## The OLED dark theme method

Follow the Habr method (https://habr.com/ru/articles/499202/) for an
OLED-friendly dark theme:

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

`react-native-unistyles` (^3.3.0) is the styling layer. The theme
described above is authored as a Unistyles v3 theme object. Style
components against the theme's tokens, not literal values, so a
future theme refinement (the follow-up sub-project) only touches the
theme module.

## Primitive set

Four minimal primitives for this sub-project — build only these,
resist adding more until a real screen needs it:

- **Screen** — the top-level container for a screen: true-black
  background, safe-area handling, standard screen padding from the
  spacing scale.
- **Box** — a generic layout container reading spacing/color tokens
  (padding, margin, gap, background).
- **Text** — the base text primitive reading the typography and text
  color tokens; other text usage composes on top of this.
- **MoneyText** — formats a `Money` value (see `pff-domain`) using
  its `format(locale)` method, and applies the positive/negative
  money color token based on the value's sign. This is the only
  primitive that knows about `Money` — plain `Text` never receives a
  `Money` object directly.

## Wrapping a React Native primitive

Each of the four primitives wraps a real React Native component
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
`pff-code-style`'s "`ts-pattern` for exhaustive mapping").

Components are default exports with a `.component.tsx` file suffix
(`box.component.tsx`, `money-text.component.tsx`) — see
`pff-code-style`'s "Exports" and "File suffixes" sections for the
project-wide rule this follows.
