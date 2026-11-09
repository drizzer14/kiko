// Semgrep fixture (NEGATIVE): `kiko-no-unistyles-set-theme` MUST report nothing here. Reading
// the runtime's state, and a method of another object that happens to share a name, are not a
// call of `UnistylesRuntime.setTheme` or `UnistylesRuntime.setAdaptiveThemes`.
import { UnistylesRuntime } from 'react-native-unistyles';

export const currentThemeName = (): string => {
  return UnistylesRuntime.themeName ?? 'dark';
};

export const followsWindow = (): boolean => {
  return UnistylesRuntime.hasAdaptiveThemes;
};

type ThemeStore = { setTheme: (name: string) => void };

export const switchOwnStore = (store: ThemeStore): void => {
  store.setTheme('dark');
};
