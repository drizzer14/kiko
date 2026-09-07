import { UnistylesRuntime } from 'react-native-unistyles';

import { appearances, applyAppearance } from './appearance';

describe('appearances', () => {
  it('lists system, light, dark in that order', () => {
    expect(appearances).toEqual(['system', 'light', 'dark']);
  });
});

describe('applyAppearance', () => {
  let setAdaptive: jest.SpyInstance;
  let setTheme: jest.SpyInstance;

  beforeEach(() => {
    setAdaptive = jest.spyOn(UnistylesRuntime, 'setAdaptiveThemes').mockImplementation(() => {});
    setTheme = jest.spyOn(UnistylesRuntime, 'setTheme').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("enables adaptiveThemes for 'system'", () => {
    applyAppearance('system');
    expect(setAdaptive).toHaveBeenCalledWith(true);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("pins the light theme for 'light'", () => {
    applyAppearance('light');
    expect(setAdaptive).toHaveBeenCalledWith(false);
    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it("pins the dark theme for 'dark'", () => {
    applyAppearance('dark');
    expect(setAdaptive).toHaveBeenCalledWith(false);
    expect(setTheme).toHaveBeenCalledWith('dark');
  });
});
