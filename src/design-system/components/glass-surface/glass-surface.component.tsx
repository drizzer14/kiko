import { isLiquidGlassSupported, LiquidGlassView } from '@callstack/liquid-glass';
import type { FC } from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { GlassSurfaceProps } from './glass-surface.props';
import { styles } from './glass-surface.styles';

// A shared surface for card-like grouping (accounts list, settings sections):
// real Liquid Glass material on iOS 26+, a themed flat surface everywhere
// else. isLiquidGlassSupported renders LiquidGlassView as a plain View with
// no effect on unsupported iOS, so the fallback background/radius below is
// still required in that branch, not only in the explicit `else`.
const GlassSurface: FC<GlassSurfaceProps> = ({
  children,
  style,
  padding,
  radius = 'md',
  ...props
}) => {
  const { theme } = useUnistyles();
  const sizing = [
    { borderRadius: theme.radii[radius] },
    padding !== undefined && { padding: theme.spacing(padding) },
  ];

  if (isLiquidGlassSupported) {
    return (
      <LiquidGlassView
        effect="regular"
        colorScheme="dark"
        style={[styles.surface, sizing, style]}
        {...props}
      >
        {children}
      </LiquidGlassView>
    );
  }

  return (
    <View style={[styles.surface, styles.fallback, sizing, style]} {...props}>
      {children}
    </View>
  );
};

export default GlassSurface;
