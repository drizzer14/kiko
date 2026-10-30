import type { FC } from 'react';
import { match } from 'ts-pattern';
import { StyleSheet, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import GlassSurface from '../glass-surface';

import { styles } from './footer-glass-backing.styles';
import type { FooterGlassBackingProps } from './footer-glass-backing.props';

// The fill of a Button in a footer that floats over scrolling rows: Liquid Glass, capsule. Used on
// iOS 26+ only; the Button keeps its normal fill below it. An opaque variant tints the glass with
// its own fill colour (`GlassSurface` `tint`), so the accent identity and the label contrast stay
// as they are. A translucent variant sits on transparent glass (the Home FAB's) with its own tone
// on top, so the grey and the red keep their identity. It is the first layer of the Button's
// Pressable, which carries no fill of its own here.
const FooterGlassBacking: FC<FooterGlassBackingProps> = ({ variant }) => {
  const { theme } = useUnistyles();

  const glass = match(variant)
    .with('primary', () => (
      <GlassSurface radius="full" tint={theme.colors.accent} style={StyleSheet.absoluteFill} />
    ))
    .with('secondary', () => (
      <GlassSurface radius="full" tint={theme.colors.surfaceHigh} style={StyleSheet.absoluteFill} />
    ))
    .with('destructive', () => (
      <GlassSurface radius="full" tint={theme.colors.negative} style={StyleSheet.absoluteFill} />
    ))
    .with('secondaryTonal', () => (
      <>
        <GlassSurface transparent radius="full" style={StyleSheet.absoluteFill} />

        <View style={[StyleSheet.absoluteFill, styles.tone(theme.colors.neutralSubtle)]} />
      </>
    ))
    .with('destructiveTonal', () => (
      <>
        <GlassSurface transparent radius="full" style={StyleSheet.absoluteFill} />

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
