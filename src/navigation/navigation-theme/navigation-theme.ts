import { darkTheme, lightTheme } from '@kiko/design-system/theme';
import { DarkTheme, DefaultTheme } from '@react-navigation/native';

/**
 * React Navigation theme for the dark scheme, so the true-black background shows behind every
 * screen and the navigation chrome (headers, cards, borders, accent) matches the Apple iOS dark
 * palette.
 *
 * The colors reference the design-system dark tokens directly, as concrete values and not as
 * colors the OS resolves, so the theme in force and the navigation colors change together.
 * `notification` is inherited from `@react-navigation/native`'s `DarkTheme`.
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

/**
 * The light twin, mapped token for token like the dark one. `notification` takes the light
 * negative, the twin of the dark negative that `DarkTheme` carries.
 */
export const navigationLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: lightTheme.colors.background,
    card: lightTheme.colors.background,
    text: lightTheme.colors.textPrimary,
    border: lightTheme.colors.border,
    primary: lightTheme.colors.accent,
    notification: lightTheme.colors.negative,
  },
};
