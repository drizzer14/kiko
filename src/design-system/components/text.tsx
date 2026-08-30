import type { FC, ReactNode } from 'react';
import { Text as RNText } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export type TextVariant = 'title' | 'heading' | 'body' | 'caption';
export type TextTone = 'positive' | 'negative' | 'textPrimary' | 'textSecondary';

export type TextProps = {
  variant?: TextVariant;
  tone?: TextTone;
  children: ReactNode;
};

export const Text: FC<TextProps> = ({ variant = 'body', tone = 'textPrimary', children }) => {
  styles.useVariants({ variant, tone });
  return <RNText style={styles.text}>{children}</RNText>;
};

const styles = StyleSheet.create(theme => ({
  text: {
    variants: {
      variant: {
        title: { ...theme.typography.title },
        heading: { ...theme.typography.heading },
        body: { ...theme.typography.body },
        caption: { ...theme.typography.caption },
      },
      tone: {
        positive: { color: theme.colors.positive },
        negative: { color: theme.colors.negative },
        textPrimary: { color: theme.colors.textPrimary },
        textSecondary: { color: theme.colors.textSecondary },
      },
    },
  },
}));
