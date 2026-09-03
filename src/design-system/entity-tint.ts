// A subtle color-tint background for an account/holding card: the entity's
// own color (one of `theme.colors.entityColors`, see theme.ts) blended at a
// low, consistent opacity over the card's surface, so a card reads as
// "this entity's color" without the fully saturated hue pulling attention
// the way a solid fill would. The account card (accounts.screen) and the
// holding card (holding-card) both paint through this helper now.

// The default tint opacity, in the middle of a deliberately narrow 8-14%
// band: low enough that a light entity color (`white`, `khaki`) still reads
// as a whisper of tint rather than a wash that fights the card surface,
// high enough that a saturated color (`red`, `violet`) stays perceptible
// against `theme.colors.surface`.
export const ENTITY_TINT_OPACITY = 0.1;

const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

// Parses a `#RRGGBB` entity-color hex into its 0-255 RGB triple. Every value
// in `theme.colors.entityColors` is `#RRGGBB`, so an unparsable input means
// the caller passed something that was never a theme token — failing loudly
// beats silently rendering an invisible or wrong tint.
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
