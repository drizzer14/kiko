// `isStableGlassCapture`/`isUiTestCapture` read `NativeModules.KikoTestEnv`,
// which is populated by a native module (`ios/Kiko/KikoTestEnv.swift`) this
// track does not build — so every case here drives the reader against a
// FRESH mocked `react-native` module, reloaded per case via
// `jest.isolateModules`, rather than relying on the app's real native module.

describe('ui-test-capture', () => {
  it('returns false for both predicates when KikoTestEnv is undefined (no native module built yet)', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ NativeModules: {} }));

      const { isStableGlassCapture, isUiTestCapture } = require('./ui-test-capture');

      expect(isStableGlassCapture()).toBe(false);
      expect(isUiTestCapture()).toBe(false);
    });
  });

  it('returns false for both predicates when the native constants are false (normal launch)', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({
        NativeModules: { KikoTestEnv: { stableGlass: false, uiTestCapture: false } },
      }));

      const { isStableGlassCapture, isUiTestCapture } = require('./ui-test-capture');

      expect(isStableGlassCapture()).toBe(false);
      expect(isUiTestCapture()).toBe(false);
    });
  });

  it('returns true for each predicate when its own native constant is true', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({
        NativeModules: { KikoTestEnv: { stableGlass: true, uiTestCapture: true } },
      }));

      const { isStableGlassCapture, isUiTestCapture } = require('./ui-test-capture');

      expect(isStableGlassCapture()).toBe(true);
      expect(isUiTestCapture()).toBe(true);
    });
  });
});
