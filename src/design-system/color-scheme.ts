// Maps Unistyles' active theme name (`rt.themeName`, possibly undefined) to a
// concrete `'light' | 'dark'` colour scheme for any native surface that needs
// one (LiquidGlassView.colorScheme, a native tab bar). Defaults to 'dark' so an
// unresolved runtime never flashes the wrong scheme.
export const resolveColorScheme = (themeName: string | undefined): 'light' | 'dark' =>
  themeName === 'light' ? 'light' : 'dark';
