/**
 * What `react-native-keychain` exposes to a test that only reads the accessibility constant. It
 * imports no app code, because a `jest.mock` factory returning it runs while the app's own modules
 * are first loading.
 */
export const keychainModule = {
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
};
