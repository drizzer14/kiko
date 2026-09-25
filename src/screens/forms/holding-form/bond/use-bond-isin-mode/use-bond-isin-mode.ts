import either from 'fnts/either';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  bondRegisterRepo,
  refreshBondRegisterIfStale,
} from '../../../../../bonds/bond-register-repo';
import { useLiveQuery } from '../../../../../db/use-live-query';
import { startOfLocalDay } from '../../../../../dates/local-day';
import type { Currency } from '../../../../../currency/currency';
import type { BondTerms } from '../../../../../bonds/nbu-register';
import { normalizeIsin, validateIsin } from '../../../../../bonds/isin';
import type { HoldingType } from '../../../../../holdings/holding-type';
import type { BondKind, BondCouponFrequency } from '../../../../../holdings/holding-metadata';

import type { BondEntryMode } from '../bond-isin-section/bond-isin-section.props';
import { groupAmount, majorAmountText } from '../../../amount-format/amount-format';

// The literal i18n keys this hook's own `isinReasonKey` may return (spec
// 6.4; `isinCurrencyMismatchError` added at T25 review round 1, I5;
// `isinRegisterNotLoaded` at round 2, M6). Required in ISIN mode,
// optional-but-must-be-valid-if-typed in Manual mode (spec 6.4 #6 keeps the
// ISIN editable there).
export type IsinReasonKey =
  | 'forms.holding.isinRequiredError'
  | 'forms.holding.isinFormatError'
  | 'forms.holding.isinCheckDigitError'
  | 'forms.holding.isinNotInRegister'
  | 'forms.holding.isinRegisterNotLoaded'
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
// editable there). `isinNotInRegister`/`isinRegisterNotLoaded` and
// `isinCurrencyMismatchError` only apply in ISIN mode — the first pair once
// the shape/check-digit both pass but the cache has no match, distinguished
// by whether the register cache has EVER been populated (`registerLoaded`
// — spec 6.4 #3's "not found" and "offline with no cache" still share the
// same Switch-to-Manual path; only the WORDING differs, T25 review round 2,
// M6), the third once a match IS found but its currency differs from the
// (locked) edit-mode holding currency (T25 review round 1, I5). A plain
// top-level function (not an inline closure in the hook body) so it
// carries its own cognitive-complexity budget.
const bondIsinReasonKey = (params: {
  bondMode: BondEntryMode;
  isin: string;
  isinValidation: ReturnType<typeof validateIsin>;
  registerTerms: BondTerms | null;
  registerLoaded: boolean;
  isEdit: boolean;
  currency: Currency;
}): IsinReasonKey | null => {
  const { bondMode, isin, isinValidation, registerTerms, registerLoaded, isEdit, currency } =
    params;

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
    return registerLoaded
      ? 'forms.holding.isinNotInRegister'
      : 'forms.holding.isinRegisterNotLoaded';
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
  registerLoaded: boolean;
  isinReasonKey: IsinReasonKey | null;
  // True while ISIN mode has a found match whose OWN `couponFrequency` the
  // register left unmapped (spec 6.2's own fallback) — spec 6.2 forbids
  // guessing one, so the caller must show its own picker with no default
  // (T25 review round 2, N2) and block Save until `pickedCouponFrequency`
  // is set.
  needsCouponFrequencyPick: boolean;
  pickedCouponFrequency: BondCouponFrequency | null;
  setPickedCouponFrequency: (frequency: BondCouponFrequency) => void;
};

