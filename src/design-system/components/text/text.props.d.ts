import type { ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

// Exported so a shared component that renders through `Text` (e.g.
// `OptionPills`' optional `labelVariant`) can type its own step-override prop
// against the SAME union, instead of hand-redeclaring a parallel one that can
// drift.
export type TextVariant = 'title' | 'heading' | 'body' | 'caption';

// `onAccent` is the always-white foreground for text sitting ON a filled
// accent/destructive surface (a selected chip/pill/row's label) — the same
// token Button's primary/destructive label uses. `textPrimary` flips to
// black on the light theme and would vanish there; `onAccent` never does.
// `accent` is the systemBlue link tone — a tappable inline label (e.g. a
// legend's "Show all" toggle) that must read as interactive, not body copy.
type TextTone = 'positive' | 'negative' | 'textPrimary' | 'textSecondary' | 'onAccent' | 'accent';

export type TextProps = {
  variant?: TextVariant;
  tone?: TextTone;
  // An optional screen-local style override (size/weight/alignment/transform)
  // layered on top of the variant/tone tokens — lets a screen render, e.g., a
  // large balance without minting a new design-system typography token.
  // `color` is intentionally excluded so the `tone` token stays authoritative
  // and a caller can never override the money tone (zero=white / negative=red
  // / positive=green).
  style?: StyleProp<Pick<TextStyle, 'fontSize' | 'fontWeight' | 'textAlign' | 'textTransform'>>;
  // Single-line / shrink-to-fit controls forwarded straight to the underlying
  // RN Text. A fixed-width column (a chart's money value or Y-axis tick) sets
  // `numberOfLines={1}` with `adjustsFontSizeToFit` + `minimumFontScale` so a
  // large amount shrinks to fit rather than wrapping and breaking alignment.
  // All optional; when absent, wrapping behavior is unchanged.
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
  children: ReactNode;
};
