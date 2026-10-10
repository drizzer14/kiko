// The caller passes a thunk holding its own literal `jest.requireActual('./Native...')`, because
// jest's `findRelatedTests` (which Stryker uses) only sees a specifier written out as a literal.
export function expectNativeSpecLookup(moduleName: string, load: () => { default: unknown }): void {
  const nativeModule = {};
  const getEnforcing = jest.fn(() => nativeModule);
  let exported: unknown;

  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ TurboModuleRegistry: { getEnforcing } }));
    exported = load().default;
  });

  expect(getEnforcing).toHaveBeenCalledTimes(1);
  expect(getEnforcing).toHaveBeenCalledWith(moduleName);
  expect(exported).toBe(nativeModule);
}
