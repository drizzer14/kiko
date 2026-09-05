// Mirrors Text's tone union (see text.props.ts).
type SymbolTone = 'positive' | 'negative' | 'textPrimary' | 'textSecondary';

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
};
