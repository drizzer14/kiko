import { match } from 'ts-pattern';

import { entityColorsByScheme, entityColorsDark, entityColorsLight } from './palette';

// A subtle color-tint background: the entity's own color (one of
// `theme.colors.entityColors`, see theme.ts) blended at a low, consistent
// opacity, for any consumer that wants a translucent wash OVER an existing
// surface rather than a card's own opaque fill. The account card
// (accounts.screen) and the holding card (holding-card) do NOT paint through
// this helper — see `entityCardBackground` below, an intentionally separate,
// fully OPAQUE derivation, and its doc comment for why a translucent tint is
// the wrong shape for a card background.

// The default tint opacity, in the middle of a deliberately narrow 8-14%
// band: low enough that a light entity color (`white`, `khaki`) still reads
// as a whisper of tint rather than a wash that fights the card surface,
// high enough that a saturated color (`red`, `violet`) stays perceptible
// against `theme.colors.surface`.
//
// This `0.1` was calibrated by eye on the DARK surface only and still needs
// a light-mode design-review calibration (spec Section 5) — it is NOT
// changed here; it is a flagged follow-up (see the light-color-scheme plan's
// Non-Goals), not something Task 3 (scheme-aware `entityCardBackground` /
// `resolveEntityColor`) touches.
export const ENTITY_TINT_OPACITY = 0.1;

const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

// Parses a `#RRGGBB` hex into its 0-255 RGB triple. Every deriver of an entity
// hue in this module (tint/lighten/blend) shares THIS parser rather than
// hand-rolling a second copy — every entity-hue derivation lives here, in one
// place, per the design-system rule. Not exported: nothing outside this
// module needs a raw RGB triple, only the higher-level derivations built on
// top of it (`entityTintBackground`, `darkenHex`, etc.). An
// unparsable input means the caller passed something that was never a theme
// token — failing loudly beats silently rendering an invisible or wrong tint.
const parseHex = (hex: string): [red: number, green: number, blue: number] => {
  const match = hex.match(HEX_PATTERN);

  if (!match) {
    throw new Error(`entityTintBackground: expected a #RRGGBB hex, received "${hex}"`);
  }

  const [, digits] = match;

  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
};

// Given an entity color hex, returns that color as a translucent
// `rgba(...)` background: set as a card's own `backgroundColor` (layered
// over `theme.colors.surface` beneath it), the surface shows through at
// `1 - ENTITY_TINT_OPACITY` and the entity hue tints it at
// `ENTITY_TINT_OPACITY`.
export const entityTintBackground = (colorHex: string): string => {
  const [red, green, blue] = parseHex(colorHex);

  return `rgba(${red}, ${green}, ${blue}, ${ENTITY_TINT_OPACITY})`;
};

const isValidHex = (value: string | null | undefined): value is string =>
  typeof value === 'string' && HEX_PATTERN.test(value);

// A stored entity-color override is persisted as an absolute `#RRGGBB` hex of
// whichever theme was active at pick time (`ColorPicker` hands `onSelect` the
// active theme's raw swatch hex — see color-picker.component.tsx). Un-migrated
// existing rows in real user databases hold exactly that: a dark-palette hex
// picked on the dark theme, or a light-palette hex picked on the light theme.
// Left verbatim, a stored `white` (`#FFFFFF` on dark) stays `#FFFFFF` forever,
// even after the user switches to the light theme, where `white` should render
// as `#000000` (see palette.ts) — invisible against the light background.
//
// This reverse-maps a stored hex, by swatch NAME, to its CURRENT-scheme
// counterpart: built once from the two paired per-scheme palettes
// (`entityColorsDark`/`entityColorsLight` in palette.ts — paired 1:1 by key,
// "Only ever GROW a set" per that file's own doc comment, so this pairing
// never dangles). A hex that is not a recognized swatch in EITHER scheme is a
// custom/legacy value with no known counterpart, and is returned unchanged —
// this must never break a value that predates the palette or was never one of
// its swatches.
const swatchNames = Object.keys(entityColorsDark) as (keyof typeof entityColorsDark)[];

const buildReverseMap = (
  from: typeof entityColorsDark | typeof entityColorsLight,
  to: typeof entityColorsDark | typeof entityColorsLight,
): Map<string, string> => new Map(swatchNames.map((name) => [from[name].toLowerCase(), to[name]]));

