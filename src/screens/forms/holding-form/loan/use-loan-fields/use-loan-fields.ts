import type { RefObject } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useCallback, useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import { normalizeIban } from '@kiko/loans/payment-matcher';
import { MAX_TERM_MONTHS } from '@kiko/holdings/term-limits';
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
// `MetalReasonKey` in their own `<type>-reasons.ts`.
export type LoanReasonKey =
  | 'forms.holding.loanPrincipalError'
  | 'forms.holding.loanStartDateError'
  | 'forms.holding.annualRateError'
  | 'forms.holding.termMonthsError'
  | 'forms.holding.termMonthsMaxError';

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
// positive principal and a picked start date UNCONDITIONALLY;
// `annualRatePct`/`termMonths` are required ONLY while `schedule` is
// `'annuity'`/`'differentiated'` — `'none'` (an informal debt)
// carries no schedule at all, so Save never blocks on them there.
// `termMonths` must be a WHOLE number >= 1: a degenerate term (0, negative,
// fractional) would give `loanInstallments` a schedule that never reduces
// the balance to exactly 0. Capped at `MAX_TERM_MONTHS`: an uncapped value
// (e.g. "99999999", still a valid positive integer) makes `loanInstallments`
// build ~1e8 rows on every render, hanging the app.
export type LoanFieldErrors = {
  principalError: 'forms.holding.loanPrincipalError' | null;
  startDateError: 'forms.holding.loanStartDateError' | null;
  annualRateError: 'forms.holding.annualRateError' | null;
  termMonthsError: 'forms.holding.termMonthsError' | 'forms.holding.termMonthsMaxError' | null;
};

// The term-months field's OWN reason, gated the same way the schedule check
// above gates rate/term — 'none' never blocks Save on either. A term above
// `MAX_TERM_MONTHS` gets its OWN key (naming the maximum) rather than the
// same generic key a non-integer/non-positive term shows — the twin split
// `termDepositFieldErrors`'s own `termMonthsFieldReasonKey` makes.
const termMonthsFieldReasonKey = (
  isStructuredSchedule: boolean,
  termMonths: string,
): LoanFieldErrors['termMonthsError'] => {
  if (!isStructuredSchedule) {
    return null;
  }

  const months = parseAmount(termMonths);

  if (!(Number.isInteger(months) && months > 0)) {
    return 'forms.holding.termMonthsError';
  }

  return months > MAX_TERM_MONTHS ? 'forms.holding.termMonthsMaxError' : null;
};

export const loanFieldErrors = (params: LoanValidationParams): LoanFieldErrors => {
  const { principal, startDate, schedule, annualRatePct, termMonths } = params;
  // 'none' (an informal debt) carries no schedule at all, so rate/term never
  // block Save there — the same gate `loanReasonKey` applies.
  const isStructuredSchedule = schedule !== 'none';
  const rate = parseAmount(annualRatePct);

  return {
    principalError: parseAmount(principal) > 0 ? null : 'forms.holding.loanPrincipalError',
    startDateError: startDate === null ? 'forms.holding.loanStartDateError' : null,
    annualRateError:
      isStructuredSchedule && (annualRatePct.trim() === '' || !(rate >= 0))
        ? 'forms.holding.annualRateError'
        : null,
    termMonthsError: termMonthsFieldReasonKey(isStructuredSchedule, termMonths),
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
  // The loan-payment matcher's own optional inputs — never validated, so
  // they carry no field error of their own.
  paymentHoldingId: string | null;
  setPaymentHoldingId: (value: string | null) => void;
  lenderName: string;
  setLenderName: (value: string) => void;
  lenderIban: string;
  setLenderIban: (value: string) => void;
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
  | 'kind'
  | 'principal'
  | 'startDate'
  | 'schedule'
  | 'annualRatePct'
  | 'termMonths'
  | 'paymentHoldingId'
  | 'lenderName'
  | 'lenderIban'
>;

// A loan's `LoanMeta` — shared by the EDIT-mode `saveEdit` below
// and `buildLoanCreatePayload`, so the two can never build a differently
// shaped `LoanMeta` for the same field values. `paymentHoldingId`/
// `lenderName`/`lenderIban` are independent of `schedule` (unlike rate/term,
// which apply ONLY to a structured schedule) — an untyped blank text field
// trims to `undefined`, matching `asLoanMeta`'s own optional-field
// convention, rather than persisting an empty string.
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
  paymentHoldingId: fields.paymentHoldingId ?? undefined,
  lenderName: fields.lenderName.trim() || undefined,
  // Item 5: normalized (whitespace-stripped, uppercased) at save time, so the
  // matcher's own IBAN compare never depends on cosmetic differences between
  // what the user typed and what a bank feed's own counterIban carries. The
  // typed field's OWN display value is untouched — only the stored value is
  // normalized (see `LoanSection`'s own `lenderIban` TextField, unchanged).
  lenderIban: fields.lenderIban.trim() === '' ? undefined : normalizeIban(fields.lenderIban),
});

