import either from 'fnts/either';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Currency } from '../../../../currency/currency';
import type { HoldingType } from '../../../../holdings/holding-type';
import { startOfLocalDay } from '../../../../dates/local-day';
import { useLiveQuery } from '../../../../db/use-live-query';
import type { BondTerms } from '../../../../bonds/nbu-register';
import { normalizeIsin, validateIsin } from '../../../../bonds/isin';
import type { BondKind, BondCouponFrequency } from '../../../../holdings/holding-metadata';
import { bondRegisterRepo, refreshBondRegisterIfStale } from '../../../../bonds/bond-register-repo';

import { groupAmount, majorAmountText } from '../../amount-format/amount-format';
import type { BondEntryMode } from '../bond-isin-section/bond-isin-section.props';

// The literal i18n keys this hook's own `isinReasonKey` may return (spec
// 6.4; `isinCurrencyMismatchError` added at T25 review round 1, I5).
// Required in ISIN mode, optional-but-must-be-valid-if-typed in Manual mode
// (spec 6.4 #6 keeps the ISIN editable there).
export type IsinReasonKey =
  | 'forms.holding.isinRequiredError'
  | 'forms.holding.isinFormatError'
  | 'forms.holding.isinCheckDigitError'
  | 'forms.holding.isinNotInRegister'
  | 'forms.holding.isinCurrencyMismatchError';

export type UseBondIsinModeParams = {
  type: HoldingType;
  isEdit: boolean;
  currency: Currency;
  purchaseDate: number | null;
  setPurchaseDate: (value: number) => void;
  setFaceValue: (value: string) => void;
  setCouponPct: (value: string) => void;
  setMaturityDate: (value: number) => void;
  setBondKind: (value: BondKind) => void;
  setCouponFrequency: (value: BondCouponFrequency) => void;
  setCurrency: (value: Currency) => void;
  setName: (value: string) => void;
};

// The ISIN field's own blocking reason: required while in ISIN mode,
// optional-but-must-be-valid-if-typed in Manual mode (spec 6.4 #6 keeps it
// editable there). `isinNotInRegister` and `isinCurrencyMismatchError` only
// apply in ISIN mode — the first once the shape/check-digit both pass but
// the cache has no match (spec 6.4 #3, covering a genuine not-found and an
// offline-with-no-cache open the same way), the second once a match IS
// found but its currency differs from the (locked) edit-mode holding
// currency (T25 review round 1, I5). A plain top-level function (not an
// inline closure in the hook body) so it carries its own
// cognitive-complexity budget.
const bondIsinReasonKey = (params: {
  bondMode: BondEntryMode;
  isin: string;
  isinValidation: ReturnType<typeof validateIsin>;
  registerTerms: BondTerms | null;
  isEdit: boolean;
  currency: Currency;
}): IsinReasonKey | null => {
  const { bondMode, isin, isinValidation, registerTerms, isEdit, currency } = params;

  if (bondMode !== 'isin' && isin.trim() === '') {
    return null;
  }

  if (isin.trim() === '') {
    return 'forms.holding.isinRequiredError';
  }

  if (!isinValidation.ok) {
    return isinValidation.reason === 'format'
      ? 'forms.holding.isinFormatError'
      : 'forms.holding.isinCheckDigitError';
  }

  if (bondMode !== 'isin') {
    return null;
  }

  if (registerTerms === null) {
    return 'forms.holding.isinNotInRegister';
  }

  return isEdit && registerTerms.currency !== currency
    ? 'forms.holding.isinCurrencyMismatchError'
    : null;
};

type UseBondIsinModeResult = {
  bondMode: BondEntryMode;
  setBondMode: (mode: BondEntryMode) => void;
  isin: string;
  setIsin: (isin: string) => void;
  registerTerms: BondTerms | null;
  isinReasonKey: IsinReasonKey | null;
};

/**
 * Owns the Bond form's "ISIN / Manual" mode (spec 6.3/6.4): the mode
 * itself, the typed ISIN, the live register lookup, and three SEPARATE
 * effects. Extracted out of `HoldingFormScreen` (T25 review round 1, I4) —
 * a single merged effect shared one dependency array across three
 * unrelated concerns, and an unrelated change (a picked date, the mode
 * itself) re-ran the found-terms apply and silently overwrote a typed name
 * or a changed currency (I1), and put the ISIN segment into a re-tap loop
 * back to Manual for an unmapped-frequency match (I3). This hook has its
 * own cognitive-complexity budget instead of borrowing the component's.
 */
