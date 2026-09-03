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
  accessibilityLabel,
}) => {
  const { theme } = useUnistyles();
  styles.useVariants({ variant });

  // The button owns the icon tint so it can never desync from the label:
  // white on the accent/red fills, accent on the raised surface fill.
  const iconColor = variant === 'secondary' ? theme.colors.accent : theme.colors.textPrimary;

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
      {icon !== undefined && <SymbolIcon name={icon} color={iconColor} size={18} />}
      <RNText style={styles.label}>{children}</RNText>
    </Pressable>
  );
};

export default Button;
