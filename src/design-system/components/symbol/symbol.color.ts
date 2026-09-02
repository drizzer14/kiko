// `react-native-nitro-sfsymbols`'s `tintColor` prop is documented to accept
// only `#RGB`, `#RRGGBB`, or `#RRGGBBAA` hex strings (see
// `NitroSfsymbolsProps.tintColor` in the library's `.nitro.ts` spec) — the
// native bridge parses hex directly and has no CSS color parser behind it.
// Most theme tokens (see `design-system/theme.ts`) are already hex, but
// `colors.textSecondary` is `'rgba(235,235,245,0.60)'` (the iOS
// `secondaryLabel` translucency convention, shared with `Text`/`MoneyText`,
// which both go through React Native's own color parser and have no
// trouble with `rgba(...)`). Handed to `tintColor` as-is, that string fails
// to parse on the native side and the symbol silently renders in a
// default/fallback color instead of throwing — on a black screen this
// reads as a fully invisible glyph, easy to mistake for a layout or
// view-flattening bug. This normalizes any `rgba()`/`rgb()` theme color to
// the `#RRGGBBAA` hex form `SFSymbolView` actually understands; strings
// that are already hex (or any other CSS color keyword) pass through
// unchanged.
const RGBA_PATTERN = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

const byteToHex = (byte: number): string => byte.toString(16).padStart(2, '0');

export const toSFSymbolTintColor = (color: string): string => {
  const match = color.match(RGBA_PATTERN);

  if (!match) {
    return color;
  }

  const [, r, g, b, a] = match;
  const alphaByte = a === undefined ? 255 : Math.round(Number(a) * 255);

  return '#'.concat(
    byteToHex(Number(r)),
    byteToHex(Number(g)),
    byteToHex(Number(b)),
    byteToHex(alphaByte),
  );
};
