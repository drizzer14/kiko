// `jest.requireActual` bypasses the global Jest setup's stub of this spec, so the spec runs its
// own module-level lookup against a fake registry. The result is typed through an annotated local
// because a type argument on `jest.requireActual` hides the dependency from jest's
// `findRelatedTests`, which Stryker uses to pick this test for the spec file.
describe('the KikoReminders native spec', () => {
  it('requests the module registered under the name KikoReminders and exports what it returned', () => {
    const nativeModule = { uses24HourClock: jest.fn() };
    const getEnforcing = jest.fn(() => nativeModule);
    let exported: unknown;

    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ TurboModuleRegistry: { getEnforcing } }));
      const loaded: { default: unknown } = jest.requireActual('./NativeKikoReminders');
      exported = loaded.default;
    });

    expect(getEnforcing).toHaveBeenCalledTimes(1);
    expect(getEnforcing).toHaveBeenCalledWith('KikoReminders');
    expect(exported).toBe(nativeModule);
  });
});
