// iOS system palette — the single dark theme (spec Section 2: spacing, radii,
// and typography are shared with the token shape).
//
// Dark re-derived from Apple's dark-mode system colors (see
// docs/superpowers/specs/2026-08-30-kiko-foundation-design.md and
// .claude/skills/kiko-design-system/SKILL.md):
// - true-black background (systemBackground, dark)
// - secondary/tertiary system background levels for elevated surfaces
// - label / secondaryLabel for primary and secondary text
// - systemBlue for the accent, systemGreen/systemRed for money tones
// - separator for hairline borders
//
// The named entity-color and chart-series palettes live in ./palette
// (entityColorsDark, chartSeriesDark); the theme references those sets.

import { chartSeriesDark, entityColorsDark } from './palette';

const spacing = (multiplier: number) => multiplier * 4;
const radii = { sm: 6, md: 10, lg: 16 } as const;
const typography = {
  // One step above `title` — a hero numeral (e.g. Home's net-worth
  // balance), styled at the same weight but larger, for the one or two
  // spots that need to read as the single most prominent figure on screen.
  display: { fontSize: 44, fontWeight: '700' as const },
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

export const darkTheme = {
  colors: {
    background: '#000000', // systemBackground (dark)
    surface: '#1C1C1E', // secondarySystemBackground
    // The `surface` hue (#1C1C1E) at 60% alpha — the see-through frosted-panel
    // fill for a `transparent` GlassSurface (see its `transparent` prop). It is
    // used in two matching places so the glass and the non-glass fallback paths
    // read alike: as the translucent backdrop the see-through glass material
    // samples (a partial pin that softens the live-sample lightness drift), and
    // as the flat fill on the non-glass fallback. Over the true-black
    // `background` it composites to ~rgb(17,17,18), so white `textPrimary` body
    // text stays legible on it. This is a distinct token from `scrim` (the
    // modal dim) — same alpha convention, different role.
    surfaceTranslucent: 'rgba(28,28,30,0.60)',
    // The same #1C1C1E hue as `surfaceTranslucent`, but a HIGHER alpha (0.80 vs
    // 0.60) — a stronger backdrop pin for a scrolling card that must drift LESS
    // in lightness on scroll while staying see-through. It is the middle option
    // between `transparent`'s 0.60 partial pin and an opaque `tint` card: more
    // opaque than `surfaceTranslucent`, still translucent (never 1.0). This is
    // the Home transaction card's backdrop.
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
    // predictably regardless of what the glass is sampling. 0.30 sits below
    // `scrim`'s 0.4 (a near-opaque modal dim is not the goal here) and well
    // above the failed 0.20-alpha backdrop-only delta, chosen to read as a
    // clear, deliberate step down in lightness from `transparent` on device
    // while keeping the card glassy and see-through. See `GlassSurface`'s
    // `translucentStrong` prop doc and its component-level block comment for
    // the exact layer this feeds.
    surfaceWashStrong: 'rgba(0,0,0,0.30)',
    surfaceHigh: '#2C2C2E', // tertiarySystemBackground
    // The base fill for a presented bottom sheet — the iOS
    // `systemGroupedBackground` (dark, elevated) equivalent. A sheet is a
    // grouped surface: its base sits one level BELOW the cards/controls on it,
    // so a control on the sheet (an OptionPills selected pill, at `surfaceHigh`)
    // reads as raised instead of blending into the sheet. Before this, the sheet
    // used `surfaceHigh` itself, the SAME tone as a selected pill, so the two
    // blended (on-device review). This is `#1C1C1E` — the same value as
    // `surface` today, but kept a DISTINCT semantic token (like `onAccent` vs
    // `textPrimary`) because its role is the sheet's grouped base, not a card
    // surface, and the two may diverge. It is deliberately NOT the true-black
    // `background`: a pure-black sheet would vanish against the black screen
    // behind it instead of reading as an elevated card.
    sheetBackground: '#1C1C1E',
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
    // The translucent-black dismiss scrim behind a modal/bottom-sheet
    // overlay (BottomSheet). NOT the opaque `background` token: a modal
    // scrim reads as a frosted dim over whatever screen is behind it — real
    // blur via LiquidGlassView where iOS 26+ supports it, this flat
    // translucent black as the scrim's own tint (layered under the glass
    // material) and as the non-liquid-glass fallback's dim.
    //
    // Lowered from 0.55 to 0.4 when the sheet's own background moved to
    // GlassSurface's `material` (live-blur) variant: the sheet's glass now
    // samples the LIVE content behind it, which is this same scrim — a
    // full-bleed sibling painted behind the whole overlay, sheet included
    // (see `bottom-sheet.styles.ts`'s `backdrop`/`overlay`). At 0.55 the
    // sheet's live sample was of an already-heavily-dimmed backdrop, so the
    // "real blur" read as a near-solid dark panel again, defeating the
    // fix. 0.4 still keeps a clear dim for the exposed area above the sheet
    // (this token has exactly one consumer, BottomSheet's scrim — see
    // `bottom-sheet.component.tsx`/`bottom-sheet.styles.ts` — so this change
    // cannot affect any other surface).
    scrim: 'rgba(0,0,0,0.4)',
    entityColors: entityColorsDark,
    chartSeries: chartSeriesDark,
  },
  spacing,
  radii,
  typography,
  iconSizes,
} as const;