// Keyed by the hex the stored value was picked FROM (lowercased), each maps to
// its paired counterpart in the OTHER scheme.
const REVERSE_SWATCH_MAP: Record<'light' | 'dark', Map<string, string>> = {
  // A dark-palette hex, requested against the light scheme -> its light pair.
  light: buildReverseMap(entityColorsDark, entityColorsLight),
  // A light-palette hex, requested against the dark scheme -> its dark pair.
  dark: buildReverseMap(entityColorsLight, entityColorsDark),
};

// Resolves a stored hex to the CURRENT scheme's rendering of that swatch: if
// the hex already belongs to the current scheme's own palette, it is already
// correct and returned as-is; if it belongs to the OTHER scheme's palette
// (the frozen-at-pick-time case above), it is reverse-mapped by name to this
// scheme's paired counterpart; otherwise (a custom/legacy hex) it passes
// through unchanged.
export const resolveStoredHexForScheme = (
  storedColor: string,
  colorScheme: 'light' | 'dark',
): string => {
  const currentSchemeValues = new Set<string>(Object.values(entityColorsByScheme[colorScheme]));

  if (currentSchemeValues.has(storedColor)) {
    return storedColor;
  }

  return REVERSE_SWATCH_MAP[colorScheme].get(storedColor.toLowerCase()) ?? storedColor;
};

// The guaranteed-safe swatch `resolveEntityColor` falls back to when BOTH the
// stored color and the kind/type default are unusable — a neutral gray that
// always exists on every per-theme palette, so a card's background can never
// throw or vanish. Resolved from the per-theme palette by the active scheme
// (spec Section 1/5) — still gray, but picked from the correct light/dark
// set. Defaults to 'dark' so existing two-arg callers are unchanged until
// Task 8 threads the real scheme.
const FALLBACK_ENTITY_COLOR = (colorScheme: 'light' | 'dark'): string =>
  entityColorsByScheme[colorScheme].gray;

// Resolves an account/holding's EFFECTIVE color, robust to two real gaps a
// bare `stored ?? typeDefault` misses (the pattern every card call site used
// to hand-roll inline):
//
// 1. A stored color that is a non-null, non-undefined but still unusable
//    value — an empty string, most concretely — which `??` lets straight
//    through (it only guards `null`/`undefined`) and `entityTintBackground`
//    then throws on.
// 2. An unmapped kind/type default lookup. `defaultAccountColor` /
//    `defaultHoldingColor` are typed `Record<Kind, string>`, which is only a
//    COMPILE-time guarantee. SQLite enforces no CHECK constraint on the
//    `kind`/`type` text column (Drizzle's `{ enum: [...] }` is TypeScript-only
//    annotation), so a row written under a since-removed enum member — e.g.
//    the `broker` account kind dropped in 8e2e759 — still resolves its kind
//    default lookup to `undefined` at runtime, with no compiler in the way.
//
// Either gap, combined with a null/never-set stored color, used to reach
// `entityTintBackground` with an unparsable value and throw mid-render — how
// "a card sometimes has no background at all" actually manifested: not a
// silently blank tint, but the one throwing card's whole row failing to
// render. This resolves BOTH gaps and falls back one more level to
// `FALLBACK_ENTITY_COLOR` so a card's background always has a valid color to
// resolve.
// `colorScheme` (default `'dark'`, backward-compatible with existing
// two-arg callers) only affects the final gray fallback; a valid stored
// color or typeDefault still wins unchanged regardless of scheme. Task 8
// threads the real active scheme through every call site.
export const resolveEntityColor = (
  storedColor: string | null | undefined,
  typeDefault: string | undefined,
  colorScheme: 'light' | 'dark' = 'dark',
): string => {
  if (isValidHex(storedColor)) {
    return resolveStoredHexForScheme(storedColor, colorScheme);
  }

  if (isValidHex(typeDefault)) {
    return typeDefault;
  }

  return FALLBACK_ENTITY_COLOR(colorScheme);
};

