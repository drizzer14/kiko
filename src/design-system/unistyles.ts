import { Appearance } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { darkTheme, lightTheme } from './theme';

// Both themes registered, dark first so the Jest mock's
// `useUnistyles().theme` default stays dark (Object.values(themes).at(0)).
//
// Option B (manual theme control, NOT adaptiveThemes). Unistyles' adaptive
// mode resolves the active theme from the PHYSICAL OS trait
// (`UIScreen.main.traitCollection`), NOT from React Native's app-level
// `Appearance.setColorScheme` window override. So while adaptive was on, a
// manual light/dark pin flipped only the native chrome (via setColorScheme)
// and never the Unistyles JS theme — every styled element stayed on the OS
// scheme. Adaptive is therefore OFF here and the theme is driven MANUALLY with
// `UnistylesRuntime.setTheme` (see src/appearance/appearance.ts and the
// system-mode OS listener in use-sync-appearance-with-settings). `initialTheme`
// is REQUIRED once adaptive is off (the two are mutually exclusive); it reads
// the OS scheme at boot so a fresh install still starts on the system
// appearance, and the persisted choice is applied before first paint by
// MigrationsGate's applyPersistedAppearance.
const themes = { dark: darkTheme, light: lightTheme };

type AppThemes = typeof themes;

declare module 'react-native-unistyles' {
  export interface UnistylesThemes extends AppThemes {}
}

StyleSheet.configure({
  themes,
  settings: {
    initialTheme: () => Appearance.getColorScheme() ?? 'dark',
  },
});
