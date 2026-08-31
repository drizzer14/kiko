import type { ReactNode } from 'react';

type TextVariant = 'title' | 'heading' | 'body' | 'caption';

type TextTone = 'positive' | 'negative' | 'textPrimary' | 'textSecondary';

export type TextProps = {
  variant?: TextVariant;
  tone?: TextTone;
  children: ReactNode;
};
