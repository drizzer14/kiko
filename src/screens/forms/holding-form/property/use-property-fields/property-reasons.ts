import { parseAmount } from '@kiko/currency/parse';
import type { OwnershipShare } from '@kiko/holdings/ownership';

// The shape the property field function validates — kept as one type so
// `propertyFieldErrors` and `propertyReasonKey` can never drift apart on
// WHAT they read, mirroring `BondValidationParams`.
type PropertyValidationParams = {
  isEdit: boolean;
  cost: string;
  // Whether the category takes a share at all (every one but a loan given).
  ownershipApplies: boolean;
  // The typed share, or null when it does not parse.
  ownership: OwnershipShare | null;
};

export type PropertyFieldErrors = {
  costError: 'forms.holding.propertyCostError' | null;
  ownershipError: 'forms.holding.ownershipError' | null;
};

// The literal i18n key `propertyReasonKey` may return, so `t()` (typed from
// src/i18n/locales/en.ts) accepts it.
export type PropertyReasonKey = NonNullable<PropertyFieldErrors[keyof PropertyFieldErrors]>;

// The cost field only applies at CREATE time (PropertySection hides it in
// edit mode: cost/quantity history is fixed at creation, a later
// revaluation goes through the dedicated "Update value" form instead), so
// this only rejects on create — an edit always passes.
const costFieldReasonKey = (isEdit: boolean, cost: string): PropertyFieldErrors['costError'] =>
  !isEdit && !(parseAmount(cost) > 0) ? 'forms.holding.propertyCostError' : null;

// The share renders on create AND edit, so it blocks on both — unless the
// category hides it.
const ownershipFieldReasonKey = (
  ownershipApplies: boolean,
  ownership: OwnershipShare | null,
): PropertyFieldErrors['ownershipError'] =>
  ownershipApplies && ownership === null ? 'forms.holding.ownershipError' : null;

// Every field's OWN blocking reason, each derived from ONLY that field's own
// input — mirrors `bondFieldErrors`'s own doc comment on why the screen
// renders from this, never from `propertyReasonKey` below.
export const propertyFieldErrors = (params: PropertyValidationParams): PropertyFieldErrors => ({
  costError: costFieldReasonKey(params.isEdit, params.cost),
  ownershipError: ownershipFieldReasonKey(params.ownershipApplies, params.ownership),
});

// Derived from `propertyFieldErrors` so the two can never disagree: valid
// exactly when there is no reason to reject; the first reason in form order.
export const propertyReasonKey = (params: PropertyValidationParams): PropertyReasonKey | null => {
  const { costError, ownershipError } = propertyFieldErrors(params);

  return costError ?? ownershipError;
};
