import { StyleSheet } from 'react-native-unistyles';

describe('unistyles configuration', () => {
  it('registers both themes with dark first and adaptiveThemes enabled', () => {
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
      expect(config.settings).toEqual({ adaptiveThemes: true });
    });
  });
});
