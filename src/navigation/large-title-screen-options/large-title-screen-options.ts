import { isLiquidGlassSupported } from '@callstack/liquid-glass';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

/**
 * The `screenOptions` of every native stack that shows a large title.
 *
 * Below iOS 26, react-native-screens builds a transparent bar style with
 * no background effect, so once the large title collapses the bar is fully
 * see-through. `headerBlurEffect` gives the scrolled bar a blur whose material has no scheme
 * in its name, so it takes the nav bar's own style override, which native-stack sets from the
 * navigation theme's `dark` flag; `headerLargeStyle` keeps the at-rest
 * large title transparent, so the blur shows only when scrolled. On iOS 26+ the system draws
 * its own Liquid Glass bar, so neither option is passed and that look stays untouched.
 *
 * Gated on `isLiquidGlassSupported`, the same check `GlassSurface` and
 * `BottomSheet` branch on, so the three agree on which OS tier they are on.
 */
export const largeTitleScreenOptions: NativeStackNavigationOptions = isLiquidGlassSupported
  ? { headerLargeTitle: true }
  : {
      headerLargeTitle: true,
      headerBlurEffect: 'systemChromeMaterial',
      headerLargeStyle: { backgroundColor: 'transparent' },
    };

/**
 * The options of a screen whose title does not fit the native large title and shows as a heading
 * in the content instead: the large-title bar with the title moved into the content, and no bar
 * title until the heading has scrolled under it. `title` itself stays as it is, so the back label
 * and the screen's own title reads still work.
 *
 * Switching `headerLargeTitle` off alone would also make the bar opaque (native-stack ties
 * `translucent` and the transparent background to the large title), and an opaque bar lays the
 * content out below it. `headerTransparent` keeps the bar translucent with the transparent
 * background, so the content lays out under it as under a large title. It would also hide the
 * bar's shadow, so `headerShadowVisible` puts that back. The blur options of
 * `largeTitleScreenOptions` stay in force: below iOS 26 the bar is transparent at rest and
 * blurred once content scrolls under it, and the iOS 26+ Liquid Glass bar gets no extra option.
 */
export const largeTitleHeadingOptions = (
  title: string,
  scrolled: boolean,
): NativeStackNavigationOptions => ({
  headerLargeTitle: false,
  headerTransparent: true,
  headerShadowVisible: true,
  headerTitle: scrolled ? title : '',
});

/**
 * Puts a screen back on the native large title after `largeTitleHeadingOptions`. Each key the
 * heading look overrides gets the screen's own value from before the switch back, or `undefined`
 * when the screen set none. A key the screen changes during heading mode gets the older value,
 * because `setOptions` cannot remove the heading look's override.
 */
export const largeTitleRestoredOptions = ({
  headerTransparent,
  headerShadowVisible,
  headerTitle,
}: NativeStackNavigationOptions): NativeStackNavigationOptions => ({
  headerLargeTitle: true,
  headerTransparent,
  headerShadowVisible,
  headerTitle,
});
