import { parseAmount } from '../../../../../currency/parse';
import { compareDecimal, normalizeDecimal } from '../../../../../currency/decimal';

// The shape every metal field function validates — kept as one type so
// `metalFieldErrors` and `metalReasonKey` can never drift apart on WHAT they
// read, mirroring `PropertyValidationParams`.
type MetalValidationParams = {
  isEdit: boolean;
  purity: string;
  quantity: string;
  cost: string;
};

// The literal i18n keys `metalReasonKey` may return — reusing the SAME
// generic quantity error the bond form already carries, and the Lot form's
// own total-cost error, rather than minting a metal-specific duplicate of
// either message. `purityError` is metal-specific: no other form field
// validates a 0-1 fineness ratio.
export type MetalFieldErrors = {
  purityError: 'forms.holding.purityError' | null;
  quantityError: 'forms.holding.quantityError' | null;
  costError: 'forms.lot.totalCostError' | null;
};

export type MetalReasonKey = NonNullable<MetalFieldErrors[keyof MetalFieldErrors]>;

// Purity applies in BOTH create and edit mode — `MetalSection` always
// renders the field (unlike the create-only Quantity/Total cost pair
// below), and a fineness ratio is meaningful whenever it's shown. A garbled
// or out-of-range value BLOCKS Save rather than reaching either metadata
// builder at all. Validates with `normalizeDecimal` + `compareDecimal`, the
// SAME parser `normalizedPurityOrThrow` (the writer) uses, so a value this
// check accepts is guaranteed to parse when the writer runs.
const purityFieldReasonKey = (purity: string): MetalFieldErrors['purityError'] => {
  const normalizedPurity = normalizeDecimal(purity);

  return normalizedPurity !== null &&
    compareDecimal(normalizedPurity, '0') > 0 &&
    compareDecimal(normalizedPurity, '1') <= 0
    ? null
    : 'forms.holding.purityError';
};

// The metal quantity field's OWN reason (the first-lot Quantity/Total cost
// fields only apply at CREATE time — `MetalSection` hides them in edit
// mode: quantity/cost history is fixed at creation, a later buy/sell goes
// through the dedicated Lot form instead), independent of purity/cost.
const quantityFieldReasonKey = (
  isEdit: boolean,
  quantity: string,
): MetalFieldErrors['quantityError'] => {
  if (isEdit) {
    return null;
  }

  const normalizedQuantity = normalizeDecimal(quantity);

  return normalizedQuantity === null || compareDecimal(normalizedQuantity, '0') <= 0
    ? 'forms.holding.quantityError'
    : null;
};

// The metal total-cost field's OWN reason (CREATE time only, see
// `quantityFieldReasonKey`'s own doc comment), independent of
// purity/quantity.
const costFieldReasonKey = (isEdit: boolean, cost: string): MetalFieldErrors['costError'] =>
  isEdit || parseAmount(cost) > 0 ? null : 'forms.lot.totalCostError';

// Every field's OWN blocking reason, each derived from ONLY that field's own
// input — mirrors `bondFieldErrors`'s own doc comment on why the screen
// renders from this, never from `metalReasonKey` below.
export const metalFieldErrors = (params: MetalValidationParams): MetalFieldErrors => ({
  purityError: purityFieldReasonKey(params.purity),
  quantityError: quantityFieldReasonKey(params.isEdit, params.quantity),
  costError: costFieldReasonKey(params.isEdit, params.cost),
});

// The metal's own reason, derived from the three field functions above, in
// the SAME priority order each field itself displays — purity renders ABOVE
// the Quantity/Total cost fields in `MetalSection`'s own JSX, so it takes
// priority here too.
export const metalReasonKey = (params: MetalValidationParams): MetalReasonKey | null => {
  const fieldErrors = metalFieldErrors(params);

  return fieldErrors.purityError ?? fieldErrors.quantityError ?? fieldErrors.costError;
};
