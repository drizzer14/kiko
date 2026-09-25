import type { RefObject } from 'react';
import { useCallback, useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { holdingsRepo, type LoanPricePointOp } from '@kiko/holdings/repo';

import {
  asLoanMeta,
  type LoanKind,
  type LoanMeta,
  type LoanSchedule,
} from '../../../../../holdings/holding-metadata';
import { Money } from '../../../../../currency/money';
import type { HoldingRow } from '../../../../../db/schema';
import { parseAmount } from '../../../../../currency/parse';
import { shiftDecimal } from '../../../../../currency/decimal';
import { dayKeyOf, type PriceBook } from '../../../../../prices/price-book';
import type { FieldInstance } from '../../../scroll-to-field/scroll-to-field';
import { loanOutstandingMinorAt } from '../../../../../holdings/loan-schedule';
import { currencyScale, type Currency } from '../../../../../currency/currency';
import { groupAmount, majorAmountText } from '../../../amount-format/amount-format';
import type { CreatePayload, EditContext, HoldingTypeForm } from '../../holding-type-form';

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

export type UseLoanFieldsResult = HoldingTypeForm & {
  currency: Currency;
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
  refs: {
    principalFieldRef: RefObject<FieldInstance | null>;
    startDateFieldRef: RefObject<FieldInstance | null>;
    annualRateFieldRef: RefObject<FieldInstance | null>;
    termMonthsFieldRef: RefObject<FieldInstance | null>;
    principalInputRef: RefObject<TextInputInstance | null>;
    annualRateInputRef: RefObject<TextInputInstance | null>;
    termMonthsInputRef: RefObject<TextInputInstance | null>;
  };
};

type UseLoanFieldsParams = {
  currency: Currency;
};

// The fields `buildLoanMeta`/`buildLoanCreatePayload` both need (ponytail: a
// `Pick` off the hook's own result type, not a restated shape).
type LoanFieldsSnapshot = Pick<
  UseLoanFieldsResult,
  'kind' | 'principal' | 'startDate' | 'schedule' | 'annualRatePct' | 'termMonths'
>;

// A loan's `LoanMeta` (T26/T28, spec 5.1) — shared by the EDIT-mode
// `saveEdit` below and `buildLoanCreatePayload`, so the two can never build a
// differently shaped `LoanMeta` for the same field values.
const buildLoanMeta = (fields: LoanFieldsSnapshot, currency: Currency): LoanMeta => ({
  kind: fields.kind,
  principalMinorUnits: Money.fromMajor(currency, parseAmount(fields.principal) || 0).minorUnits,
  startDate: fields.startDate ?? Date.now(),
  schedule: fields.schedule,
  ...(fields.schedule === 'none'
    ? {}
    : {
        annualRatePct: parseAmount(fields.annualRatePct) || 0,
        termMonths: parseAmount(fields.termMonths) || 0,
      }),
});

// The loan CREATE payload (T28): a zero stored balance (ledgerless — its
// value derives entirely from the schedule math / its own manual series,
// kiko-domain) plus the `LoanMeta` above. A `'none'` schedule (an informal
// debt) ADDITIONALLY writes a first `manual` price point on the holding's
// own `holding:<id>` series equal to the principal, dated the start day —
// mirroring `buildPropertyCreatePayload`'s own first-point convention —
// so `loanOutstandingMinorAt`'s manual-series read never comes up empty
// before the user records a real correction. An `'annuity'`/`'differentiated'`
// schedule writes none: its outstanding is computed at read time from the
// principal + schedule (`loanOutstandingMinorAt`'s own no-correction
// fallback), so no correction point is needed yet.
const buildLoanCreatePayload = (fields: LoanFieldsSnapshot, currency: Currency): CreatePayload => {
  const metadata = buildLoanMeta(fields, currency);

  if (fields.schedule !== 'none') {
    return { balanceMinorUnits: 0, metadata };
  }

  const day = dayKeyOf(fields.startDate ?? Date.now());

  return {
    balanceMinorUnits: 0,
    metadata,
    firstPricePoint: {
      day,
      price: shiftDecimal(String(metadata.principalMinorUnits), -currencyScale[currency]),
    },
  };
};

/**
 * The `LoanPricePointOp` a loan EDIT's `holdingsRepo.updateLoan` call needs
 * — the three-case ruling in kiko-domain's "Loan form + detail": (a) a
 * schedule change INTO `'none'` preserves the OLD schedule's current
 * outstanding as a manual point, so the debt never silently reads as 0 the
 * instant the schedule is cleared; (b) a `'none'` loan's principal/start-date
 * edit moves its start-day point (any later correction stays); (c) every
 * other transition (including `'none'` OUT to a schedule) leaves the manual
 * series untouched — a correction point is still valid for a scheduled loan
 * (N10a). `oldMeta === null` (a fresh holding, or unparsed metadata) has
 * nothing to reconcile.
 */
const buildLoanPricePointOp = (params: {
  oldMeta: LoanMeta | null;
  newMeta: LoanMeta;
  holdingId: string;
  currency: Currency;
  book: PriceBook;
  now: number;
}): LoanPricePointOp => {
  const { oldMeta, newMeta, holdingId, currency, book, now } = params;

  if (oldMeta === null) {
    return { kind: 'none' };
  }

  if (oldMeta.schedule !== 'none' && newMeta.schedule === 'none') {
    // (a) normally dates the preserved point today. But `loanOutstandingMinorAt`
    // reads 0 for any instant before the loan's own `startDate` (a future-start
    // loan), so dating it today would write a permanent 0 that outlives the
    // start date once it arrives. Write the principal at the start day instead
    // — mirroring the create-mode `'none'` first point — whenever today is
    // still before that day.
    const beforeStart = dayKeyOf(now) < dayKeyOf(newMeta.startDate);
    const day = beforeStart ? dayKeyOf(newMeta.startDate) : dayKeyOf(now);
    const outstanding = beforeStart
      ? newMeta.principalMinorUnits
      : loanOutstandingMinorAt(oldMeta, holdingId, book, now);

    return {
      kind: 'upsert',
      day,
      price: shiftDecimal(String(outstanding), -currencyScale[currency]),
      currency,
    };
  }

  if (
    oldMeta.schedule === 'none' &&
    newMeta.schedule === 'none' &&
    (oldMeta.principalMinorUnits !== newMeta.principalMinorUnits ||
      oldMeta.startDate !== newMeta.startDate)
  ) {
    return {
      kind: 'move',
      oldDay: dayKeyOf(oldMeta.startDate),
      newDay: dayKeyOf(newMeta.startDate),
      price: shiftDecimal(String(newMeta.principalMinorUnits), -currencyScale[currency]),
      currency,
    };
  }

  return { kind: 'none' };
};

/**
 * Owns every Loan form field (T28, spec 5.1) — the six pieces of state, the
 * per-schedule validation reason, the edit-mode seed, and the create/edit
 * payload builders — extracted out of `HoldingFormScreen` the same way
 * `useBondFields`/`useMetalFields` did for their own forms (R3 Phase C).
 * Unlike property/metal, every field here is editable in BOTH create and
 * edit mode (mirrors term_deposit/bond).
 */
export const useLoanFields = (params: UseLoanFieldsParams): UseLoanFieldsResult => {
  const { currency } = params;

  const [kind, setKind] = useState<LoanKind>('mortgage');
  const [principal, setPrincipal] = useState('');
  const [startDate, setStartDate] = useState<number | null>(null);
  // Defaults to 'annuity' — the common structured-loan shape — rather than
  // 'none', so a create that never opens the schedule control still nudges
  // the user toward entering the fuller amortization terms.
  const [schedule, setSchedule] = useState<LoanSchedule>('annuity');
  const [annualRatePct, setAnnualRatePct] = useState('');
  const [termMonths, setTermMonths] = useState('');

  const principalFieldRef = useRef<FieldInstance>(null);
  const startDateFieldRef = useRef<FieldInstance>(null);
  const annualRateFieldRef = useRef<FieldInstance>(null);
  const termMonthsFieldRef = useRef<FieldInstance>(null);
  const principalInputRef = useRef<TextInputInstance>(null);
  const annualRateInputRef = useRef<TextInputInstance>(null);
  const termMonthsInputRef = useRef<TextInputInstance>(null);

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

  const createPayload = (): CreatePayload =>
    buildLoanCreatePayload(
      { kind, principal, startDate, schedule, annualRatePct, termMonths },
      currency,
    );

  // The EDIT-mode write: a loan's manual `holding:<id>` series is reconciled
  // in the SAME transaction as its metadata patch (T28 review round 1, I1) —
  // see `buildLoanPricePointOp`'s own doc comment for the three-case ruling.
  // `oldMeta` reads the STILL-STORED (pre-edit) metadata off the live-queried
  // `editingHolding`, so `buildLoanPricePointOp` can tell what actually
  // changed.
  const saveEdit = (context: EditContext): Promise<void> => {
    const { holdingId, name, color, editingHolding, book } = context;
    const oldMeta = editingHolding ? asLoanMeta(editingHolding.metadata) : null;
    const newMeta = buildLoanMeta(
      { kind, principal, startDate, schedule, annualRatePct, termMonths },
      currency,
    );

    return holdingsRepo.updateLoan(
      holdingId,
      { name, color, metadata: newMeta },
      buildLoanPricePointOp({ oldMeta, newMeta, holdingId, currency, book, now: Date.now() }),
    );
  };

  return {
    currency,
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
    scrollTargets: [
      {
        invalid: fieldErrors.principalError !== null,
        ref: principalFieldRef,
        focus: () => principalInputRef.current?.focus(),
      },
      { invalid: fieldErrors.startDateError !== null, ref: startDateFieldRef },
      {
        invalid: fieldErrors.annualRateError !== null,
        ref: annualRateFieldRef,
        focus: () => annualRateInputRef.current?.focus(),
      },
      {
        invalid: fieldErrors.termMonthsError !== null,
        ref: termMonthsFieldRef,
        focus: () => termMonthsInputRef.current?.focus(),
      },
    ],
    createPayload,
    saveEdit,
    seed,
    refs: {
      principalFieldRef,
      startDateFieldRef,
      annualRateFieldRef,
      termMonthsFieldRef,
      principalInputRef,
      annualRateInputRef,
      termMonthsInputRef,
    },
  };
};