export const useBondIsinMode = (params: UseBondIsinModeParams): UseBondIsinModeResult => {
  const {
    type,
    isEdit,
    currency,
    purchaseDate,
    setPurchaseDate,
    setFaceValue,
    setCouponPct,
    setMaturityDate,
    setBondKind,
    setCouponFrequency,
    setCurrency,
    setName,
  } = params;

  // A CREATE defaults to 'isin'; `holding-form.screen.tsx`'s own edit-mode
  // hydration effect calls `setBondMode('manual')` once the stored holding
  // loads (spec 6.4 #6 — the stored ISIN is shown there, still editable).
  const [bondMode, setBondMode] = useState<BondEntryMode>('isin');
  const [isin, setIsin] = useState('');

  const isinValidation = validateIsin(isin);
  const normalizedIsin = isinValidation.ok ? isinValidation.isin : '';

  // The live register lookup: a validly-shaped ISIN queries the cached
  // `bond_register`; an incomplete/malformed candidate queries an empty
  // string, which matches no row.
  const { data: bondRegisterRows } = useLiveQuery(
    bondRegisterRepo.findByIsinQuery(normalizedIsin),
    ['bond_register'],
  );
  // `useLiveQuery` keeps the PREVIOUS query's `data` until the new one
  // settles, so a match for a just-abandoned ISIN can briefly outlive it
  // (T25 review round 1, M3) — only trust the matched row when its OWN
  // `isin` still equals what is typed now.
  const matchedRow = bondRegisterRows.at(0);
  const registerTerms: BondTerms | null =
    matchedRow !== undefined && matchedRow.isin === normalizedIsin ? matchedRow.terms : null;

  // Refresh the register cache at most once per local day (spec 6.4 #4),
  // fired once the bond section first opens (create OR edit). `either`
  // never rejects, so this bare fire-and-forget statement can never
  // surface a network failure as a form error — the cache simply stays
  // stale until the next open.
  const refreshTriggered = useRef(false);
  useEffect(() => {
    if (type !== 'bond' || refreshTriggered.current) {
      return;
    }
    refreshTriggered.current = true;
    either(() => refreshBondRegisterIfStale());
  }, [type]);

  // ISIN mode defaults `purchaseDate` to LOCAL MIDNIGHT today (spec 6.3),
  // unlike Manual mode, which requires an explicit pick. Local midnight,
  // not a raw `Date.now()`: `DateField.handleDayPress` carries an existing
  // value's own time-of-day onto a newly picked day, so a raw `Date.now()`
  // default would leave a LATER explicit pick composed with today's clock
  // time instead of a clean day.
  useEffect(() => {
    if (type === 'bond' && bondMode === 'isin' && purchaseDate === null) {
      setPurchaseDate(startOfLocalDay(Date.now()));
    }
  }, [type, bondMode, purchaseDate, setPurchaseDate]);

  // Applies a found ISIN's terms EXACTLY ONCE per match — keyed only on the
  // matched row's own `isin` (a stable primitive), never on `bondMode`,
  // `purchaseDate`, or anything else in this closure: re-running it on an
  // unrelated change used to silently overwrite a typed name or a changed
  // currency (T25 review round 1, I1) and re-trigger the Manual auto-switch
  // below on every re-tap of "ISIN" (I3). In edit mode, a match in a
  // DIFFERENT currency than the (locked) holding currency is never applied
  // at all — `isinReasonKey` below blocks Save with its own reason instead
  // (I5); currency itself is never written in edit mode either way,
  // matching `CurrencyField disabled={isEdit}`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(apply once per matched ISIN, not on every unrelated render) deliberately keyed on registerTerms?.isin alone — see the doc comment above (T25 review round 1, I1/I3).
  useEffect(() => {
    if (bondMode !== 'isin' || registerTerms === null) {
      return;
    }
    if (isEdit && registerTerms.currency !== currency) {
      return;
    }

    setFaceValue(
      groupAmount(majorAmountText(registerTerms.currency, registerTerms.faceValueMinorUnits)),
    );
    setCouponPct(String(registerTerms.couponPct));
    setMaturityDate(registerTerms.maturityDate);
    setBondKind('government');
    setName(registerTerms.name);

    if (!isEdit) {
      setCurrency(registerTerms.currency);
    }

    if (registerTerms.couponFrequency === null) {
      setBondMode('manual');
    } else {
      setCouponFrequency(registerTerms.couponFrequency);
    }
  }, [registerTerms?.isin]);

  const isinReasonKey = bondIsinReasonKey({
    bondMode,
    isin,
    isinValidation,
    registerTerms,
    isEdit,
    currency,
  });

  // Wrapped in `useCallback` (a stable identity across renders, matching
  // `setBondMode`'s own `useState` setter) rather than a fresh closure each
  // render — a caller's own effect that depends on this (e.g. the
  // edit-mode hydration effect in `holding-form.screen.tsx`) must not
  // re-run on every unrelated render just because this identity changed.
  const setNormalizedIsin = useCallback((value: string): void => {
    setIsin(normalizeIsin(value));
  }, []);

  return {
    bondMode,
    setBondMode,
    isin,
    setIsin: setNormalizedIsin,
    registerTerms,
    isinReasonKey,
  };
};
