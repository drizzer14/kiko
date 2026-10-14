import { deviceLanguage } from './device-language';

jest.mock('react-native', () => ({ NativeModules: {} }));

describe('deviceLanguage (no native settings)', () => {
  it('falls back to en when SettingsManager is absent', () => {
    expect(deviceLanguage()).toBe('en');
  });
});
