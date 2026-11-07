import { StyleSheet } from 'react-native-unistyles';
import { applyLaunchAppearance } from '@kiko/appearance/apply-launch-appearance';

import { darkTheme, lightTheme } from '../theme';

// Dark first: the Unistyles jest mock reads the first registered theme, so this order keeps every
// dark-pinned test on dark.
const themes = { dark: darkTheme, light: lightTheme };

type AppThemes = typeof themes;

declare module 'react-native-unistyles' {
  export interface UnistylesThemes extends AppThemes {}
}

// Before `configure`, not left to import order: Unistyles reads the window's scheme during
// `configure`, so a saved light or dark mode must already be on the window.
applyLaunchAppearance();

StyleSheet.configure({
  themes,
  settings: {
    adaptiveThemes: true,
  },
});
