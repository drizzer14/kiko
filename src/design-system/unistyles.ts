import { StyleSheet } from 'react-native-unistyles';

import { darkTheme, lightTheme } from './theme';

// Both themes registered, dark first so the Jest mock's
// `useUnistyles().theme` default stays dark (Object.values(themes).at(0));
// adaptive selection keys off the theme NAME, not object order.
// adaptiveThemes lets a fresh install follow the OS appearance (System
// default); the persisted choice overrides this at app start (see
// use-sync-appearance-with-settings).
const themes = { dark: darkTheme, light: lightTheme };

type AppThemes = typeof themes;

declare module 'react-native-unistyles' {
  export interface UnistylesThemes extends AppThemes {}
}

StyleSheet.configure({
  themes,
  settings: { adaptiveThemes: true },
});
