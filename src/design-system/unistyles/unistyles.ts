import { StyleSheet } from 'react-native-unistyles';

import { darkTheme, lightTheme } from '../theme';

// Dark first: the Unistyles jest mock reads the first registered theme, so this order keeps every
// dark-pinned test on dark. Light is registered but unreachable: no `adaptiveThemes`, no runtime
// switch, and `initialTheme` pins dark.
const themes = { dark: darkTheme, light: lightTheme };

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
