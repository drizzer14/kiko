import type { UnistylesThemes } from 'react-native-unistyles';
import { match } from 'ts-pattern';

type ThemeName = keyof UnistylesThemes;

// Maps Unistyles' active theme name (`rt.themeName`, possibly undefined) to a
// concrete `'light' | 'dark'` colour scheme for any native surface that needs
// one (LiquidGlassView.colorScheme, a native tab bar). Defaults to 'dark' so an
// unresolved runtime never flashes the wrong scheme. `ThemeName` is derived
// from the app's own theme registration (`src/design-system/unistyles.ts`),
// so `.exhaustive()` below breaks at compile time if a third theme is ever
// registered without updating this mapper.
export const resolveColorScheme = (themeName: ThemeName | undefined): 'light' | 'dark' =>
  match(themeName)
    .with('light', () => 'light' as const)
    .with('dark', () => 'dark' as const)
    .with(undefined, () => 'dark' as const)
    .exhaustive();
