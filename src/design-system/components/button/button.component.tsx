import type { FC } from 'react';
import { Pressable, Text as RNText } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { match } from 'ts-pattern';

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
  testID,
}) => {
  const { theme } = useUnistyles();
  styles.useVariants({ variant });

  // primary/destructive sit on a filled accent/red surface, so their label +
  // icon need the always-white `onAccent` token — `textPrimary` flips to
  // black on light and would vanish. secondary/ghost sit on `surfaceHigh` /
  // transparent, which need the adapting `textPrimary`. destructiveTonal sits
  // on the translucent `negativeSubtle` tint and takes the red `negative` label
  // (the iOS tinted-destructive treatment: a same-hue label on a muted tint),
  // the deliberate exception to the `onAccent` rule that governs solid fills. A
  // caller may override any of these with `textColor` (e.g. a red ghost
  // "Cancel"); the button owns a single tint shared by the label and both
  // icons, so they can never desync.
  const variantLabelColor = match(variant)
    .with('primary', 'destructive', () => theme.colors.onAccent)
    .with('destructiveTonal', () => theme.colors.negative)
    .with('secondary', 'ghost', () => theme.colors.textPrimary)
    .exhaustive();
  const labelColor = textColor ?? variantLabelColor;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
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
      <RNText style={[styles.label, { color: labelColor }]}>{children}</RNText>
      {trailingIcon !== undefined && (
        <SymbolIcon name={trailingIcon} color={labelColor} size={18} />
      )}
    </Pressable>
  );
};

export default Button;
