import { DarkTheme } from '@react-navigation/native';
import { darkTheme } from '@kiko/design-system/theme';

/**
 * React Navigation theme for the app's dark-only chrome, so the true-black
 * background shows behind every screen and the navigation chrome (headers,
 * cards, borders, accent) matches the Apple iOS dark palette.
 *
 * The colors reference the design-system dark tokens (`src/design-system/
 * theme.ts`) directly: the app pins `UIUserInterfaceStyle = Dark` in
 * Info.plist, so native chrome never needs to repaint for a scheme flip and a
 * concrete token value is sufficient. `notification` is inherited from
 * `@react-navigation/native`'s `DarkTheme`.
 */
export const navigationDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: darkTheme.colors.background, // systemGroupedBackground (dark)
    card: darkTheme.colors.background,
    text: darkTheme.colors.textPrimary, // label (dark)
    border: darkTheme.colors.border, // opaqueSeparator (dark)
    primary: darkTheme.colors.accent, // systemBlue (dark)
  },
};
