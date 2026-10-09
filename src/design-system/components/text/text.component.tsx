import type { FC } from 'react';
import { Text as RNText } from 'react-native';
import { useIsOnAccent } from '@kiko/design-system/selected-surface';

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
  // On a selected surface's accent fill every tone reads as `onAccent`, whatever the caller chose.
  styles.useVariants({ variant, tone: useIsOnAccent() ? 'onAccent' : tone });

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
