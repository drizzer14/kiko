import { isLiquidGlassSupported } from '@callstack/liquid-glass';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

/**
 * The `screenOptions` of every native stack that shows a large title.
 *
 * Below iOS 26, react-native-screens builds a transparent bar style with
 * no background effect, so once the large title collapses the bar is fully
 * see-through. `headerBlurEffect` gives the scrolled bar a dark blur;
 * `headerLargeStyle` keeps the at-rest large title transparent, so the blur
 * shows only when scrolled. On iOS 26+ the system draws its own Liquid Glass
 * bar, so neither option is passed and that look stays untouched.
 *
 * Gated on `isLiquidGlassSupported`, the same check `GlassSurface` and
 * `BottomSheet` branch on, so the three agree on which OS tier they are on.
 */
export const largeTitleScreenOptions: NativeStackNavigationOptions = isLiquidGlassSupported
  ? { headerLargeTitle: true }
  : {
      headerLargeTitle: true,
      headerBlurEffect: 'systemChromeMaterialDark',
      headerLargeStyle: { backgroundColor: 'transparent' },
    };
