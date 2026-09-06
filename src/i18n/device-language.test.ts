// src/i18n/device-language.test.ts
import { deviceLanguage } from './device-language';

// deviceLanguage reads NativeModules.SettingsManager.settings.AppleLanguages[0].
// The RN preset leaves SettingsManager undefined under Jest, so the guarded
// fallback returns 'en'. To exercise the mapping, stub the native tag.
jest.mock('react-native', () => ({
  NativeModules: { SettingsManager: { settings: { AppleLanguages: ['uk-UA'] } } },
}));

describe('deviceLanguage', () => {
  it('maps a Ukrainian primary subtag to uk', () => {
    expect(deviceLanguage()).toBe('uk');
  });
});
