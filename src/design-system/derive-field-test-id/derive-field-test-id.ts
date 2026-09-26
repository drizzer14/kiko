import maybe, { foldMap } from 'fnts/maybe';

// Derives a nested testID from a field's own outer `testID` — `${testID}-${suffix}`
// when the caller passed one, `undefined` when it did not — shared by every
// field component (TextField, FieldTrigger, DateField, HoldingIdentityField, …)
// so each one stops re-implementing the same nullable-map ternary.
export const deriveFieldTestID = (testID: string | undefined, suffix: string): string | undefined =>
  foldMap(maybe(testID), (value) => `${value}-${suffix}`);
