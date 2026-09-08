import { PlatformColor } from 'react-native';

import { navigationDarkTheme } from './dark-theme';
import { navigationLightTheme } from './light-theme';
import { selectNavigationTheme } from './select-navigation-theme';

// The nav-theme native-chrome colors are iOS system-semantic PlatformColors
// (not design-system hex) so react-native-screens repaints the header/large-
// title/VC background on the interface-style trait flip for free — see the
// theme files' docblocks. Under the RN jest preset `PlatformColor(name)`
// returns `{ semantic: [name] }`, so the assertions compare that shape. Both
// schemes reference the SAME semantic per field on purpose: the semantic
// itself resolves the per-scheme value natively.
describe('navigationLightTheme', () => {
  it('maps React Navigation native chrome onto iOS system-semantic colors', () => {
    expect(navigationLightTheme.colors.background).toEqual(
      PlatformColor('systemGroupedBackground'),
    );
    expect(navigationLightTheme.colors.card).toEqual(PlatformColor('systemGroupedBackground'));
    expect(navigationLightTheme.colors.text).toEqual(PlatformColor('label'));
    expect(navigationLightTheme.colors.border).toEqual(PlatformColor('opaqueSeparator'));
    expect(navigationLightTheme.colors.primary).toEqual(PlatformColor('systemBlue'));
  });

  it('shares the same semantic colors with navigationDarkTheme (semantic resolves per-scheme)', () => {
    expect(navigationDarkTheme.colors.background).toEqual(PlatformColor('systemGroupedBackground'));
    expect(navigationDarkTheme.colors.card).toEqual(PlatformColor('systemGroupedBackground'));
    expect(navigationDarkTheme.colors.text).toEqual(PlatformColor('label'));
    expect(navigationDarkTheme.colors.border).toEqual(PlatformColor('opaqueSeparator'));
    expect(navigationDarkTheme.colors.primary).toEqual(PlatformColor('systemBlue'));
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
