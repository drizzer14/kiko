import { darkTheme, lightTheme } from '../design-system/theme';

import { navigationDarkTheme } from './dark-theme';
import { navigationLightTheme } from './light-theme';
import { selectNavigationTheme } from './select-navigation-theme';

describe('navigationLightTheme', () => {
  it('maps React Navigation colors onto the light design tokens', () => {
    expect(navigationLightTheme.colors.background).toBe(lightTheme.colors.background);
    expect(navigationLightTheme.colors.card).toBe(lightTheme.colors.background);
    expect(navigationLightTheme.colors.text).toBe(lightTheme.colors.textPrimary);
    expect(navigationLightTheme.colors.border).toBe(lightTheme.colors.border);
    expect(navigationLightTheme.colors.primary).toBe(lightTheme.colors.accent);
  });

  it('is the light-mode counterpart of navigationDarkTheme (dark stays on dark tokens)', () => {
    expect(navigationDarkTheme.colors.background).toBe(darkTheme.colors.background);
  });
});

describe('selectNavigationTheme', () => {
  it("returns the light nav theme for 'light'", () => {
    expect(selectNavigationTheme('light')).toBe(navigationLightTheme);
  });

  it("returns the dark nav theme for 'dark' and for undefined", () => {
    expect(selectNavigationTheme('dark')).toBe(navigationDarkTheme);
    expect(selectNavigationTheme(undefined)).toBe(navigationDarkTheme);
  });
});
