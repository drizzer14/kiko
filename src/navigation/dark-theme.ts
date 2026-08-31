import { DarkTheme } from '@react-navigation/native';
import { darkTheme } from '../design-system/theme';

/**
 * React Navigation theme mapped onto the design-system dark tokens, so the
 * true-black background shows behind every screen and navigation chrome
 * (headers, cards, borders, accent) matches the Apple iOS dark palette.
 */
export const navigationDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: darkTheme.colors.background,
    card: darkTheme.colors.background,
    text: darkTheme.colors.textPrimary,
    border: darkTheme.colors.border,
    primary: darkTheme.colors.accent,
  },
};
