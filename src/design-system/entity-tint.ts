import { darkTheme } from './theme';

// A subtle color-tint background for an account/holding card: the entity's
// own color (one of `theme.colors.entityColors`, see theme.ts) blended at a
// low, consistent opacity over the card's surface, so a card reads as
// "this entity's color" without the fully saturated hue pulling attention
// the way a solid fill would. The account card (accounts.screen) and the
// holding card (holding-card) both paint through this helper now, as the two
// stops of the card's 45deg gradient wash — see `entityGradientStops` below.

// The default tint opacity, in the middle of a deliberately narrow 8-14%
// band: low enough that a light entity color (`white`, `khaki`) still reads
// as a whisper of tint rather than a wash that fights the card surface,
// high enough that a saturated color (`red`, `violet`) stays perceptible
// against `theme.colors.surface`.
export const ENTITY_TINT_OPACITY = 0.1;

const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

// Parses a `#RRGGBB` hex into its 0-255 RGB triple. Every deriver of an entity
// hue in this module (tint/lighten/blend) shares THIS parser rather than
// hand-rolling a second copy — every entity-hue derivation lives here, in one
// place, per the design-system rule. Not exported: nothing outside this
// module needs a raw RGB triple, only the higher-level derivations built on
// top of it (`entityTintBackground`, `lightenHex`, etc.). An
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

// The guaranteed-safe swatch `resolveEntityColor` falls back to when BOTH the
// stored color and the kind/type default are unusable — a neutral gray that
// always exists on `theme.colors.entityColors`, so a card's gradient can
// never throw or vanish.
const FALLBACK_ENTITY_COLOR = darkTheme.colors.entityColors.gray;

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
// `FALLBACK_ENTITY_COLOR` so a card's gradient always has a valid pair of
// stops.
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

// Lightens a `#RRGGBB` hex toward white by `percent` (0-100): each channel
// moves `percent`% of the remaining distance to 255. Used to derive the
// second stop of a card's 45deg gradient wash — a subtle shift toward white
// from the base entity hue, not a desaturated pastel.
export const lightenHex = (hex: string, percent: number): string => {
  const [red, green, blue] = parseHex(hex);
  const lighten = (channel: number): string =>
    Math.round(channel + (255 - channel) * (percent / 100))
      .toString(16)
      .padStart(2, '0');

  return `#${lighten(red)}${lighten(green)}${lighten(blue)}`;
};

// The middle of the requested 8-12% "keep it subtle" lighten band (F3/design
// review), used for every card's gradient second stop.
const GRADIENT_LIGHTEN_PERCENT = 10;

// The two rgba() stops for a card's 45deg entity-color gradient wash: the
// existing flat `entityTintBackground` wash as the first stop, and that same
// wash over a slightly lighter version of the same hue as the second — same
// opacity both stops, only the underlying hue shifts, so the gradient reads
// as one subtle diagonal wash rather than two competing colors.
//
// `opacity` is returned alongside `from`/`to` (rather than left for a
// consumer to re-parse out of the rgba() strings) because `GlassSurface` must
// hand it to `react-native-svg`'s `<Stop stopOpacity>` prop SEPARATELY from
// `stopColor` — the library's native gradient extractor masks off whatever
// alpha channel is embedded in a `stopColor` rgba() string and substitutes
// `stopOpacity` (1, i.e. fully opaque, when absent) instead, so an rgba()
// string alone silently renders fully opaque regardless of its own alpha.
// See `GradientWash` in `glass-surface.component.tsx`.
export const entityGradientStops = (
  colorHex: string,
): { from: string; to: string; opacity: number } => ({
  from: entityTintBackground(colorHex),
  to: entityTintBackground(lightenHex(colorHex, GRADIENT_LIGHTEN_PERCENT)),
  opacity: ENTITY_TINT_OPACITY,
});
