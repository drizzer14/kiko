import { type FC, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Defs, LinearGradient, Rect, Stop, Svg } from 'react-native-svg';

import GlassSurface from '../glass-surface';

import { styles } from './floating-footer-backdrop.styles';

// The fade is as tall as the slot's own top padding (`spacing(4)` in `screen.styles.ts`), so it
// stays in the gap above the first button and never reaches a button.
const FADE_HEIGHT_STEP = 4;
// Colons stripped: react-native-svg's `url(#...)` reference is safest as a plain alphanumeric id.
const GRADIENT_ID_PREFIX = 'floating-footer-backdrop-fade';

// A blur band behind the buttons of a footer that floats over scrolling rows: a square, full-width
// `material` GlassSurface (Liquid Glass on iOS 26+, the surface's own translucent fill below it)
// that fills the footer slot, with a short fade to the screen background at its top edge. It is
// the footer's first child, absolutely filled, so it adds nothing to the slot's measured height.
const FloatingFooterBackdrop: FC = () => {
  const { theme } = useUnistyles();
  const gradientId = `${GRADIENT_ID_PREFIX}-${useId().replace(/:/g, '')}`;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="floating-footer-backdrop">
      <GlassSurface material radius="none" style={StyleSheet.absoluteFill} />

      <View pointerEvents="none" style={styles.fade}>
        <Svg width="100%" height={theme.spacing(FADE_HEIGHT_STEP)}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={theme.colors.background} stopOpacity={0} />

              <Stop offset="1" stopColor={theme.colors.background} stopOpacity={1} />
            </LinearGradient>
          </Defs>

          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
        </Svg>
      </View>
    </View>
  );
};

export default FloatingFooterBackdrop;
