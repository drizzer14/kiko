import { Appearance } from 'react-native';
import { UnistylesRuntime } from 'react-native-unistyles';

import { appearances, applyAppearance } from './appearance';

describe('appearances', () => {
  it('lists light, system, dark in that order', () => {
    expect(appearances).toEqual(['light', 'system', 'dark']);
  });
});

// These assert the CALL CONTRACT only: with `adaptiveThemes: true` registered,
// `setColorScheme` is the single driver, so `applyAppearance` must call ONLY it
// and never the old manual `setAdaptiveThemes`/`setTheme` hybrid. The actual
// live repaint that this fix delivers is a native runtime behaviour and is
// device-verified — the Jest Unistyles mock fakes theme reactivity and cannot
// prove it.
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

  it("clears the native override with 'auto' for 'system' and touches no manual Unistyles setter", () => {
    applyAppearance('system');
    expect(setColorScheme).toHaveBeenCalledWith('auto');
    expect(setAdaptive).not.toHaveBeenCalled();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("pins the native override to 'light' for 'light' and touches no manual Unistyles setter", () => {
    applyAppearance('light');
    expect(setColorScheme).toHaveBeenCalledWith('light');
    expect(setAdaptive).not.toHaveBeenCalled();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("pins the native override to 'dark' for 'dark' and touches no manual Unistyles setter", () => {
    applyAppearance('dark');
    expect(setColorScheme).toHaveBeenCalledWith('dark');
    expect(setAdaptive).not.toHaveBeenCalled();
    expect(setTheme).not.toHaveBeenCalled();
  });
});
