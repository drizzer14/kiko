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

// 50 years — comfortably above any real mortgage/car-loan term, and the
// upper bound `loanReasonKey` rejects (Minor 10).
export const MAX_LOAN_TERM_MONTHS = 600;

// The shared shape both `loanFieldErrors` and `loanReasonKey` validate —
// kept as one type so the two can never drift apart on WHAT they read.
type LoanValidationParams = {
  principal: string;
  startDate: number | null;
  schedule: LoanSchedule;
  annualRatePct: string;
  termMonths: string;
};

// Every field's OWN blocking reason, each derived from ONLY that field's own
// input (plus the schedule gate rate/term already share). A loan needs a
// positive principal and a picked start date UNCONDITIONALLY (M1, T28
// brief); `annualRatePct`/`termMonths` are required ONLY while `schedule` is
// `'annuity'`/`'differentiated'` — `'none'` (an informal debt, spec 5.1)
// carries no schedule at all, so Save never blocks on them there.
// `termMonths` must be a WHOLE number >= 1 (T26 review, M1): a degenerate
// term (0, negative, fractional) would give `loanInstallments` a schedule
// that never reduces the balance to exactly 0. Capped at `MAX_TERM_MONTHS`
// (T28 review round 1, Minor 10): an uncapped value (e.g. "99999999", still
// a valid positive integer) makes `loanInstallments` build ~1e8 rows on
// every render, hanging the app.
export type LoanFieldErrors = {
  principalError: 'forms.holding.loanPrincipalError' | null;
  startDateError: 'forms.holding.loanStartDateError' | null;
  annualRateError: 'forms.holding.annualRateError' | null;
  termMonthsError: 'forms.holding.termMonthsError' | null;
};

export const loanFieldErrors = (params: LoanValidationParams): LoanFieldErrors => {
  const { principal, startDate, schedule, annualRatePct, termMonths } = params;
  // 'none' (an informal debt) carries no schedule at all, so rate/term never
  // block Save there — the same gate `loanReasonKey` applies.
  const isStructuredSchedule = schedule !== 'none';
  const rate = parseAmount(annualRatePct);
  const months = parseAmount(termMonths);

  return {
    principalError: parseAmount(principal) > 0 ? null : 'forms.holding.loanPrincipalError',
    startDateError: startDate === null ? 'forms.holding.loanStartDateError' : null,
    annualRateError:
      isStructuredSchedule && (annualRatePct.trim() === '' || !(rate >= 0))
        ? 'forms.holding.annualRateError'
        : null,
    termMonthsError:
      isStructuredSchedule &&
      !(Number.isInteger(months) && months > 0 && months <= MAX_LOAN_TERM_MONTHS)
        ? 'forms.holding.termMonthsError'
        : null,
  };
};

// The loan's own reason, derived from `loanFieldErrors` above, in the SAME
// priority order each field itself displays — kept for the Save-block gate
// and the scroll-to-first-invalid target only (never for what a field
// displays, see `loanFieldErrors`'s own doc comment), so the two can never
// drift apart on WHICH field blocks Save first. A plain top-level function
// (not an inline closure in the hook body), mirroring `bondIsinReasonKey`,
// so it carries its own cognitive-complexity budget and is directly
// unit-testable with no hook/render machinery.
export const loanReasonKey = (params: LoanValidationParams): LoanReasonKey | null => {
  const fieldErrors = loanFieldErrors(params);

  return (
    fieldErrors.principalError ??
    fieldErrors.startDateError ??
    fieldErrors.annualRateError ??
    fieldErrors.termMonthsError
  );
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
  // Independent per-field errors for display — see `loanFieldErrors`'s own
  // doc comment for why the screen renders from this, not `reasonKey`.
  fieldErrors: LoanFieldErrors;
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
  const fieldErrors = loanFieldErrors({
    principal,
    startDate,
    schedule,
    annualRatePct,
    termMonths,
  });

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
    fieldErrors,
    isValid: reasonKey === null,
    seed,
  };
};
