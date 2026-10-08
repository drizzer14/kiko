import { deviceRegion } from './device-region';

// iOS's "Regional Override" setting appends a CLDR locale extension
// ("@rg=gbzzzz") to AppleLocale, after the region subtag — this must be
// stripped before splitting, or the region read finds no valid segment.
jest.mock('react-native', () => ({
  NativeModules: { SettingsManager: { settings: { AppleLocale: 'en_US@rg=gbzzzz' } } },
}));

describe('deviceRegion (a locale identifier with a regional-override extension)', () => {
  it('strips the "@" extension and reads the region before it', () => {
    expect(deviceRegion()).toBe('US');
  });
});
