import type { ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

type TextVariant = 'title' | 'heading' | 'body' | 'caption';

type TextTone = 'positive' | 'negative' | 'textPrimary' | 'textSecondary';

export type TextProps = {
  variant?: TextVariant;
  tone?: TextTone;
  // An optional screen-local style override (size/weight/alignment) layered on
  // top of the variant/tone tokens — lets a screen render, e.g., a large
  // balance without minting a new design-system typography token. `color` is
  // intentionally excluded so the `tone` token stays authoritative and a caller
  // can never override the money tone (zero=white / negative=red / positive=green).
  style?: StyleProp<Pick<TextStyle, 'fontSize' | 'fontWeight' | 'textAlign'>>;
  children: ReactNode;
};