// Darkens a `#RRGGBB` hex toward black by `percent` (0-100): each channel
// moves `percent`% of the way to 0. Used to derive a card's flat background —
// a subtle shift toward black from the base entity hue, not a desaturated
// pastel.
export const darkenHex = (hex: string, percent: number): string => {
  const [red, green, blue] = parseHex(hex);
  const darken = (channel: number): string =>
    Math.round(channel * (1 - percent / 100))
      .toString(16)
      .padStart(2, '0');

  return `#${darken(red)}${darken(green)}${darken(blue)}`;
};

// Lightens a `#RRGGBB` hex toward white by `percent` (0-100): each channel
// moves `percent`% of the way to 255. The light-theme mirror of `darkenHex`,
// so a bright swatch resolves into a near-WHITE card tone that carries a
// hint of the entity hue, with BLACK body text (light `textPrimary`) legible
// on top.
export const lightenHex = (hex: string, percent: number): string => {
  const [red, green, blue] = parseHex(hex);
  const lighten = (channel: number): string =>
    Math.round(channel + (255 - channel) * (percent / 100))
      .toString(16)
      .padStart(2, '0');

  return `#${lighten(red)}${lighten(green)}${lighten(blue)}`;
};

// DEVICE BUG (F4): a card used to look at `CARD_DARKEN_PERCENT = 10` fed
// through `entityTintBackground` at the shared `ENTITY_TINT_OPACITY = 0.1` —
// darkening a color that is then stamped at 10% opacity only shifts the
// FINAL on-screen pixel by ~1% (<=2/255 per channel): imperceptible. A card
// read as plain `theme.colors.surface` no matter which entity color it held.
//
// Fixed by dropping the translucency entirely for the card path: this darken
// percent alone now has to do the FULL job of turning a bright, saturated
// swatch (`white`, `yellow`, ...) into a card-toned color, because the result
// is painted OPAQUE (see `entityCardBackground` below) with nothing further
// diluting it. 90% is deliberately near-black — pulling `#FFFFFF` down to
// `#191919` and `#FFD60A` down to `#191501`, for example — so every swatch
// resolves into a near-black card tone that still carries just a hint of the
// entity hue, with white body text comfortably legible on top, while staying
// far enough apart per swatch to read as "this entity's color". Raised from
// an initial 55% (device review: still read too light), to 70% (device
// review: plainly darker), to 90% (device review: near-black with a hint of
// hue, the chosen target).
const CARD_DARKEN_PERCENT = 90;

// Mirror of CARD_DARKEN_PERCENT for the light theme. Provisional at 85 (a hint
// stronger than the direct 90 mirror, so a light card is not washed flat to the
// white `surface`). DEVICE-REVIEWABLE — the coordinator confirms this on the
// light theme on-device this round and adjusts if a card reads too pale or too
// saturated (same review loop the darken percent went through: 55 -> 70 -> 90).
const CARD_LIGHTEN_PERCENT = 85;

// A card's flat, OPAQUE background, direction-chosen by the active theme:
// the resolved entity hue darkened (dark theme) or lightened (light theme)
// so body text — which flips white/black with `textPrimary` — stays
// legible, and used as-is — a plain `#RRGGBB`, not passed through
// `entityTintBackground`'s alpha compositing. A card's wash is painted as a
// `View` sibling over an already-opaque base (the flat themed surface on
// the fallback path, the Liquid Glass material on the glass path — see
// `GlassSurface`), so an opaque fill FULLY replaces whatever is underneath:
// the visible result is identical on both paths and cannot be diluted by a
// base layer it never blends with. This replaced a 45deg two-stop gradient
// wash (design review: a plain darker solid reads calmer and is simpler to
// reason about than a diagonal blend of two near-identical hues), then a
// translucent flat wash (the F4 device bug above). Feed the result straight
// to `GlassSurface`'s `tint` prop. `colorScheme` defaults to `'dark'` so
// existing single-arg callers are unchanged until Task 8 threads the real
// active scheme through every call site.
export const entityCardBackground = (
  colorHex: string,
  colorScheme: 'light' | 'dark' = 'dark',
): string =>
  match(colorScheme)
    .with('light', () => lightenHex(colorHex, CARD_LIGHTEN_PERCENT))
    .with('dark', () => darkenHex(colorHex, CARD_DARKEN_PERCENT))
    .exhaustive();
