import type { FC } from 'react';
import { Text as RNText } from 'react-native';
import type { TextProps } from './text.props';
import { styles } from './text.styles';

const Text: FC<TextProps> = ({ variant = 'body', tone = 'textPrimary', children }) => {
  styles.useVariants({ variant, tone });
  return <RNText style={styles.text}>{children}</RNText>;
};

export default Text;
