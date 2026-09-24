import { useCallback, useState } from 'react';

import {
  asLoanMeta,
  type LoanKind,
  type LoanSchedule,
} from '../../../../holdings/holding-metadata';
import type { HoldingRow } from '../../../../db/schema';
import { parseAmount } from '../../../../currency/parse';
import { groupAmount, majorAmountText } from '../../amount-format/amount-format';

// The literal i18n keys `loanReasonKey` below may return, so `t()` (typed
// from src/i18n/locales/en.ts) accepts them — mirrors `PropertyReasonKey`/
// `MetalReasonKey` in holding-form.screen.tsx.
export type LoanReasonKey =
  | 'forms.holding.loanPrincipalError'
  | 'forms.holding.loanStartDateError'
  | 'forms.holding.annualRateError'
  | 'forms.holding.termMonthsError';

// A loan needs a positive principal and a picked start date UNCONDITIONALLY
// (M1, T28 brief); `annualRatePct`/`termMonths` are required ONLY while
// `schedule` is `'annuity'`/`'differentiated'` — `'none'` (an informal debt,
// spec 5.1) carries no schedule at all, so Save never blocks on them there.
// `termMonths` must be a WHOLE number >= 1 (T26 review, M1): a degenerate
// term (0, negative, fractional) would give `loanInstallments` a schedule
// that never reduces the balance to exactly 0. A plain top-level function
// (not an inline closure in the hook body), mirroring `bondIsinReasonKey`,
// so it carries its own cognitive-complexity budget and is directly
// unit-testable with no hook/render machinery.
export const loanReasonKey = (params: {
  principal: string;
  startDate: number | null;
  schedule: LoanSchedule;
  annualRatePct: string;
  termMonths: string;
}): LoanReasonKey | null => {
  const { principal, startDate, schedule, annualRatePct, termMonths } = params;

  if (!(parseAmount(principal) > 0)) {
    return 'forms.holding.loanPrincipalError';
  }

  if (startDate === null) {
    return 'forms.holding.loanStartDateError';
  }

  if (schedule === 'none') {
    return null;
  }

  const rate = parseAmount(annualRatePct);

  if (annualRatePct.trim() === '' || !(rate >= 0)) {
    return 'forms.holding.annualRateError';
  }

  const months = parseAmount(termMonths);

  if (!(Number.isInteger(months) && months > 0)) {
    return 'forms.holding.termMonthsError';
  }

  return null;
};

export type UseLoanFieldsResult = {
  kind: LoanKind;
  setKind: (kind: LoanKind) => void;
  principal: string;
  setPrincipal: (value: string) => void;
  startDate: number | null;
  setStartDate: (value: number) => void;
  schedule: LoanSchedule;
  setSchedule: (value: LoanSchedule) => void;
  annualRatePct: string;
  setAnnualRatePct: (value: string) => void;
  termMonths: string;
  setTermMonths: (value: string) => void;
  reasonKey: LoanReasonKey | null;
  isValid: boolean;
  // Seeds every field from a stored `loan` holding's metadata (edit-mode
  // hydration) — a no-op for invalid/absent metadata, mirroring
  // `seedPropertyFields`/`seedMetalFields` in holding-form.screen.tsx. Kept
  // INSIDE the hook (rather than a module-level function the screen calls
  // with a bag of setters, the property/metal shape) since every field this
  // seeds already lives here — the screen has nothing left to pass but the
  // holding itself.
  seed: (holding: HoldingRow) => void;
};

/**
 * Owns every Loan form field (T28, spec 5.1) — the six pieces of state, the
 * per-schedule validation reason, and the edit-mode seed — extracted out of
 * `HoldingFormScreen` the same way T25's `useBondIsinMode` extracted the
 * Bond form's own mode state, so this hook carries its own
 * cognitive-complexity budget instead of borrowing the screen's.
 */
export const useLoanFields = (): UseLoanFieldsResult => {
  const [kind, setKind] = useState<LoanKind>('mortgage');
  const [principal, setPrincipal] = useState('');
  const [startDate, setStartDate] = useState<number | null>(null);
  // Defaults to 'annuity' — the common structured-loan shape — rather than
  // 'none', so a create that never opens the schedule control still nudges
  // the user toward entering the fuller amortization terms.
  const [schedule, setSchedule] = useState<LoanSchedule>('annuity');
  const [annualRatePct, setAnnualRatePct] = useState('');
  const [termMonths, setTermMonths] = useState('');

  const reasonKey = loanReasonKey({ principal, startDate, schedule, annualRatePct, termMonths });

  const seed = useCallback((holding: HoldingRow): void => {
    const meta = asLoanMeta(holding.metadata);

    if (meta === null) {
      return;
    }

    setKind(meta.kind);
    setPrincipal(groupAmount(majorAmountText(holding.currency, meta.principalMinorUnits)));
    setStartDate(meta.startDate);
    setSchedule(meta.schedule);
    setAnnualRatePct(meta.annualRatePct === undefined ? '' : String(meta.annualRatePct));
    setTermMonths(meta.termMonths === undefined ? '' : String(meta.termMonths));
  }, []);

  return {
    kind,
    setKind,
    principal,
    setPrincipal,
    startDate,
    setStartDate,
    schedule,
    setSchedule,
    annualRatePct,
    setAnnualRatePct,
    termMonths,
    setTermMonths,
    reasonKey,
    isValid: reasonKey === null,
    seed,
  };
};
