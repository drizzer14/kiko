import { DefaultTheme } from '@react-navigation/native';

import { lightTheme } from '../design-system/theme';

/**
 * React Navigation theme mapped onto the design-system light tokens — the
 * light-mode mirror of navigationDarkTheme. Drives the status-bar contrast
 * (light theme => dark status-bar text) and the screen chrome behind every
 * navigator.
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
  },
};
