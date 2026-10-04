// Mirrors Text's tone union (see text.props.ts), including `onAccent` — the
// always-white foreground for a glyph sitting on a filled accent surface
// (a selected chip/pill/row's icon), which `textPrimary` cannot provide on
// the light theme (it flips to black there) — and `accent` — the systemBlue
// tone for a glyph paired with a tappable inline accent label (e.g. a
// disclosure chevron beside a "Show more"/"Show less" toggle).
type SymbolTone = 'positive' | 'negative' | 'textPrimary' | 'textSecondary' | 'onAccent' | 'accent';

export type SymbolProps = {
  name: string;
  size?: number;
  tone?: SymbolTone;
  // An explicit tint color (any CSS color string; hex or rgba). When set it
  // overrides `tone`, so a caller can tint the glyph with an entity color drawn
  // from the palette rather than one of the fixed tone tokens. Normalized to the
  // hex form SFSymbolView needs by the same helper `tone` goes through.
  color?: string;
  accessibilityLabel?: string;
  testID?: string;
};
