import { readAppearanceMirror } from './appearance-mirror';

jest.mock('react-native', () => ({ NativeModules: {} }));

describe('readAppearanceMirror (no native settings)', () => {
  it('reads system when SettingsManager is absent, without throwing', () => {
    expect(readAppearanceMirror()).toBe('system');
  });
});
