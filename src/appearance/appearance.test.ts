import { Appearance } from 'react-native';
import { UnistylesRuntime } from 'react-native-unistyles';

import { appearances, applyAppearance } from './appearance';

describe('appearances', () => {
  it('lists light, system, dark in that order', () => {
    expect(appearances).toEqual(['light', 'system', 'dark']);
  });
});

// Option B contract: adaptiveThemes is OFF, so the JS themes are driven
// MANUALLY through `UnistylesRuntime.setTheme` and the native chrome through
// `Appearance.setColorScheme`. For a pinned scheme both take the concrete
// value; for 'system' the JS theme takes the OS-resolved scheme and the native
// override is cleared with 'auto'. The old adaptive `setAdaptiveThemes` toggle
// is gone entirely. These assert the CALL CONTRACT only — the live repaint is a
// native runtime behaviour and is device-verified; the Jest Unistyles mock
// fakes theme reactivity and cannot prove it.
describe('applyAppearance', () => {
  let setAdaptive: jest.SpyInstance;
  let setTheme: jest.SpyInstance;
  let setColorScheme: jest.SpyInstance;
  let getColorScheme: jest.SpyInstance;

  beforeEach(() => {
    setAdaptive = jest.spyOn(UnistylesRuntime, 'setAdaptiveThemes').mockImplementation(() => {});
    setTheme = jest.spyOn(UnistylesRuntime, 'setTheme').mockImplementation(() => {});
    setColorScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    getColorScheme = jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');
  });
  afterEach(() => jest.restoreAllMocks());

  it("drives the JS theme from the OS scheme and clears the native override with 'auto' for 'system'", () => {
    applyAppearance('system');
    expect(setTheme).toHaveBeenCalledWith('light');
    expect(setColorScheme).toHaveBeenCalledWith('auto');
    expect(setAdaptive).not.toHaveBeenCalled();
  });

  it("falls back to 'dark' for 'system' when the OS reports no scheme", () => {
    getColorScheme.mockReturnValue(null);
    applyAppearance('system');
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(setColorScheme).toHaveBeenCalledWith('auto');
  });

  it("sets both the JS theme and the native override to 'light' for 'light'", () => {
    applyAppearance('light');
    expect(setTheme).toHaveBeenCalledWith('light');
    expect(setColorScheme).toHaveBeenCalledWith('light');
    expect(setAdaptive).not.toHaveBeenCalled();
  });

  it("sets both the JS theme and the native override to 'dark' for 'dark'", () => {
    applyAppearance('dark');
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(setColorScheme).toHaveBeenCalledWith('dark');
    expect(setAdaptive).not.toHaveBeenCalled();
  });
});
