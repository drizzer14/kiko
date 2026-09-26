import { deviceRegion } from './device-region';

jest.mock('react-native', () => ({ NativeModules: {} }));

describe('deviceRegion (no native settings)', () => {
  it('returns undefined when SettingsManager is absent', () => {
    expect(deviceRegion()).toBeUndefined();
  });
});
