import { type FC, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Defs, LinearGradient, Rect, Stop, Svg } from 'react-native-svg';

import GlassSurface from '../glass-surface';

import { styles } from './floating-footer-backdrop.styles';

// Colons stripped: react-native-svg's `url(#...)` reference is safest as a plain alphanumeric id.
const GRADIENT_ID_PREFIX = 'floating-footer-backdrop-fade';
const ALPHA_PATTERN = /([\d.]+)\)$/;

// react-native-svg replaces a stop colour's own alpha with `stopOpacity` (extractGradient.ts), so
// the token's rgba alpha only survives when it is passed back as the stop's opacity.
const colorAlpha = (color: string): number => Number(color.match(ALPHA_PATTERN)?.[1] ?? 1);

// A blur band behind the buttons of a footer that floats over scrolling rows: a square, full-width
// `material` GlassSurface (Liquid Glass on iOS 26+, the surface's own translucent fill below it)
// that starts at the buttons' top and fills down to the bottom of the slot. The slot's 16 pt top
// padding above it holds a fade from nothing to the band's own tone (`surfaceTranslucent`), so the
// band's top edge is soft and the fade never paints over the glass. It is the footer's first child,
// absolutely filled, so it adds nothing to the slot's measured height.
const FloatingFooterBackdrop: FC = () => {
  const { theme } = useUnistyles();
  const gradientId = `${GRADIENT_ID_PREFIX}-${useId().replace(/:/g, '')}`;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="floating-footer-backdrop">
      <GlassSurface material radius="none" style={styles.band} />

      <View pointerEvents="none" style={styles.fade}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={theme.colors.surfaceTranslucent} stopOpacity={0} />

              <Stop
                offset="1"
                stopColor={theme.colors.surfaceTranslucent}
                stopOpacity={colorAlpha(theme.colors.surfaceTranslucent)}
              />
            </LinearGradient>
          </Defs>

          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
        </Svg>
      </View>
    </View>
  );
};

export default FloatingFooterBackdrop;
