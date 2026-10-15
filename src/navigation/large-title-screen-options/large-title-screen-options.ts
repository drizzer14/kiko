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

// The blur only exists below iOS 26 (Liquid Glass draws its own bar), so there is nothing to set
// on a newer OS. `blurred: false` is the transparent bar the fallback look has at rest.
const barBlurOptions = (blurred: boolean): NativeStackNavigationOptions => {
  if (isLiquidGlassSupported) {
    return {};
  }

  return { headerBlurEffect: blurred ? 'systemChromeMaterialDark' : 'none' };
};

/**
 * The options of a screen whose title does not fit the native large title and shows as a heading
 * in the content instead: an inline bar, with no bar title until the heading has scrolled under
 * it. `title` itself stays as it is, so the back label and the screen's own title reads still
 * work. Below iOS 26 the bar is transparent at rest and blurred once scrolled, the fallback
 * look of `largeTitleScreenOptions`.
 */
export const largeTitleHeadingOptions = (
  title: string,
  scrolled: boolean,
): NativeStackNavigationOptions => ({
  headerLargeTitle: false,
  headerTitle: scrolled ? title : '',
  ...barBlurOptions(scrolled),
});

/** Puts a screen back on the native large title after `largeTitleHeadingOptions`. */
export const largeTitleRestoredOptions: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  headerTitle: undefined,
  ...barBlurOptions(true),
};
