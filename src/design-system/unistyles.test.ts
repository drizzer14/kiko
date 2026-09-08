import { StyleSheet } from 'react-native-unistyles';

describe('unistyles configuration', () => {
  it('registers both themes with dark first and drives the theme manually (adaptive OFF)', () => {
    const configure = jest.spyOn(StyleSheet, 'configure');

    // Require theme and unistyles inside the same isolated registry so the
    // theme objects the module registers share identity with the ones this
    // test asserts against (isolateModules gives the required graph fresh
    // copies distinct from the outer import).
    jest.isolateModules(() => {
      const { darkTheme, lightTheme } = require('./theme');
      require('./unistyles');

      expect(configure).toHaveBeenCalledTimes(1);
      const config = configure.mock.calls[0][0];
      const themes = config.themes;
      expect(themes).toBeDefined();
      expect(Object.keys(themes ?? {})).toEqual(['dark', 'light']);
      expect(themes?.dark).toBe(darkTheme);
      expect(themes?.light).toBe(lightTheme);

      // Option B: adaptiveThemes is OFF (it resolves the physical OS trait, not
      // the app-level override, so a manual pin never flipped the JS theme).
      // Instead an `initialTheme` boots on the OS scheme; the theme is driven
      // manually thereafter (see src/appearance/appearance.ts).
      expect(config.settings).not.toHaveProperty('adaptiveThemes');
      expect(typeof config.settings?.initialTheme).toBe('function');
    });
  });

  it("initialTheme reads the OS scheme at boot, defaulting to 'dark' when unknown", () => {
    const configure = jest.spyOn(StyleSheet, 'configure');

    jest.isolateModules(() => {
      // The isolated registry gets a fresh `react-native`, so spy on THAT
      // Appearance instance — the one `./unistyles` actually reads.
      const { Appearance: IsolatedAppearance } = require('react-native');
      const getColorScheme = jest.spyOn(IsolatedAppearance, 'getColorScheme');

      require('./unistyles');
      const config = configure.mock.calls[0][0];
      const initialTheme = config.settings?.initialTheme as () => 'light' | 'dark';

      getColorScheme.mockReturnValue('light');
      expect(initialTheme()).toBe('light');

      getColorScheme.mockReturnValue(null);
      expect(initialTheme()).toBe('dark');
    });
  });
});
