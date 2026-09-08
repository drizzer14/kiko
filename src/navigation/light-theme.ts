import { DefaultTheme } from '@react-navigation/native';

import { platformNavColor } from './platform-nav-color';

/**
 * React Navigation theme for light mode — the light-mode mirror of
 * navigationDarkTheme. Drives the status-bar contrast (light theme => dark
 * status-bar text) and the screen chrome behind every navigator.
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
 * agnostic counterparts of the design-system tokens, so light-theme.ts and
 * dark-theme.ts reference the SAME PlatformColor per field: the semantic
 * itself carries the per-scheme value. The chosen semantics reproduce the
 * former hex exactly (systemGroupedBackground = #F2F2F7, label = #000,
 * opaqueSeparator = #C6C6C8, systemBlue = #007AFF in light).
 */
export const navigationLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: platformNavColor('systemGroupedBackground'),
    card: platformNavColor('systemGroupedBackground'),
    text: platformNavColor('label'),
    border: platformNavColor('opaqueSeparator'),
    primary: platformNavColor('systemBlue'),
  },
};
