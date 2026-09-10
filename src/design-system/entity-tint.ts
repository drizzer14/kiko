import { entityColorsDark } from './palette';

// A subtle color-tint background: the entity's own color (one of
// `theme.colors.entityColors`, see theme.ts) blended at a low, consistent
// opacity, for any consumer that wants a translucent wash OVER an existing
// surface rather than a card's own opaque fill. The account card
// (accounts.screen) and the holding card (holding-card) do NOT paint through
// this helper — see `entityCardBackground` below, an intentionally separate,
// fully OPAQUE derivation, and its doc comment for why a translucent tint is
// the wrong shape for a card background.

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

// A card's flat, OPAQUE background: the resolved entity hue darkened so white
// body text stays legible, and used as-is — a plain `#RRGGBB`, not passed
// through `entityTintBackground`'s alpha compositing. A card's wash is painted
// as a `View` sibling over an already-opaque base (the flat themed surface on
// the fallback path, the Liquid Glass material on the glass path — see
// `GlassSurface`), so an opaque fill FULLY replaces whatever is underneath:
// the visible result is identical on both paths and cannot be diluted by a
// base layer it never blends with. This replaced a 45deg two-stop gradient
// wash (design review: a plain darker solid reads calmer and is simpler to
// reason about than a diagonal blend of two near-identical hues), then a
// translucent flat wash (the F4 device bug above). Feed the result straight
// to `GlassSurface`'s `tint` prop.
export const entityCardBackground = (colorHex: string): string =>
  darkenHex(colorHex, CARD_DARKEN_PERCENT);
