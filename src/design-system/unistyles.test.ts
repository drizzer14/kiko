import { StyleSheet } from 'react-native-unistyles';

describe('unistyles configuration', () => {
  it('registers the single dark theme (adaptive OFF)', () => {
    const configure = jest.spyOn(StyleSheet, 'configure');

    // Require theme and unistyles inside the same isolated registry so the
    // theme objects the module registers share identity with the ones this
    // test asserts against (isolateModules gives the required graph fresh
    // copies distinct from the outer import).
    jest.isolateModules(() => {
      const { darkTheme } = require('./theme');
      require('./unistyles');

      expect(configure).toHaveBeenCalledTimes(1);
      const config = configure.mock.calls[0][0];
      const themes = config.themes;
      expect(themes).toBeDefined();
      expect(Object.keys(themes ?? {})).toEqual(['dark']);
      expect(themes?.dark).toBe(darkTheme);

      // The app is dark-only: no adaptiveThemes, and initialTheme pins 'dark'.
      expect(config.settings).not.toHaveProperty('adaptiveThemes');
      expect(config.settings?.initialTheme).toBe('dark');
    });
  });
});
