// `TurboModuleRegistry.getEnforcing` throws on a binary built without the
// module. Every screen reads these layout hooks, so the wrapper must load the
// module on first use, never at import, and fall back to the ordinary
// single-window iPhone when it is missing.
//
// This file has no import or export, so it shares the global scope with the other lazy-load
// tests: every top-level name here carries the display-regions prefix.
const MISSING_DISPLAY_REGIONS_MODULE = 'DisplayRegions is not in this binary';

// `'../index'`, not `'..'`: Jest resolves a bare `'..'` to the repository root here.
type DisplayRegionsBarrel = typeof import('../index');

const loadDisplayRegionsWithoutNativeModule = (): DisplayRegionsBarrel => {
  let barrel: DisplayRegionsBarrel | undefined;

  jest.isolateModules(() => {
    jest.doMock('@kiko/native-specs/NativeDisplayRegions', () => {
      throw new Error(MISSING_DISPLAY_REGIONS_MODULE);
    });
    barrel = require('../index') as DisplayRegionsBarrel;
  });

  return barrel as DisplayRegionsBarrel;
};

describe('the display-regions native module is required on first use, not at import', () => {
  it('imports the barrel without loading the native module', () => {
    expect(loadDisplayRegionsWithoutNativeModule).not.toThrow();
  });

  it('never reaches TurboModuleRegistry.getEnforcing at import', () => {
    const getEnforcing = jest.fn();

    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({
        TurboModuleRegistry: { getEnforcing },
      }));
      jest.unmock('@kiko/native-specs/NativeDisplayRegions');
      require('../index');
    });

    expect(getEnforcing).not.toHaveBeenCalled();
  });
});

describe('with the display-regions native module absent', () => {
  it('reads the fallback snapshot instead of throwing', () => {
    const { displayRegionsNative } = loadDisplayRegionsWithoutNativeModule();

    expect(displayRegionsNative.getSnapshot()).toEqual({
      horizontalSizeClass: 'compact',
      verticalBarEdge: 'none',
      tabBarEdge: 'none',
      foldRegion: null,
    });
  });

  it('requestRefresh with no native module does not throw', () => {
    const { displayRegionsNative } = loadDisplayRegionsWithoutNativeModule();

    expect(() => displayRegionsNative.requestRefresh()).not.toThrow();
  });

  it('subscribes to nothing and returns an unsubscribe that does nothing', () => {
    const { displayRegionsNative } = loadDisplayRegionsWithoutNativeModule();

    const unsubscribe = displayRegionsNative.subscribe(jest.fn());

    expect(unsubscribe).not.toThrow();
  });
});
