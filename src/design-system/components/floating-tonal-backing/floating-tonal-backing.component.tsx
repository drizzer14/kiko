import type { FC } from 'react';
import { match } from 'ts-pattern';
import { StyleSheet, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { isLiquidGlassSupported } from '@callstack/liquid-glass';

import GlassSurface from '../glass-surface';

import { styles } from './floating-tonal-backing.styles';
import type { FloatingTonalBackingProps } from './floating-tonal-backing.props';

// The fill behind a tonal Button in a footer that floats over scrolling rows: Liquid Glass on
// iOS 26+ (like the Home FAB), a solid fill below it. The variant's own translucent tint is drawn
// on top of either, so the grey and the red keep their identity. It is a layer of the Button's
// Pressable, which carries no fill of its own here.
const FloatingTonalBacking: FC<FloatingTonalBackingProps> = ({ variant }) => {
  const { theme } = useUnistyles();
  const tint = match(variant)
    .with('secondaryTonal', () => theme.colors.neutralSubtle)
    .with('destructiveTonal', () => theme.colors.negativeSubtle)
    .exhaustive();

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="floating-tonal-backing">
      {isLiquidGlassSupported ? (
        <GlassSurface transparent radius="md" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.solid]} />
      )}

      <View style={[StyleSheet.absoluteFill, styles.tint(tint)]} />
    </View>
  );
};

export default FloatingTonalBacking;
