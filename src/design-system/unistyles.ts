import { StyleSheet } from 'react-native-unistyles';

import { darkTheme } from './theme';

// Single OLED dark theme — no light theme, no adaptiveThemes.
const themes = { dark: darkTheme };

type AppThemes = typeof themes;

declare module 'react-native-unistyles' {
  export interface UnistylesThemes extends AppThemes {}
}

StyleSheet.configure({
  themes,
  settings: { initialTheme: 'dark' },
});
