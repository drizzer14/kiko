// Per-theme entity/chart palettes (spec Section 1 per-theme decision, which
// REVERSES the earlier shared-palette decision). Each named swatch/series color
// has a dark value and a light value, using Apple's light/dark system-color
// pairs where one exists so a swatch is legible on its own background. A hue
// stays in the same family across sets (only its value is tuned for contrast),
// so a user-picked color still reads as "the same color" after a mode switch.
// Only ever GROW a set (never remove/rename a key) so an existing default
// mapping never dangles. Consumers pick a set with `entityColorsByScheme[scheme]`
// / `chartSeriesByScheme[scheme]`, where `scheme` is the active color scheme
// (resolveColorScheme(rt.themeName), see color-scheme.ts).
//
// Dark set: Apple dark-mode system-color values. The `blue`/`green` hexes are
// inlined literals (previously aliased to the theme `accent`/`positive`), now
// decoupled because `accent`/`positive` are themselves per-theme.
export const entityColorsDark = {
  white: '#FFFFFF',
  khaki: '#BDB76B',
  brown: '#AC8E68', // systemBrown (dark)
  yellow: '#FFD60A', // systemYellow (dark)
  blue: '#0A84FF', // systemBlue (dark) — matches darkTheme.colors.accent
  green: '#30D158', // systemGreen (dark) — matches darkTheme.colors.positive
  mint: '#66D4CF', // systemMint (dark)
  violet: '#BF5AF2', // systemPurple (dark)
  red: '#FF453A', // systemRed (dark)
  orange: '#FF9F0A', // systemOrange (dark)
  teal: '#40C8E0', // systemTeal (dark)
  pink: '#FF375F', // systemPink (dark)
  indigo: '#5E5CE6', // systemIndigo (dark)
  gray: '#98989D', // systemGray (dark)
} as const;

// Light set: Apple light system-color values where a pair exists. Four swatches
// have no usable Apple pair on white (khaki: no pair at all; yellow/mint:
// Apple's own light pair measures under 3:1 on white) and are instead derived
// from the dark counterpart's hue (see the task table for the computed
// contrast ratio behind each). `white` is the one swatch where no light
// neutral can both read as "white/silver" and clear 3:1 without colliding with
// `gray`, so it flips to the opposite pole of the same achromatic family:
// plain black, 21:1 against white, the maximum possible ratio.
export const entityColorsLight = {
  white: '#000000', // no Apple pair — flip to opposite achromatic pole (21:1 on white)
  khaki: '#8D873F', // derived: dark khaki hue, lightness lowered to 40% (3.70:1)
  brown: '#A2845E', // systemBrown (light)
  yellow: '#B8860B', // deepened amber "DarkGoldenrod" (3.25:1) — systemYellow light fails 3:1
  blue: '#007AFF', // systemBlue (light) — matches lightTheme.colors.accent
  green: '#34C759', // systemGreen (light) — matches lightTheme.colors.positive
  mint: '#009992', // derived: systemMint hue, lightness lowered to 30% (3.52:1)
  violet: '#AF52DE', // systemPurple (light)
  red: '#FF3B30', // systemRed (light)
  orange: '#FF9500', // systemOrange (light)
  teal: '#30B0C7', // systemTeal (light)
  pink: '#FF2D55', // systemPink (light)
  indigo: '#5856D6', // systemIndigo (light)
  gray: '#8E8E93', // systemGray (light)
} as const;

// Categorical palette for charts (line series / pie slices). Eight hues, each
// distinct from its neighbours. Consumers cycle with
// `series[i % series.length]`.
//
// INVARIANT: every chartSeries hue MUST remain a subset of the same scheme's
// entityColors hexes. The add-category color picker rings the swatch whose hex
// equals the resolved category color (resolveCategoryColor), and an uncolored
// category resolves to its chartSeries fallback — so a fallback hue with no
// matching entityColors swatch would ring nothing. Enforced by palette.test.ts. The dark set is the pre-existing palette; the
// light set is its light-mode counterpart, same order (index i is the same hue
// family in both). The 7th entry is the deepened `DarkGoldenrod` `#B8860B`
// (3.25:1 against white), matching the entity `yellow` note above.
export const chartSeriesDark = [
  '#0A84FF', // systemBlue
  '#30D158', // systemGreen
  '#FF9F0A', // systemOrange
  '#BF5AF2', // systemPurple
  '#40C8E0', // systemTeal
  '#FF375F', // systemPink
  '#FFD60A', // systemYellow
  '#5E5CE6', // systemIndigo
] as const satisfies readonly string[];

export const chartSeriesLight = [
  '#007AFF', // systemBlue (light)
  '#34C759', // systemGreen (light)
  '#FF9500', // systemOrange (light)
  '#AF52DE', // systemPurple (light)
  '#30B0C7', // systemTeal (light)
  '#FF2D55', // systemPink (light)
  '#B8860B', // DarkGoldenrod (3.25:1) — deepened yellow, matches entity yellow
  '#5856D6', // systemIndigo (light)
] as const satisfies readonly string[];

// Scheme-keyed lookups: every palette consumer indexes these with the active
// color scheme rather than importing a single set directly, so a light/dark
// switch swaps the whole palette in one place.
export const entityColorsByScheme = {
  dark: entityColorsDark,
  light: entityColorsLight,
} as const;

export const chartSeriesByScheme = {
  dark: chartSeriesDark,
  light: chartSeriesLight,
} as const;
