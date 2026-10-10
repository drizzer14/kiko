// `jest.requireActual` bypasses the global Jest setup's stub of this spec, so the spec runs its
// own module-level lookup against a fake registry.
describe('the DisplayRegions native spec', () => {
  it('requests the module registered under the name DisplayRegions and exports what it returned', () => {
    const nativeModule = { getSnapshot: jest.fn() };
    const getEnforcing = jest.fn(() => nativeModule);
    let exported: unknown;

    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ TurboModuleRegistry: { getEnforcing } }));
      exported = jest.requireActual<{ default: unknown }>('./NativeDisplayRegions').default;
    });

    expect(getEnforcing).toHaveBeenCalledTimes(1);
    expect(getEnforcing).toHaveBeenCalledWith('DisplayRegions');
    expect(exported).toBe(nativeModule);
  });
});