/**
 * Owns the Bond form's "ISIN / Manual" mode (spec 6.3/6.4): the mode
 * itself, the typed ISIN, the live register lookup, and three SEPARATE
 * effects. Extracted out of `HoldingFormScreen` (T25 review round 1, I4) so
 * this hook carries its own cognitive-complexity budget instead of
 * borrowing the component's — which is what let those three effects stay
 * genuinely separate instead of needing to be merged onto one shared
 * dependency array (round 1's I1/I3 root cause).
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
  // string, which matches no row. Deliberately NOT gated on `bondMode` —
  // typing a valid ISIN in Manual mode resolves it just as readily, so a
  // later switch to ISIN mode has an already-settled result to apply
  // (T25 review round 2, N1).
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

  // Whether the `bond_register` cache has EVER been populated — tells "no
  // cache yet" (the register was never fetched, or is fetching for the
  // first time right now) from a confident "not in the register" once the
  // cache has SOME data (T25 review round 2, M6). `replaceAll` writes every
  // row with the SAME `fetchedAt`, so `MAX(fetched_at)` is `null` only when
  // the table is empty.
  const { data: fetchedAtRows } = useLiveQuery(bondRegisterRepo.fetchedAtQuery(), [
    'bond_register',
  ]);
  const registerLoaded = (fetchedAtRows.at(0)?.value ?? null) !== null;

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

  // Applies a found ISIN's terms EXACTLY ONCE per match, tracked by a REF
  // (not the effect's own dependency array) rather than "since bondMode is
  // still isin" — the lookup itself does not depend on `bondMode` (above),
  // so a match resolved while the user is in MANUAL mode must still apply
  // the FIRST time they later switch to ISIN mode (T25 review round 2, N1:
  // keying purely on `registerTerms?.isin` missed exactly this case,
  // because the effect never ran again once `bondMode` stopped changing).
  // `lastAppliedIsinRef` is what makes this idempotent PER ISIN regardless
  // of how many times `bondMode` flips afterward, which is what keeps I3's
  // fix intact: re-tapping "ISIN" for an ALREADY-applied match never
  // re-fires the body below (no re-clobbered name/currency, no re-tripped
  // auto-switch-to-Manual).
  const lastAppliedIsinRef = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(apply once per matched ISIN while in ISIN mode) the ref inside the effect body is what makes re-application idempotent, not the dependency array — see the doc comment above (T25 review round 2, N1).
  useEffect(() => {
    if (bondMode !== 'isin' || registerTerms === null) {
      return;
    }
    if (lastAppliedIsinRef.current === registerTerms.isin) {
      return;
    }
    lastAppliedIsinRef.current = registerTerms.isin;

    // In edit mode the currency field is locked (`CurrencyField
    // disabled={isEdit}`); a found bond in a DIFFERENT currency must not
    // silently change it (I5) — `isinReasonKey` blocks Save with its own
    // reason instead, so this simply skips applying anything.
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

    // An unmapped `pay_period` (spec 6.2's own fallback) switches to Manual
    // ONCE, the first time this ISIN is matched — never guesses a
    // frequency. `needsCouponFrequencyPick` below covers the user later
    // returning to ISIN mode for this SAME match (T25 review round 2, N2).
    if (registerTerms.couponFrequency === null) {
      setBondMode('manual');
    } else {
      setCouponFrequency(registerTerms.couponFrequency);
    }
  }, [registerTerms?.isin, bondMode]);

  const isinReasonKey = bondIsinReasonKey({
    bondMode,
    isin,
    isinValidation,
    registerTerms,
    registerLoaded,
    isEdit,
    currency,
  });

  // The ISIN-mode-only coupon-frequency pick (N2 above). Reset whenever the
  // MATCHED isin itself changes, so a stale pick from a previous unmapped
  // match is never carried onto a new one.
  const [pickedCouponFrequency, setPickedCouponFrequencyState] =
    useState<BondCouponFrequency | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(reset on a new match only) `registerTerms?.isin` is the reset TRIGGER, not read in the body — a stale pick from a PREVIOUS unmapped match must not carry onto a newly matched one.
  useEffect(() => {
    setPickedCouponFrequencyState(null);
  }, [registerTerms?.isin]);

  const needsCouponFrequencyPick =
    bondMode === 'isin' &&
    registerTerms !== null &&
    registerTerms.couponFrequency === null &&
    !(isEdit && registerTerms.currency !== currency);

  // Picking a frequency here ALSO updates the shared `couponFrequency`
  // state Manual mode's own ChipRow (and `buildBondMetadata`) read, so the
  // two stay in sync regardless of which mode the user later saves from.
  const setPickedCouponFrequency = useCallback(
    (frequency: BondCouponFrequency): void => {
      setPickedCouponFrequencyState(frequency);
      setCouponFrequency(frequency);
    },
    [setCouponFrequency],
  );

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
    registerLoaded,
    isinReasonKey,
    needsCouponFrequencyPick,
    pickedCouponFrequency,
    setPickedCouponFrequency,
  };
};
