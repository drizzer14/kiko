import type { FC } from 'react';
import { Pressable, Text as RNText } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import SymbolIcon from '../symbol';

import type { ButtonProps } from './button.props';
import { styles } from './button.styles';

const Button: FC<ButtonProps> = ({
  children,
  onPress,
  variant = 'primary',
  size = 'regular',
  fullWidth = true,
  disabled = false,
  icon,
  trailingIcon,
  accessibilityLabel,
  textColor,
}) => {
  const { theme } = useUnistyles();
  styles.useVariants({ variant });

  // Every variant's label is white by default (see button.styles.ts); a caller
  // may override it (e.g. a red ghost "Cancel"). The button owns a single tint
  // shared by the label and both icons, so they can never desync.
  const labelColor = textColor ?? theme.colors.textPrimary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        size === 'compact' ? styles.compact : styles.regular,
        fullWidth && styles.fullWidth,
        disabled && styles.disabled,
      ]}
    >
      {icon !== undefined && <SymbolIcon name={icon} color={labelColor} size={18} />}
      <RNText style={[styles.label, textColor !== undefined && { color: textColor }]}>
        {children}
      </RNText>
      {trailingIcon !== undefined && (
        <SymbolIcon name={trailingIcon} color={labelColor} size={18} />
      )}
    </Pressable>
  );
};

export default Button;