// The loan CREATE payload: a zero stored balance (ledgerless — its
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
    return { metadata };
  }

  const day = dayKeyOf(fields.startDate ?? Date.now());

  return {
    metadata,
    firstPricePoint: {
      day,
      price: shiftDecimal(String(metadata.principalMinorUnits), -currencyScale[currency]),
    },
  };
};

/**
 * Item 1: whether a loan EDIT changed one of the three inputs a
 * previously-computed AUTO link's own rules 1/2 (amount, date) were proven
 * against — the loan's own `principalMinorUnits`/`schedule` (either changes
 * every installment's own amount/due-date math, `loanInstallments`) or its
 * `paymentHoldingId` (rule 3's own "paid from" signal, still checked here
 * even though rule 3 itself is never re-verified when an installment is
 * marked taken — see `installmentIsTaken`'s own doc comment — because a
 * changed payer means a FUTURE re-run would no longer even consider that
 * signal a match). A stale AUTO link left in place under the new schedule
 * would otherwise count as "taken" forever, even once it no longer
 * corresponds to any real installment.
 */
export const loanEditInvalidatesAutoLinks = (oldMeta: LoanMeta, newMeta: LoanMeta): boolean =>
  oldMeta.principalMinorUnits !== newMeta.principalMinorUnits ||
  oldMeta.schedule !== newMeta.schedule ||
  oldMeta.paymentHoldingId !== newMeta.paymentHoldingId;

/**
 * The `LoanPricePointOp` a loan EDIT's `holdingsRepo.updateLoan` call needs
 * — the three-case ruling in kiko-domain's "Loan form + detail": (a) a
 * schedule change INTO `'none'` preserves the OLD schedule's current
 * outstanding as a manual point, so the debt never silently reads as 0 the
 * instant the schedule is cleared; (b) a `'none'` loan's principal/start-date
 * edit moves its start-day point (any later correction stays); (c) every
 * other transition (including `'none'` OUT to a schedule) leaves the manual
 * series untouched — a correction point is still valid for a scheduled loan.
 * `oldMeta === null` (a fresh holding, or unparsed metadata) has nothing to
 * reconcile.
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
 * Owns every Loan form field — the six pieces of state, the
 * per-schedule validation reason, the edit-mode seed, and the create/edit
 * payload builders — extracted out of `HoldingFormScreen` the same way
 * `useBondFields`/`useMetalFields` did for their own forms. Unlike
 * property/metal, every field here is editable in BOTH create and edit mode
 * (mirrors term_deposit/bond).
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
  const [paymentHoldingId, setPaymentHoldingId] = useState<string | null>(null);
  const [lenderName, setLenderName] = useState('');
  const [lenderIban, setLenderIban] = useState('');

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
    setPaymentHoldingId(meta.paymentHoldingId ?? null);
    setLenderName(meta.lenderName ?? '');
    setLenderIban(meta.lenderIban ?? '');
  }, []);

  const createPayload = (): CreatePayload =>
    buildLoanCreatePayload(
      {
        kind,
        principal,
        startDate,
        schedule,
        annualRatePct,
        termMonths,
        paymentHoldingId,
        lenderName,
        lenderIban,
      },
      currency,
    );

  // The EDIT-mode write: a loan's manual `holding:<id>` series is reconciled
  // in the SAME transaction as its metadata patch — see
  // `buildLoanPricePointOp`'s own doc comment for the three-case ruling.
  // `oldMeta` reads the STILL-STORED (pre-edit) metadata off the live-queried
  // `editingHolding`, so `buildLoanPricePointOp` can tell what actually
  // changed.
  const saveEdit = (context: EditContext): Promise<void> => {
    const { holdingId, name, color, editingHolding, book } = context;
    const oldMeta =
      foldMap(maybe(editingHolding), (holding) => asLoanMeta(holding.metadata)) ?? null;
    const newMeta = buildLoanMeta(
      {
        kind,
        principal,
        startDate,
        schedule,
        annualRatePct,
        termMonths,
        paymentHoldingId,
        lenderName,
        lenderIban,
      },
      currency,
    );

    return holdingsRepo.updateLoan(
      holdingId,
      { name, color, metadata: newMeta },
      buildLoanPricePointOp({ oldMeta, newMeta, holdingId, currency, book, now: Date.now() }),
      // Item 1: a fresh holding (`oldMeta === null`) has no prior auto links
      // to invalidate — mirrors `buildLoanPricePointOp`'s own `oldMeta ===
      // null` guard.
      oldMeta !== null && loanEditInvalidatesAutoLinks(oldMeta, newMeta),
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
    paymentHoldingId,
    setPaymentHoldingId,
    lenderName,
    setLenderName,
    lenderIban,
    setLenderIban,
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
