import { entityColorsDark } from '../palette';

// Entity-color derivations shared across the design system: resolving an
// account/holding/category's effective hue (`resolveEntityColor`), the two
// channel-blend helpers (`lightenHex`/`darkenHex`), the squircle icon-tile
// gradient stops (`entityIconTileGradient`), and the WCAG glyph-contrast test
// (`isLightEntityColor`). Every entity-hue derivation lives here, in one place,
// per the design-system rule — never re-derived at a call site.

const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

// Parses a `#RRGGBB` hex into its 0-255 RGB triple. Every deriver of an entity
// hue in this module (tint/lighten/blend) shares THIS parser rather than
// hand-rolling a second copy — every entity-hue derivation lives here, in one
// place, per the design-system rule. Not exported: nothing outside this
// module needs a raw RGB triple, only the higher-level derivations built on
// top of it (`entityIconTileGradient`, `isLightEntityColor`, `darkenHex`,
// etc.). An unparsable input means the caller passed something that was
// never a theme token — failing loudly beats silently rendering an
// invisible or wrong tint.
const parseHex = (hex: string): [red: number, green: number, blue: number] => {
  const match = hex.match(HEX_PATTERN);

  if (!match) {
    throw new Error(`parseHex: expected a #RRGGBB hex, received "${hex}"`);
  }

  const [, digits] = match;

  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
};

const isValidHex = (value: string | null | undefined): value is string =>
  typeof value === 'string' && HEX_PATTERN.test(value);

// The guaranteed-safe swatch `resolveEntityColor` falls back to when BOTH the
// stored color and the kind/type default are unusable — a neutral gray that
// always exists on the palette, so a card's background can never throw or
// vanish.
const FALLBACK_ENTITY_COLOR = entityColorsDark.gray;

// Resolves an account/holding's EFFECTIVE color, robust to two real gaps a
// bare `stored ?? typeDefault` misses (the pattern every card call site used
// to hand-roll inline):
//
// 1. A stored color that is a non-null, non-undefined but still unusable
//    value — an empty string, most concretely — which `??` lets straight
//    through (it only guards `null`/`undefined`) and `entityIconTileGradient`/
//    `isLightEntityColor` (both feeding `EntityIconTile`) then throw on.
// 2. An unmapped kind/type default lookup. `defaultAccountColor` /
//    `defaultHoldingColor` are typed `Record<Kind, string>`, which is only a
//    COMPILE-time guarantee. SQLite enforces no CHECK constraint on the
//    `kind`/`type` text column (Drizzle's `{ enum: [...] }` is TypeScript-only
//    annotation), so a row written under a since-removed enum member — e.g.
//    the `broker` account kind dropped in 8e2e759 — still resolves its kind
//    default lookup to `undefined` at runtime, with no compiler in the way.
//
// Either gap, combined with a null/never-set stored color, used to reach
// `entityIconTileGradient`/`isLightEntityColor` with an unparsable value and
// throw mid-render — how "a card sometimes has no background at all"
// actually manifested: not a silently blank tint, but the one throwing
// card's whole row (its `EntityIconTile`) failing to render. This resolves
// BOTH gaps and falls back one more level to `FALLBACK_ENTITY_COLOR` so an
// entity's tile always has a valid color to resolve.
export const resolveEntityColor = (
  storedColor: string | null | undefined,
  typeDefault: string | undefined,
): string => {
  if (isValidHex(storedColor)) {
    return storedColor;
  }

  if (isValidHex(typeDefault)) {
    return typeDefault;
  }

  return FALLBACK_ENTITY_COLOR;
};

// Darkens a `#RRGGBB` hex toward black by `percent` (0-100): each channel
// moves `percent`% of the way to 0. The bottom stop of the icon-tile gradient
// (see `entityIconTileGradient` below) is derived from it — a subtle shift
// toward black from the base entity hue, not a desaturated pastel.
export const darkenHex = (hex: string, percent: number): string => {
  const [red, green, blue] = parseHex(hex);
  const darken = (channel: number): string =>
    Math.round(channel * (1 - percent / 100))
      .toString(16)
      .padStart(2, '0');

  return `#${darken(red)}${darken(green)}${darken(blue)}`;
};

