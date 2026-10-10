// `jest.requireActual` bypasses the global Jest setup's stub of this spec, so the spec runs its
// own module-level lookup against a fake registry.
describe('the KikoReminders native spec', () => {
  it('requests the module registered under the name KikoReminders and exports what it returned', () => {
    const nativeModule = { uses24HourClock: jest.fn() };
    const getEnforcing = jest.fn(() => nativeModule);
    let exported: unknown;

    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ TurboModuleRegistry: { getEnforcing } }));
      exported = jest.requireActual<{ default: unknown }>('./NativeKikoReminders').default;
    });

    expect(getEnforcing).toHaveBeenCalledTimes(1);
    expect(getEnforcing).toHaveBeenCalledWith('KikoReminders');
    expect(exported).toBe(nativeModule);
  });
});
