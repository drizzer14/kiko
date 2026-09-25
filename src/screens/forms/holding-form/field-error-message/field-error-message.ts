import maybe, { foldMap } from 'fnts/maybe';
import type { ParseKeys, TFunction } from 'i18next';

// The active error message for a field's OWN independent reason, or
// `undefined` while that field's own check still passes (or before the first
// failed Save press). Every field computes its reason from ONLY its own
// inputs, so fixing one field never changes what a DIFFERENT field renders.
export const fieldErrorMessage = (
  t: TFunction,
  attemptedSave: boolean,
  reasonKey: ParseKeys | null,
): string | undefined => (attemptedSave ? foldMap(maybe(reasonKey), (key) => t(key)) : undefined);
