// `TurboModuleRegistry.getEnforcing` throws on a binary built without the
// module. The wrapper must load it on first use, never at import, so that
// importing any reminders code cannot crash the app on such a binary.
const MISSING_MODULE = 'KikoReminders is not in this binary';

const loadWrapperWithoutNativeModule = (): typeof import('.') => {
  let wrapper: typeof import('.') | undefined;

  jest.isolateModules(() => {
    jest.doMock('./NativeKikoReminders', () => {
      throw new Error(MISSING_MODULE);
    });
    wrapper = require('.') as typeof import('.');
  });

  return wrapper as typeof import('.');
};

describe('the native module is required on first use, not at import', () => {
  it('imports the barrel without loading the native module', () => {
    expect(loadWrapperWithoutNativeModule).not.toThrow();
  });

  it('rejects the first call instead, with the native load error', async () => {
    const { remindersNative } = loadWrapperWithoutNativeModule();

    await expect(remindersNative.authorizationStatus()).rejects.toThrow(MISSING_MODULE);
  });
});
