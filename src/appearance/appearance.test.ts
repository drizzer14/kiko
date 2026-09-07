import { Appearance } from 'react-native';
import { UnistylesRuntime } from 'react-native-unistyles';

import { appearances, applyAppearance } from './appearance';

describe('appearances', () => {
  it('lists light, system, dark in that order', () => {
    expect(appearances).toEqual(['light', 'system', 'dark']);
  });
});

describe('applyAppearance', () => {
  let setAdaptive: jest.SpyInstance;
  let setTheme: jest.SpyInstance;
  let setColorScheme: jest.SpyInstance;

  beforeEach(() => {
    setAdaptive = jest.spyOn(UnistylesRuntime, 'setAdaptiveThemes').mockImplementation(() => {});
    setTheme = jest.spyOn(UnistylesRuntime, 'setTheme').mockImplementation(() => {});
    setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("enables adaptiveThemes and clears the native override for 'system'", () => {
    applyAppearance('system');
    expect(setAdaptive).toHaveBeenCalledWith(true);
    expect(setTheme).not.toHaveBeenCalled();
    expect(setColorScheme).toHaveBeenCalledWith('auto');
  });

  it("pins the light theme and native override for 'light'", () => {
    applyAppearance('light');
    expect(setAdaptive).toHaveBeenCalledWith(false);
    expect(setTheme).toHaveBeenCalledWith('light');
    expect(setColorScheme).toHaveBeenCalledWith('light');
  });

  it("pins the dark theme and native override for 'dark'", () => {
    applyAppearance('dark');
    expect(setAdaptive).toHaveBeenCalledWith(false);
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(setColorScheme).toHaveBeenCalledWith('dark');
  });
});
