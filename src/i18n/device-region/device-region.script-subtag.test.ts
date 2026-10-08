import { deviceRegion } from './device-region';

// A locale identifier with a 4-letter script subtag between the language and
// the region (e.g. Simplified Chinese) must not match the script as the
// region — only a 2-letter segment qualifies.
jest.mock('react-native', () => ({
  NativeModules: { SettingsManager: { settings: { AppleLocale: 'zh_Hans_CN' } } },
}));

describe('deviceRegion (a locale identifier with a script subtag)', () => {
  it('skips the 4-letter script subtag and reads the 2-letter region after it', () => {
    expect(deviceRegion()).toBe('CN');
  });
});
