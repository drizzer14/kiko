import maybe, { foldMap } from 'fnts/maybe';
import type { ParseKeys, TFunction } from 'i18next';

// The active error message for a field's OWN independent reason, or
// `undefined` while that field's own check still passes (or before the first
// failed Save press). Every field computes its reason from ONLY its own
// inputs, so fixing one field never changes what a DIFFERENT field renders.
// `interpolation` threads through to `t()` untouched — a key with no
// `{{placeholder}}` (every field but term-months) simply ignores it, so a
// caller may pass the same options object regardless of which of that
// field's own keys ends up active (e.g. term-months' two error keys, only
// one of which needs `{{max}}`).
export const fieldErrorMessage = (
  t: TFunction,
  attemptedSave: boolean,
  reasonKey: ParseKeys | null,
  interpolation?: Record<string, unknown>,
): string | undefined =>
  attemptedSave ? foldMap(maybe(reasonKey), (key) => t(key, interpolation)) : undefined;
