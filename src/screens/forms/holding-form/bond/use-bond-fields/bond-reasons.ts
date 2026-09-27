import { parseAmount } from '@kiko/currency/parse';

// The shape every bond field function validates — kept as one type so
// `bondFieldErrors` and `bondReasonKey` can never drift apart on WHAT they
// read, mirroring `TermDepositValidationParams`.
type BondValidationParams = {
  quantity: string;
  purchasePrice: string;
  // ISIN mode requires the price paid; Manual mode defaults a blank one to
  // the nominal.
  purchasePriceRequired: boolean;
  faceValue: string;
  couponPct: string;
  purchaseDate: number | null;
  maturityDate: number | null;
};

export type BondFieldErrors = {
  quantityError: 'forms.holding.quantityError' | 'forms.holding.quantityWholeError' | null;
  purchasePriceError: 'forms.holding.purchasePriceRequiredError' | null;
  faceValueError: 'forms.holding.faceValueError' | null;
  couponPctError: 'forms.holding.couponPctError' | null;
  purchaseDateError: 'forms.holding.purchaseDateRequiredError' | null;
  maturityDateError:
    | 'forms.holding.maturityDateRequiredError'
    | 'forms.holding.maturityDateError'
    | null;
};

// The literal i18n keys `bondReasonKey` may return, so `t()` (typed from
// src/i18n/locales/en.ts) accepts them.
export type BondReasonKey = NonNullable<BondFieldErrors[keyof BondFieldErrors]>;

// The bond quantity field's OWN reason, independent of the fields below it.
// A bond is a whole unit: the number-pad has no separator, but a paste or a
// restored `.kiko` can still bring a fraction, which seeds no price per bond.
const quantityFieldReasonKey = (quantity: string): BondFieldErrors['quantityError'] => {
  const value = parseAmount(quantity);

  if (!(value > 0)) {
    return 'forms.holding.quantityError';
  }

  return Number.isInteger(value) ? null : 'forms.holding.quantityWholeError';
};

// The purchase-price field's OWN reason: only where the price is required.
const purchasePriceFieldReasonKey = (
  purchasePrice: string,
  required: boolean,
): BondFieldErrors['purchasePriceError'] =>
  required && !(parseAmount(purchasePrice) > 0) ? 'forms.holding.purchasePriceRequiredError' : null;

// The face-value field's OWN reason, independent of quantity/coupon/dates.
const faceValueFieldReasonKey = (faceValue: string): BondFieldErrors['faceValueError'] =>
  parseAmount(faceValue) > 0 ? null : 'forms.holding.faceValueError';

// The coupon field's OWN reason, independent of the other bond fields.
const couponPctFieldReasonKey = (couponPct: string): BondFieldErrors['couponPctError'] =>
  couponPct.trim() === '' || !(parseAmount(couponPct) >= 0) ? 'forms.holding.couponPctError' : null;

// The purchase-date field's OWN reason: missing entirely, independent of the
// fields around it. This is the ONE bond field rendered in BOTH modes (see
// `purchaseDateErrorMessage`'s own doc comment in `bond-form-block` for how
// ISIN mode ALSO redirects the maturity-date reason here, since ISIN mode
// never mounts its own maturity DateField). `useBondIsinMode`'s own effect
// already defaults this field to today the instant the bond section opens,
// in EITHER mode, so this stays defensive against a silent, unreadable Save
// block if that default ever stops applying before Save is reachable.
const purchaseDateFieldReasonKey = (
  purchaseDate: number | null,
): BondFieldErrors['purchaseDateError'] =>
  purchaseDate === null ? 'forms.holding.purchaseDateRequiredError' : null;

// The maturity-date field's OWN reason: missing (Manual mode only — ISIN
// mode's date is register-sourced and applied automatically once an ISIN
// matches) or, once both dates are picked, out of order — independent of
// quantity/faceValue/coupon.
const maturityDateFieldReasonKey = (
  purchaseDate: number | null,
  maturityDate: number | null,
): BondFieldErrors['maturityDateError'] => {
  if (maturityDate === null) {
    return 'forms.holding.maturityDateRequiredError';
  }

  if (purchaseDate !== null && maturityDate <= purchaseDate) {
    return 'forms.holding.maturityDateError';
  }

  return null;
};

// Every field's OWN blocking reason, each derived from ONLY that field's own
// input — mirrors `termDepositFieldErrors`'s own doc comment on why the
// screen renders from this, never from `bondReasonKey` below.
export const bondFieldErrors = (params: BondValidationParams): BondFieldErrors => ({
  quantityError: quantityFieldReasonKey(params.quantity),
  purchasePriceError: purchasePriceFieldReasonKey(
    params.purchasePrice,
    params.purchasePriceRequired,
  ),
  faceValueError: faceValueFieldReasonKey(params.faceValue),
  couponPctError: couponPctFieldReasonKey(params.couponPct),
  purchaseDateError: purchaseDateFieldReasonKey(params.purchaseDate),
  maturityDateError: maturityDateFieldReasonKey(params.purchaseDate, params.maturityDate),
});

// The bond's own reason, derived from the six field functions above, in the
// SAME priority order each field itself displays — this can never drift from
// what any one field shows, unlike a hand-duplicated chain. A bond ALSO
// needs a valid ISIN and, in the ISIN-mode unmapped-frequency case, a picked
// coupon frequency (`useBondIsinMode`'s own `isinReasonKey`/
// `needsCouponFrequencyPick`) — `useBondFields`'s own `isValid` combines
// those with this reason, since neither lives in this pure, isin-agnostic
// module.
export const bondReasonKey = (params: BondValidationParams): BondReasonKey | null => {
  const fieldErrors = bondFieldErrors(params);

  return (
    fieldErrors.quantityError ??
    fieldErrors.purchasePriceError ??
    fieldErrors.faceValueError ??
    fieldErrors.couponPctError ??
    fieldErrors.purchaseDateError ??
    fieldErrors.maturityDateError
  );
};
