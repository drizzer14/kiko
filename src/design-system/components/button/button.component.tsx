import type { FC } from 'react';
import { Pressable, Text as RNText } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { match } from 'ts-pattern';

import SymbolIcon from '../symbol';

import type { ButtonProps } from './button.props';
import { styles } from './button.styles';

// The small size's visible height (34pt) sits below the 44pt HIG touch-target
// floor, so this hitSlop restores the tap target above and below the pill:
// 34 + 5 + 5 = 44. Its width is already >= 44 (see the `small` style's
// paddingHorizontal), so no horizontal slop is needed — and none is added, so
// adjacent small icon buttons in a tight row never overlap tap areas.
const SMALL_HIT_SLOP = { top: 5, bottom: 5 } as const;

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

  // The props union already makes an unlabelled icon-only button a compile
  // error; this is the runtime backstop for an untyped (e.g. cast or JS) call
  // path. An icon-only button (no children) with no accessibilityLabel has no
  // accessible name for VoiceOver, so it throws in development rather than
  // shipping a silently unlabelled control.
  if (__DEV__ && children === undefined && accessibilityLabel === undefined) {
    throw new Error('Button: an icon-only button (no children) requires an accessibilityLabel.');
  }

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
    .with('secondary', 'secondaryTonal', 'ghost', () => theme.colors.textPrimary)
    .exhaustive();
  const labelColor = textColor ?? variantLabelColor;

  // The three sizes: regular (tall CTA/submit), compact (44pt inline), and small
  // (a shorter inline action whose 44pt tap target is restored via hitSlop).
  const sizeStyle = match(size)
    .with('regular', () => styles.regular)
    .with('compact', () => styles.compact)
    .with('small', () => styles.small)
    .exhaustive();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      // The small size's visible pill is shorter than 44pt, so it carries a
      // hitSlop that restores the >= 44pt HIG tap target; regular and compact
      // already meet 44pt as their visible minHeight, so they take no slop.
      hitSlop={size === 'small' ? SMALL_HIT_SLOP : undefined}
      style={[styles.button, sizeStyle, fullWidth && styles.fullWidth, disabled && styles.disabled]}
    >
      {icon !== undefined && (
        <SymbolIcon name={icon} color={labelColor} size={theme.iconSizes.body} />
      )}
      {children !== undefined && (
        <RNText style={[styles.label, { color: labelColor }]}>{children}</RNText>
      )}
      {trailingIcon !== undefined && (
        <SymbolIcon name={trailingIcon} color={labelColor} size={theme.iconSizes.body} />
      )}
    </Pressable>
  );
};

export default Button;
