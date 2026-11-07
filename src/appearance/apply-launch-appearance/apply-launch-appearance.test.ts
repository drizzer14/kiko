import { Appearance, NativeModules } from 'react-native';

import { applyLaunchAppearance } from './apply-launch-appearance';

jest.mock('react-native', () => ({
  Appearance: { setColorScheme: jest.fn() },
  NativeModules: { SettingsManager: { settings: {} } },
}));

const storedSettings: Record<string, unknown> = NativeModules.SettingsManager.settings;

describe('applyLaunchAppearance', () => {
  afterEach(() => {
    jest.clearAllMocks();
    storedSettings['kiko.appearanceMode'] = undefined;
  });

  it.each(['light', 'dark'])('puts a saved %s mode on the window', (mode) => {
    storedSettings['kiko.appearanceMode'] = mode;

    applyLaunchAppearance();

    expect(Appearance.setColorScheme).toHaveBeenCalledWith(mode);
  });

  it('leaves the window to the OS in system mode', () => {
    storedSettings['kiko.appearanceMode'] = 'system';

    applyLaunchAppearance();

    expect(Appearance.setColorScheme).not.toHaveBeenCalled();
  });

  it('leaves the window to the OS when no mode is saved', () => {
    applyLaunchAppearance();

    expect(Appearance.setColorScheme).not.toHaveBeenCalled();
  });
});
