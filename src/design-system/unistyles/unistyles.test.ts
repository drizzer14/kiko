import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles';

type SavedMode = 'light' | 'dark' | 'system' | undefined;

// The real react-native module is re-required inside the isolated registry, so the stored mode
// and the Appearance spy are set up there, on the same module `unistyles.ts` reads.
const launchWith = (savedMode: SavedMode) => {
  const order: string[] = [];
  const configure = jest.spyOn(StyleSheet, 'configure').mockImplementation(() => {
    order.push('configure');
  });
  const setColorScheme = jest.fn((scheme: unknown) => {
    order.push(`setColorScheme:${scheme}`);
  });

  jest.isolateModules(() => {
    const { Appearance, NativeModules } = require('react-native');

    NativeModules.SettingsManager = { settings: { 'kiko.appearanceMode': savedMode } };
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(setColorScheme);

    require('./unistyles');
  });

  return { order, configure, setColorScheme };
};

describe('unistyles configuration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers dark first, then light', () => {
    const configure = jest.spyOn(StyleSheet, 'configure');

    // Require theme and unistyles inside the same isolated registry so the
    // theme objects the module registers share identity with the ones this
    // test asserts against (isolateModules gives the required graph fresh
    // copies distinct from the outer import).
    jest.isolateModules(() => {
      const { darkTheme, lightTheme } = require('../theme');
      require('./unistyles');

      expect(configure).toHaveBeenCalledTimes(1);
      const themes = configure.mock.calls[0][0].themes;
      expect(themes).toBeDefined();
      // The jest mock reads the first theme, so dark stays first and every dark-pinned test
      // keeps reading dark.
      expect(Object.keys(themes ?? {})).toEqual(['dark', 'light']);
      expect(themes?.dark).toBe(darkTheme);
      expect(themes?.light).toBe(lightTheme);
    });
  });

  it('configures adaptive themes and no initialTheme', () => {
    const { configure } = launchWith(undefined);

    expect(configure.mock.calls[0][0].settings).toEqual({ adaptiveThemes: true });
  });

  it.each(['light', 'dark'] as const)(
    'a saved %s mode is applied before StyleSheet.configure',
    (mode) => {
      const { order } = launchWith(mode);

      expect(order).toEqual([`setColorScheme:${mode}`, 'configure']);
    },
  );

  it.each([['system'], [undefined]] as const)('%s makes no Appearance call', (savedMode) => {
    const { order, setColorScheme } = launchWith(savedMode);

    expect(setColorScheme).not.toHaveBeenCalled();
    expect(order).toEqual(['configure']);
  });

  it('never calls setTheme', () => {
    const setTheme = jest.spyOn(UnistylesRuntime, 'setTheme');

    launchWith('light');

    expect(setTheme).not.toHaveBeenCalled();
  });
});
