import { StyleSheet } from 'react-native-unistyles';

describe('unistyles configuration', () => {
  it('registers dark first, then light, with adaptive themes OFF', () => {
    const configure = jest.spyOn(StyleSheet, 'configure');

    // Require theme and unistyles inside the same isolated registry so the
    // theme objects the module registers share identity with the ones this
    // test asserts against (isolateModules gives the required graph fresh
    // copies distinct from the outer import).
    jest.isolateModules(() => {
      const { darkTheme, lightTheme } = require('../theme');
      require('./unistyles');

      expect(configure).toHaveBeenCalledTimes(1);
      const config = configure.mock.calls[0][0];
      const themes = config.themes;
      expect(themes).toBeDefined();
      // The jest mock reads the first theme, so dark stays first and every dark-pinned test
      // keeps reading dark.
      expect(Object.keys(themes ?? {})).toEqual(['dark', 'light']);
      expect(themes?.dark).toBe(darkTheme);
      expect(themes?.light).toBe(lightTheme);

      // No user can reach light yet: no adaptiveThemes, and initialTheme pins 'dark'.
      expect(config.settings).not.toHaveProperty('adaptiveThemes');
      expect(config.settings?.initialTheme).toBe('dark');
    });
  });
});
