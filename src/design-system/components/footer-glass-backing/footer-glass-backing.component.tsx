import type { FC } from 'react';
import { match } from 'ts-pattern';
import { StyleSheet, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { isLiquidGlassSupported } from '@callstack/liquid-glass';

import GlassSurface from '../glass-surface';

import { styles } from './footer-glass-backing.styles';
import type { FooterGlassBackingProps } from './footer-glass-backing.props';

// The fill of a Button in a footer that floats over scrolling rows: Liquid Glass, capsule. A solid
// variant is drawn on iOS 26+ only; the Button keeps its already opaque fill below it. A solid
// variant tints the glass itself with its own fill colour (`GlassSurface` `glassTint`, the native
// tint). It is not `tint`: that adds an opaque base and wash, which hide the glass. A translucent
// (tonal) variant keeps its own tone on top, so the grey and the red keep their identity, over
// transparent glass (the Home FAB's) on iOS 26+ and over the opaque `background` below it, where
// the rows under the footer must not show through. It is the first layer of the Button's
// Pressable, which carries no fill of its own here.
const FooterGlassBacking: FC<FooterGlassBackingProps> = ({ variant }) => {
  const { theme } = useUnistyles();

  const tonalBase = isLiquidGlassSupported ? (
    <GlassSurface transparent radius="full" style={StyleSheet.absoluteFill} />
  ) : (
    <View style={[StyleSheet.absoluteFill, styles.tone(theme.colors.background)]} />
  );

  const glass = match(variant)
    .with('primary', () => (
      <GlassSurface radius="full" glassTint={theme.colors.accent} style={StyleSheet.absoluteFill} />
    ))
    .with('secondary', () => (
      <GlassSurface
        radius="full"
        glassTint={theme.colors.surfaceHigh}
        style={StyleSheet.absoluteFill}
      />
    ))
    .with('destructive', () => (
      <GlassSurface
        radius="full"
        glassTint={theme.colors.negative}
        style={StyleSheet.absoluteFill}
      />
    ))
    .with('secondaryTonal', () => (
      <>
        {tonalBase}

        <View style={[StyleSheet.absoluteFill, styles.tone(theme.colors.neutralSubtle)]} />
      </>
    ))
    .with('destructiveTonal', () => (
      <>
        {tonalBase}

        <View style={[StyleSheet.absoluteFill, styles.tone(theme.colors.negativeSubtle)]} />
      </>
    ))
    .exhaustive();

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.layer]}
      testID="footer-glass-backing"
    >
      {glass}
    </View>
  );
};

export default FooterGlassBacking;
