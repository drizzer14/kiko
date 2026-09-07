import type { UnistylesThemes } from 'react-native-unistyles';
import { match } from 'ts-pattern';

import { navigationDarkTheme } from './dark-theme';
import { navigationLightTheme } from './light-theme';

type ThemeName = keyof UnistylesThemes;

// Maps Unistyles' active theme name (`rt.themeName`, possibly undefined) to
// the React Navigation theme that mirrors it. Defaults to the dark nav theme
// so an unresolved runtime never flashes the wrong chrome. `ThemeName` is
// derived from the app's own theme registration
// (`src/design-system/unistyles.ts`), so `.exhaustive()` below breaks at
// compile time if a third theme is ever registered without updating this
// mapper.
export const selectNavigationTheme = (themeName: ThemeName | undefined) =>
  match(themeName)
    .with('light', () => navigationLightTheme)
    .with('dark', () => navigationDarkTheme)
    .with(undefined, () => navigationDarkTheme)
    .exhaustive();
