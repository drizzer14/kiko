import type { Theme } from '@react-navigation/native';
import type { ColorScheme } from '@kiko/design-system/palette';
import { useActiveColorScheme } from '@kiko/design-system/active-color-scheme';

import { navigationDarkTheme, navigationLightTheme } from './navigation-theme';

const THEME_OF_SCHEME: Record<ColorScheme, Theme> = {
  dark: navigationDarkTheme,
  light: navigationLightTheme,
};

export const useNavigationTheme = (): Theme => THEME_OF_SCHEME[useActiveColorScheme()];
