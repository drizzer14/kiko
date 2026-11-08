// The entity/chart palettes. Each named swatch/series color uses Apple's
// dark-mode system-color value. Only ever GROW a set (never remove/rename a
// key) so an existing default mapping never dangles.
//
// Dark set: Apple dark-mode system-color values. The `blue`/`green` hexes are
// inlined literals, decoupled from the theme `accent`/`positive` tokens.
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

export type SwatchName = keyof typeof entityColorsDark;

// Which of the two registered themes a surface reads; carried on each theme.
export type ColorScheme = 'dark' | 'light';

// Categorical palette for charts (line series / pie slices). Eight hues, each
// distinct from its neighbours. Consumers cycle with
// `series[i % series.length]`.
//
// INVARIANT: every chartSeries hue MUST remain a subset of the
// entityColors hexes. The add-category color picker rings the swatch whose hex
// equals the resolved category color (resolveCategoryColor), and an uncolored
// category resolves to its chartSeries fallback — so a fallback hue with no
// matching entityColors swatch would ring nothing. Enforced by palette.test.ts.
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

// Light twins of the dark set, from docs/design/light-palette/palette.json (pinned by
// light-palette-source.test.ts). Stored colors stay the dark hex; these are only the display
// value. Keyed by the dark set, so a key can never exist on one side only. The dark blocks come
// first because the palette check reads this file by text position.
//
// Tile fill for an account or holding. The tile is not held to 3:1 against the page: the glyph on
// it is picked per tile for contrast, and a bare glyph or line draws a darker mark instead.
export const entityColorsLight: Record<SwatchName, string> = {
  white: '#47434F',
  khaki: '#757650',
  brown: '#453725',
  yellow: '#E8B33B',
  blue: '#074FB0',
  green: '#056407',
  mint: '#ADE1D6',
  violet: '#D7A9FE',
  red: '#B9040E',
  orange: '#AA7023',
  teal: '#3D7E92',
  pink: '#FF6A82',
  indigo: '#7D67D6',
  gray: '#9BA1AF',
};

// The same values as the entity set on purpose: one light hue per name, so an account tile and a
// category tile of one color match. Kept as its own export so a set can diverge later without a
// consumer change.
export const categoryColorsLight: Record<SwatchName, string> = {
  white: '#47434F',
  khaki: '#757650',
  brown: '#453725',
  yellow: '#E8B33B',
  blue: '#074FB0',
  green: '#056407',
  mint: '#ADE1D6',
  violet: '#D7A9FE',
  red: '#B9040E',
  orange: '#AA7023',
  teal: '#3D7E92',
  pink: '#FF6A82',
  indigo: '#7D67D6',
  gray: '#9BA1AF',
};

// The same eight hues in the same order as chartSeriesDark, read from the category set. The subset
// invariant above is about entityColors and does not carry over: a light chart hue is a subset of
// categoryColorsLight (by construction here, pinned by palette.contrast.test.ts), not of
// entityColorsLight.
export const chartSeriesLight: readonly string[] = (
  ['blue', 'green', 'orange', 'violet', 'teal', 'pink', 'yellow', 'indigo'] as const
).map((name) => categoryColorsLight[name]);

// The alpha of the net-worth area band's stop next to the line, from the file's chartParameters
// (pinned by light-palette-source.test.ts). Dark needs the higher negative alpha because blending
// toward black loses the color; on white the same alpha as the positive band already reads.
type ChartFill = { areaOpacity: number; negativeAreaOpacity: number };

export const chartFillDark: ChartFill = { areaOpacity: 0.3, negativeAreaOpacity: 0.5 };

export const chartFillLight: ChartFill = { areaOpacity: 0.3, negativeAreaOpacity: 0.3 };
