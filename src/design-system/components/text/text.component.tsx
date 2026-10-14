import type { FC } from 'react';
import { Text as RNText } from 'react-native';

import { styles } from './text.styles';
import type { TextProps } from './text.props';

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
      // The native large title is a fixed 34pt, so this variant must not scale.
      allowFontScaling={variant !== 'largeTitle'}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={minimumFontScale}
    >
      {children}
    </RNText>
  );
};

export default Text;