// Lightens a `#RRGGBB` hex toward white by `percent` (0-100): each channel
// moves `percent`% of the way to 255. `darkenHex`'s mirror image — added
// alongside `entityIconTileGradient` below, the icon-tile gradient's only
// other consumer of a channel-blend helper besides `darkenHex` itself.
export const lightenHex = (hex: string, percent: number): string => {
  const [red, green, blue] = parseHex(hex);
  const lighten = (channel: number): string =>
    Math.round(channel + (255 - channel) * (percent / 100))
      .toString(16)
      .padStart(2, '0');

  return `#${lighten(red)}${lighten(green)}${lighten(blue)}`;
};

// The two gradient stops for `EntityIconTile`'s squircle-gradient treatment —
// see `design-system/components/entity-icon-tile/`. A vertical gradient of the
// entity's OWN hue, lighter at the top and darker at the bottom, following the
// design-system "one hue, several renderings" rule: never a second, unrelated
// color, always derived from `resolveEntityColor`'s result. Percentages are
// deliberately gentle — the tile is small and meant to read as a saturated,
// legible chip behind a white glyph (the iOS Settings icon-tile look).
const ICON_TILE_LIGHTEN_PERCENT = 15;
const ICON_TILE_DARKEN_PERCENT = 20;

export const entityIconTileGradient = (colorHex: string): [top: string, bottom: string] => [
  lightenHex(colorHex, ICON_TILE_LIGHTEN_PERCENT),
  darkenHex(colorHex, ICON_TILE_DARKEN_PERCENT),
];

// DEVICE BUG: `EntityIconTile` used to paint its SF
// Symbol glyph with a fixed white `onAccent` tint on every tile, regardless of
// how bright the tile's own gradient reads. Several palette swatches
// (`white`, `yellow`, `khaki`, `mint`, `teal` — see `palette.ts`) are
// themselves light enough that a white glyph on top of them fails WCAG
// contrast, reading as a near-invisible icon. `isLightEntityColor` below
// answers this with the REAL WCAG relative-luminance + contrast-ratio method
// (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance /
// https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio), computed on the
// RESOLVED entity color (never a gradient stop — the base hue represents the
// whole tile, so the check stays correct regardless of how aggressively a
// future gradient darkens/lightens its own stops), rather than the simpler
// 0-255 weighted-average "perceived brightness" approximation: a plain
// weighted average was tried first and, worked through by hand for every
// palette swatch, could not be tuned to both flag the five failing swatches
// above AND leave `violet` (already asserted staying white in
// `holding-card.component.test.tsx`) and `blue` (asserted the same way in
// `accounts.screen.test.tsx`) alone — those two sit close enough to the
// naive brightness midpoint that no single threshold on that formula placed
// every swatch correctly, while the real WCAG contrast ratio does.
const sRGBChannelToLinear = (channel: number): number => {
  const normalized = channel / 255;

  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

// WCAG relative luminance (0 = black, 1 = white) of a `#RRGGBB` hex.
const relativeLuminance = (hex: string): number => {
  const [red, green, blue] = parseHex(hex);

  return (
    0.2126 * sRGBChannelToLinear(red) +
    0.7152 * sRGBChannelToLinear(green) +
    0.0722 * sRGBChannelToLinear(blue)
  );
};

// WCAG contrast ratio between two relative luminances, order-independent
// (the formula always divides the lighter by the darker).
const contrastRatio = (luminanceA: number, luminanceB: number): number => {
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);

  return (lighter + 0.05) / (darker + 0.05);
};

// The WCAG 1.4.11 "Non-text Contrast" floor (3:1) — an SF Symbol glyph is a
// graphical UI component, not body text, so this is the applicable success
// criterion rather than the stricter 4.5:1 text-contrast ratio.
const GLYPH_CONTRAST_MINIMUM = 3;

// Whether a resolved entity color is bright enough that the standard white
// `onAccent` glyph on top of it would fail the 3:1 WCAG glyph-contrast floor
// — if so, `EntityIconTile` must switch to the dark tint instead. See the
// method note above.
export const isLightEntityColor = (colorHex: string): boolean =>
  contrastRatio(1, relativeLuminance(colorHex)) < GLYPH_CONTRAST_MINIMUM;

// The general-purpose WCAG contrast ratio between two `#RRGGBB` hex colors —
// exported so a NON-entity contrast check (e.g. `SegmentedControl`'s
// selected-segment-vs-track ratio) reuses this module's
// one `relativeLuminance`/`contrastRatio` pair instead of a second hand-
// rolled luminance implementation. `isLightEntityColor` above is the
// entity-specific glyph-on-fill case; this is the same math for any other
// two-hex comparison.
export const wcagContrastRatio = (hexA: string, hexB: string): number =>
  contrastRatio(relativeLuminance(hexA), relativeLuminance(hexB));
