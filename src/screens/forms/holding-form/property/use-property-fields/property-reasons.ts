import { parseAmount } from '@kiko/currency/parse';

// The shape the property field function validates — kept as one type so
// `propertyFieldErrors` and `propertyReasonKey` can never drift apart on
// WHAT they read, mirroring `BondValidationParams`.
type PropertyValidationParams = {
  isEdit: boolean;
  cost: string;
};

export type PropertyFieldErrors = {
  costError: 'forms.holding.propertyCostError' | null;
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

// Every field's OWN blocking reason, each derived from ONLY that field's own
// input — mirrors `bondFieldErrors`'s own doc comment on why the screen
// renders from this, never from `propertyReasonKey` below.
export const propertyFieldErrors = (params: PropertyValidationParams): PropertyFieldErrors => ({
  costError: costFieldReasonKey(params.isEdit, params.cost),
});

// Derived from `propertyFieldErrors` so the two can never disagree: valid
// exactly when there is no reason to reject.
export const propertyReasonKey = (params: PropertyValidationParams): PropertyReasonKey | null =>
  propertyFieldErrors(params).costError;
