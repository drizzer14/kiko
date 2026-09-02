import type { FC } from 'react';
import { Pressable, Text as RNText } from 'react-native';
import type { ButtonProps } from './button.props';
import { styles } from './button.styles';

const Button: FC<ButtonProps> = ({
  children,
  onPress,
  variant = 'primary',
  fullWidth = true,
  disabled = false,
}) => {
  styles.useVariants({ variant });

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, fullWidth && styles.fullWidth, disabled && styles.disabled]}
    >
      <RNText style={styles.label}>{children}</RNText>
    </Pressable>
  );
};

export default Button;
