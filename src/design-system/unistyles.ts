import { StyleSheet } from 'react-native-unistyles';

import { darkTheme } from './theme';

// The app is dark-only: a single dark theme is registered, so there is no
// runtime theme switching and no `adaptiveThemes`. `initialTheme` pins it.
const themes = { dark: darkTheme };

type AppThemes = typeof themes;

declare module 'react-native-unistyles' {
  export interface UnistylesThemes extends AppThemes {}
}

StyleSheet.configure({
  themes,
  settings: {
    initialTheme: 'dark',
  },
});
