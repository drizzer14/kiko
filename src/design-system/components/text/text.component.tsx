import type { FC } from 'react';
import { Text as RNText } from 'react-native';

import type { TextProps } from './text.props';
import { styles } from './text.styles';

const Text: FC<TextProps> = ({
  variant = 'body',
  tone = 'textPrimary',
  style,
  numberOfLines,
  adjustsFontSizeToFit,
  minimumFontScale,
  children,
}) => {
  styles.useVariants({ variant, tone });
  return (
    <RNText
      style={[styles.text, style]}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={minimumFontScale}
    >
      {children}
    </RNText>
  );
};

export default Text;
