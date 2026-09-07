import type { FC } from 'react';
import { Pressable } from 'react-native';

import SymbolIcon from '../symbol';

import type { IconButtonProps } from './icon-button.props';
import { styles } from './icon-button.styles';

// The default glyph size, matching the shared Button's own icon size (18) so an
// icon-only action reads at the same weight as an icon-adorned Button.
const ICON_BUTTON_SIZE = 18;

// An icon-only action button: a single tappable SF Symbol with the shared
// disabled dimming. For a labeled action use Button instead — this is the
// primitive for a control that is JUST an icon (e.g. a Reset glyph).
const IconButton: FC<IconButtonProps> = ({
  symbol,
  onPress,
  disabled = false,
  accessibilityLabel,
  testID,
  tint,
  size = ICON_BUTTON_SIZE,
}) => {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <SymbolIcon name={symbol} color={tint} size={size} />
    </Pressable>
  );
};

export default IconButton;
