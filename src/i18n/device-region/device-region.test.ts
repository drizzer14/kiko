import { deviceRegion } from './device-region';

// deviceRegion reads NativeModules.SettingsManager.settings.AppleLocale —
// iOS's underscore-joined ICU locale identifier (Settings > General >
// Language & Region > Region), a DIFFERENT NSLocale API from the dash-joined
// BCP-47 tags deviceLanguage reads off AppleLanguages, and one whose region
// subtag reflects the Region setting even when it differs from the LANGUAGE.
jest.mock('react-native', () => ({
  NativeModules: { SettingsManager: { settings: { AppleLocale: 'en_US' } } },
}));

describe('deviceRegion', () => {
  it('reads the region subtag off the underscore-joined locale identifier', () => {
    expect(deviceRegion()).toBe('US');
  });
});
