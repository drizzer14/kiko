// iOS system palette — the single dark theme (spacing, radii, and typography
// are shared with the token shape).
//
// Dark re-derived from Apple's dark-mode system colors (see
// .claude/skills/kiko-design-system/SKILL.md):
// - true-black background (systemBackground, dark)
// - secondary/tertiary system background levels for elevated surfaces
// - label / secondaryLabel for primary and secondary text
// - systemBlue for the accent, systemGreen/systemRed for money tones
// - separator for hairline borders
//
// The named entity-color and chart-series palettes live in ../palette
// (entityColorsDark, chartSeriesDark); the theme references those sets.

import { StyleSheet } from 'react-native';

import {
  type ColorScheme,
  categoryColorsLight,
  chartFillDark,
  chartFillLight,
  chartSeriesDark,
  chartSeriesLight,
  entityColorsDark,
  entityColorsLight,
} from '../palette';

const spacing = (multiplier: number) => multiplier * 4;
// `full` is a capsule/pill sentinel, not a fourth point value in the sm/md/lg
// progression: it is set well past any control's half-height (the point past
// which a corner radius stops changing the silhouette), so both iOS's native
// corner-radius clamping (a `UIView`/Liquid Glass layer) and React Native's
// Yoga layout clamp it down to exactly half the control's shorter dimension —
// a true capsule at ANY height, with no need to know or match that height
// here. `GlassSurface`'s `radius="full"` (the keyboard Done accessory pill,
// `use-keyboard-done-accessory.tsx`) is the first consumer.
const radii = { sm: 6, md: 10, lg: 16, full: 999 } as const;
const typography = {
  // One step above `title` — a hero numeral (e.g. Home's net-worth
  // balance), styled at the same weight but larger, for the one or two
  // spots that need to read as the single most prominent figure on screen.
  display: { fontSize: 44, fontWeight: '700' as const },
  // Mirrors the native navigation-bar large title (react-native-screens
  // RNSScreenStackHeaderConfig.mm: a fixed 34pt bold system font, no Dynamic
  // Type), so an in-screen full-title heading matches it. `Text` renders it
  // with font scaling off for the same reason.
  largeTitle: { fontSize: 34, fontWeight: '700' as const, lineHeight: 41 },
  title: { fontSize: 28, fontWeight: '700' as const },
  heading: { fontSize: 20, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
} as const;

// Semantic icon sizes, one per type-scale step. An SF Symbol sits beside text
// almost everywhere it appears, so its size is derived from the paired text
// token rather than chosen ad hoc: each icon is its type step's `fontSize`
// times a single fixed ratio, rounded to the nearest point. iOS Human
// Interface Guidelines (HIG): a symbol should read as a peer of, and sit
// slightly heavier than, the text beside it, so the glyph stays balanced with
// the label as Dynamic Type scales the pair together. `body` (20) is the
// default icon size — it matches the long-standing SymbolIcon default and the
// account/holding card glyphs; buttons and list rows standardize onto it from
// their former ad-hoc 18. Keyed by the same names as `typography` so a call
// site reads `theme.iconSizes.body` next to `theme.typography.body`.
const ICON_TO_TEXT_RATIO = 1.25;
const iconSize = (fontSize: number) => Math.round(fontSize * ICON_TO_TEXT_RATIO);
const iconSizes = {
  caption: iconSize(typography.caption.fontSize), // 13 -> 16
  body: iconSize(typography.body.fontSize), // 16 -> 20 (the default)
  heading: iconSize(typography.heading.fontSize), // 20 -> 25
  title: iconSize(typography.title.fontSize), // 28 -> 35
  display: iconSize(typography.display.fontSize), // 44 -> 55
} as const;

// Two-pane (Duo) layout: a pane's screen content (lists and forms, never the native bars) is
// centred and capped at `paneMaxWidth`, except in a pane under a top tab bar, so a wide pane never
// stretches a form line across the screen; `hairline` is the flat-window divider.
// `sheetMaxWidth` is the width a BottomSheet card narrows to on a two-pane display: 540 pt is
// UIKit's default form-sheet width, the width an iPad presents a sheet at.
// `selectTriggerMaxWidth` is the widest a capped select trigger grows (a field whose label is one
// short phrase, such as a period): 240 pt holds the longest such label at the default text size on
// one line, and a larger Dynamic Type size wraps it inside the cap instead of widening the field.
const layout = {
  paneMaxWidth: 600,
  sheetMaxWidth: 540,
  selectTriggerMaxWidth: 240,
  hairline: StyleSheet.hairlineWidth,
} as const;

// The glyph on a tile too light for the white `onAccent` glyph, shared by both themes. A fixed
// black, not the `background` token: on light that token is a pale gray and would put a pale
// glyph on a pale tile. In dark it is the same black the tile code read from `background`.
const glyphOnLightTile = '#000000';

export const darkTheme = {
  colorScheme: 'dark' as ColorScheme,
  colors: {
    background: '#000000', // systemBackground (dark)
    // `#111112` (rgb 17,17,18) — DARKENED from the original `#1C1C1E`
    // (secondarySystemBackground) on live-review feedback: the solid content
    // `Card` fill (see `card.styles.ts`) read too bright at `#1C1C1E`. This is
    // not an arbitrary darker pick — it is the EXACT tone a translucent glass
    // card composites to: `surfaceTranslucent` below (`rgba(28,28,30,0.60)`,
    // the `#1C1C1E` hue) over the true-black `background` blends to
    // ~rgb(17,17,18). So the flat `Card` fill reads identically to a frosted
    // `GlassSurface` card on the same screen. `surfaceTranslucent`/
    // `surfaceTranslucentStrong` keep their own `#1C1C1E`-hue rgba literals
    // below — they are not tied to this token's value (see each one's own doc
    // comment) — so a change to this token cannot silently drift them.
    surface: '#111112',
    // The `#1C1C1E` hue at 60% alpha — the see-through frosted-panel fill for
    // a `transparent` GlassSurface (see its `transparent` prop). It is used
    // in two matching places so the glass and the non-glass fallback paths
    // read alike: as the translucent backdrop the see-through glass material
    // samples (a partial pin that softens the live-sample lightness drift), and
    // as the flat fill on the non-glass fallback. Over the true-black
    // `background` it composites to ~rgb(17,17,18) — the same tone `surface`
    // above is now pinned to directly, so a solid `Card` and a translucent
    // `GlassSurface` panel read as the same darkness even though only one of
    // them still does any live sampling. This is a distinct token from
    // `scrim` (the modal dim) — same alpha convention, different role.
    surfaceTranslucent: 'rgba(28,28,30,0.60)',
    // The same `#1C1C1E` hue as `surfaceTranslucent`, but a HIGHER alpha (0.80
    // vs 0.60) — a stronger backdrop pin for a scrolling card that must drift
    // LESS in lightness on scroll while staying see-through. It is the middle
    // option between `transparent`'s 0.60 partial pin and an opaque `tint`
    // card: more opaque than `surfaceTranslucent`, still translucent (never
    // 1.0). This is the Home transaction card's backdrop.
    surfaceTranslucentStrong: 'rgba(28,28,30,0.80)',
    // A NEUTRAL DARK overlay painted OVER the finished `translucentStrong`
    // GlassSurface (its `wash` layer — a sibling drawn atop the glass base, not
    // a backdrop under it). Device bug fix: `surfaceTranslucentStrong` alone
    // (0.60 -> 0.80 alpha) was INVISIBLE on the Home transaction card — a
    // `LiquidGlassView` with `effect="regular"` samples/refracts whatever sits
    // behind it, so a backdrop-alpha bump under the glass gets washed out by
    // that live sample instead of reliably darkening the visible surface. A
    // flat `View` drawn ON TOP of the already-composited glass is not subject
    // to that refraction — its alpha darkens the final pixel directly — so this
    // is the reliable lever for "visibly darker, still see-through." Plain
    // black (not the `#1C1C1E` surface hue) because a wash over live glass
    // needs no hue of its own, only a darkening step, and pure black composites
    // predictably regardless of what the glass is sampling. 0.38 stays below
    // `scrim`'s 0.4 (a near-opaque modal dim is not the goal here) and well
    // above the failed 0.20-alpha backdrop-only delta. A bare 0.30 read too light
    // on device and needed only "a bit darker" — a small step, not a big jump —
    // so this is a modest +0.08 bump from that value, still chosen to read as
    // a clear, deliberate step down in lightness from `transparent` on device
    // while keeping the card glassy and see-through. See `GlassSurface`'s
    // `translucentStrong` prop doc and its component-level block comment for
    // the exact layer this feeds.
    surfaceWashStrong: 'rgba(0,0,0,0.38)',
    surfaceHigh: '#2C2C2E', // tertiarySystemBackground
    // The base fill for a presented bottom sheet — the iOS
    // `systemGroupedBackground` (dark, elevated) equivalent. A sheet is a
    // grouped surface: its base sits one level BELOW the cards/controls on it,
    // so a control on the sheet reads as raised instead of blending into the
    // sheet. Before this, the sheet used `surfaceHigh` itself, the SAME tone as
    // a raised pill, so the two blended. This is `#1C1C1E` — kept a DISTINCT
    // semantic token from `surface` (like `onAccent` vs `textPrimary`)
    // because its role is the sheet's grouped base, not a card surface, and
    // the two were always meant to be free to diverge: `surface` was later
    // darkened to `#111112` (see its own doc comment) while `sheetBackground`
    // stayed at the original `#1C1C1E` — the two tokens sharing a literal
    // value was only ever a coincidence of the moment this comment was
    // written, never a guarantee callers could rely on. It is deliberately
    // NOT the true-black `background`: a pure-black sheet would vanish
    // against the black screen behind it instead of reading as an elevated
    // card.
    sheetBackground: '#1C1C1E',
    // The selected-segment thumb for `SegmentedControl`: a lighter raised
    // thumb on the faint `neutralSubtle` track, the native iOS look. The
    // track is translucent, so it composites over whatever sits behind the
    // control — the true-black screen or a card/sheet at `surface`. iOS's own
    // `#636366` thumb reaches only ~2.4:1 against the track over `surface`,
    // under WCAG 1.4.11's 3:1 floor for a UI state indicator; this value is
    // the lightest step that clears 3:1 on both backdrops (about 3.1:1 over
    // `surface`, 3.65:1 over black) while the white selected label stays
    // legible on it (about 4.65:1, above 4.5:1). Its own token, not folded
    // into `surfaceHigh`, because it is tuned for this one contrast need.
    segmentSelected: '#747478',
    textPrimary: '#FFFFFF', // label
    textSecondary: 'rgba(235,235,245,0.60)', // secondaryLabel
    accent: '#0A84FF', // systemBlue (dark)
    // Foreground for anything sitting ON a filled accent/destructive surface —
    // a primary Button's label+icon, a Switch thumb on the accent track. Always
    // white and kept as its own token (never `textPrimary`) so text on a
    // blue/red fill stays legible.
    onAccent: '#FFFFFF',
    positive: '#30D158', // systemGreen (dark)
    negative: '#FF453A', // systemRed (dark)
    // The systemRed hue (#FF453A) at 0.18 alpha — the translucent fill for the
    // `destructiveTonal` Button variant (the iOS "tinted destructive" pattern:
    // a low-opacity red BACKGROUND under red `negative` TEXT, not a solid bright
    // fill). Over the true-black `background` it composites to a dark red
    // (~rgb(46,12,10)), so the bright `negative` label stays high-contrast and
    // legible on it. This is a distinct token from the solid `negative` fill:
    // `negative` is the bright surface a solid `destructive` Button paints,
    // `negativeSubtle` is the muted tint the tonal variant paints. Because the
    // text ON this tint is the SAME red hue (the tinted-button convention), the
    // tonal variant is the deliberate exception to the `onAccent` rule — that
    // rule governs text on a SOLID accent/destructive fill, not on a same-hue
    // tint.
    negativeSubtle: 'rgba(255,69,58,0.18)',
    // A faint NEUTRAL translucent tint — the iOS `tertiarySystemFill` (dark) —
    // for the `secondaryTonal` Button variant (a lower-emphasis inline action
    // that carries a faint tinted background, the neutral counterpart to
    // `destructiveTonal`'s `negativeSubtle`). This is DISTINCT from the SOLID
    // `surfaceHigh` (#2C2C2E) a plain `secondary` Button paints: it is
    // translucent and lighter, so a small inline action (Connect, Sync now, a
    // per-row Add, the category set-default) reads as a faint tint rather than a
    // solid raised pill. Over the true-black `background` it stays subtle while
    // keeping a `textPrimary` (white) label legible on it.
    neutralSubtle: 'rgba(118,118,128,0.24)',
    border: '#38383A', // separator (dark)
    // The alternate-row ground of a table: a faint white veil, translucent so it lies over the
    // `surface` of the fixed column and the screen background under the scrolled rows alike.
    rowBand: 'rgba(255,255,255,0.04)',
    // The ground of a table's sum columns (total, average): translucent, so the row band runs
    // across them too; about the old opaque `sheetBackground` over the black screen.
    sumTint: 'rgba(255,255,255,0.10)',
    // The translucent-black dismiss scrim behind a modal/bottom-sheet
    // overlay (BottomSheet) on iOS 26+. NOT the opaque `background` token: a
    // modal scrim reads as a frosted dim over whatever screen is behind it —
    // real blur via LiquidGlassView, with this translucent black as the
    // scrim's own tint (layered under the glass material). Below iOS 26 the
    // dim is `scrimFallback`.
    //
    // 0.4, not heavier: the sheet's own background is GlassSurface's
    // `material` (live-blur) variant, so its glass samples the LIVE content
    // behind it, which is this same scrim — a full-bleed sibling painted
    // behind the whole overlay, sheet included (see `bottom-sheet.styles.ts`'s
    // `backdrop`/`overlay`). At 0.55 the sheet's live sample would be of an
    // already-heavily-dimmed backdrop, so the "real blur" would read as a
    // near-solid dark panel. 0.4 still keeps a clear dim for the exposed area
    // above the sheet (this token has exactly one consumer, BottomSheet's
    // scrim — see `bottom-sheet.component.tsx`/`bottom-sheet.styles.ts` — so
    // changing it cannot affect any other surface).
    scrim: 'rgba(0,0,0,0.4)',
    // The dismiss scrim for iOS < 26, where no Liquid Glass exists (BottomSheet's
    // non-glass branch). The 0.4 reasoning above is about a sheet that samples the
    // live scrim; the iOS < 26 sheet is opaque (`sheetBackground`), so nothing
    // samples this dim and it can be the heavier 0.55. The glass path keeps
    // `scrim`.
    scrimFallback: 'rgba(0,0,0,0.55)',
    entityColors: entityColorsDark,
    // Dark has one swatch set for accounts, holdings and categories alike, so the category
    // set is the entity set; light splits them (see `categoryColorsLight`).
    categoryColors: entityColorsDark,
    chartSeries: chartSeriesDark,
    glyphOnLightTile,
  },
  chartFill: chartFillDark,
  spacing,
  radii,
  typography,
  iconSizes,
  layout,
} as const;

// The light theme. Every value comes from docs/design/light-palette/palette.json (pinned by
// palette/light-palette-source.test.ts); the non-color scales are the dark theme's own objects.
// `satisfies` the dark key shape, so a token added to dark and missed here fails to type-check.
const lightColors = {
  background: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceTranslucent: 'rgba(255,255,255,0.60)',
  surfaceTranslucentStrong: 'rgba(255,255,255,0.80)',
  surfaceWashStrong: 'rgba(255,255,255,0.38)',
  surfaceHigh: '#E5E5EA',
  sheetBackground: '#F2F2F7',
  segmentSelected: '#FFFFFF',
  textPrimary: '#000000',
  textSecondary: 'rgba(60,60,67,0.78)',
  accent: '#0066E6',
  onAccent: '#FFFFFF',
  positive: '#0F7A4A',
  negative: '#C20019',
  negativeSubtle: 'rgba(194,0,25,0.12)',
  neutralSubtle: 'rgba(118,118,128,0.12)',
  border: '#C6C6C8',
  rowBand: 'rgba(0,0,0,0.04)',
  sumTint: 'rgba(60,60,67,0.06)',
  scrim: 'rgba(0,0,0,0.3)',
  scrimFallback: 'rgba(0,0,0,0.4)',
  entityColors: entityColorsLight,
  categoryColors: categoryColorsLight,
  chartSeries: chartSeriesLight,
  glyphOnLightTile,
} as const satisfies Record<keyof typeof darkTheme.colors, unknown>;

export const lightTheme = {
  colorScheme: 'light' as ColorScheme,
  colors: lightColors,
  chartFill: chartFillLight,
  spacing,
  radii,
  typography,
  iconSizes,
  layout,
} as const satisfies Record<keyof typeof darkTheme, unknown>;
