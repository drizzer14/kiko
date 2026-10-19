import { expectNativeSpecLookup } from '@kiko/test-support/native-spec-lookup';

// `jest.requireActual` bypasses the global Jest setup's stub of this spec, so the spec runs its
// own module-level lookup against a fake registry. The call is spelled out here, untyped, because
// a type argument on `jest.requireActual` hides the dependency from jest's `findRelatedTests`,
// which Stryker uses to pick this test for the spec file.
describe('the KikoReminders native spec', () => {
  it('requests the module registered under the name KikoReminders and exports what it returned', () => {
    expectNativeSpecLookup('KikoReminders', () => jest.requireActual('./NativeKikoReminders'));
  });
});
