import { StyleSheet } from 'react-native-unistyles';
import { darkTheme, lightTheme } from '@kiko/design-system/theme';

// The Unistyles jest mock hands out the FIRST registered theme, and `unistyles.ts` registers dark
// first. These swap the order for a light-world test. A call changes what `useUnistyles().theme`
// returns at once; a `StyleSheet.create` the mock already resolved keeps its theme, so a test of a
// stylesheet color calls `registerLightThemeFirst` before it imports the module, inside
// `jest.isolateModules`.
export const registerLightThemeFirst = (): void => {
  StyleSheet.configure({ themes: { light: lightTheme, dark: darkTheme } });
};

export const restoreThemeOrder = (): void => {
  StyleSheet.configure({ themes: { dark: darkTheme, light: lightTheme } });
};
