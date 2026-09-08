import { DarkTheme } from '@react-navigation/native';

import { platformNavColor } from './platform-nav-color';

/**
 * React Navigation theme for dark mode, so the true-black background shows
 * behind every screen and the navigation chrome (headers, cards, borders,
 * accent) matches the Apple iOS dark palette.
 *
 * The native-chrome colors below are iOS SYSTEM-SEMANTIC colors
 * (`PlatformColor`), NOT design-system hex, on purpose. react-native-screens
 * paints the large-title label, the header background, and the screen/VC
 * background natively; iOS does not repaint an already-composited native nav
 * bar / large-title / VC background when a concrete-hex color prop changes —
 * only on a layout pass, which a flip-origin screen (e.g. System settings)
 * never gets, so the chrome lagged the scheme flip. Semantic colors resolve
 * per-trait, so the interface-style trait flip done by
 * `RNAppearance.setColorScheme` repaints them for free — reliable in both
 * directions with no layout-pass hack. The semantics are the light/dark-
 * agnostic counterparts of the design-system tokens, so dark-theme.ts and
 * light-theme.ts reference the SAME PlatformColor per field: the semantic
 * itself carries the per-scheme value. The chosen semantics reproduce the
 * former hex exactly (systemGroupedBackground = #000, label = #FFF,
 * opaqueSeparator = #38383A, systemBlue = #0A84FF in dark).
 */
export const navigationDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: platformNavColor('systemGroupedBackground'),
    card: platformNavColor('systemGroupedBackground'),
    text: platformNavColor('label'),
    border: platformNavColor('opaqueSeparator'),
    primary: platformNavColor('systemBlue'),
  },
};
