import { NativeModules, Settings } from 'react-native';

import {
  APPEARANCE_MIRROR_KEY,
  readAppearanceMirror,
  writeAppearanceMirror,
} from './appearance-mirror';

jest.mock('react-native', () => ({
  NativeModules: { SettingsManager: { settings: {} } },
  Settings: { set: jest.fn() },
}));

const storedSettings: Record<string, unknown> = NativeModules.SettingsManager.settings;

describe('the appearance mirror', () => {
  afterEach(() => {
    for (const key of Object.keys(storedSettings)) {
      delete storedSettings[key];
    }
  });

  it('is stored under kiko.appearanceMode', () => {
    expect(APPEARANCE_MIRROR_KEY).toBe('kiko.appearanceMode');
  });

  it('reads the stored mode from the native settings constants', () => {
    storedSettings[APPEARANCE_MIRROR_KEY] = 'light';

    expect(readAppearanceMirror()).toBe('light');
  });

  it('reads system when nothing is stored', () => {
    expect(readAppearanceMirror()).toBe('system');
  });

  it('reads system when the stored value is outside the enum', () => {
    storedSettings[APPEARANCE_MIRROR_KEY] = 'LIGHT';

    expect(readAppearanceMirror()).toBe('system');
  });

  it('writes the mode under the key through Settings.set', () => {
    writeAppearanceMirror('dark');

    expect(Settings.set).toHaveBeenCalledWith({ [APPEARANCE_MIRROR_KEY]: 'dark' });
  });
});
