import type { TransactionRow } from '@kiko/db';

// Whether the footer's Save button renders: a manual row always, a synced row
// only once its category has changed, and a converting row always (its Save
// writes the counterpart leg and only the existing row's pair id), and never while the Template
// tab waits for a pick (`awaitsPick`: there is no form to save yet). Kept module-level and
// pure so the footer's boolean expression does not add its own operator count
// to the screen component's cognitive-complexity budget.
export const showsSaveButton = (
  isReadOnly: boolean,
  categoryChanged: boolean,
  converting: boolean,
  awaitsPick: boolean,
): boolean => !awaitsPick && (!isReadOnly || categoryChanged || converting);

// Whether the loan-payment field renders: an EXISTING debit row only (manual
// or synced alike — `setLoanPayment`/`undoAutoLoanLink` carry no source
// gate, same as the category field), data-driven on `loanOptions` rather
// than a flag (a currency with no open loan holding at all simply never
// offers the field — Guideline 5.6), and never while converting (that swaps
// the whole field group for the convert-only inputs). Keyed off the
// PERSISTED amount, not the live in-progress `mode` toggle, so the link's
// own visibility never flip-flops before Save. Kept module-level and pure
// for the same cognitive-complexity-budget reason as `showsSaveButton`
// above.
//
// Also visible whenever the row already carries a link
// (`selectedLoanHoldingId`), even with zero open loan options AND even when
// the row is not a debit (a linked row later edited from debit
// to credit must not hide the field where None/Undo live) — a filter never
// hides an active selection: the row stays linked whose loan closed, moved
// currency, or whose own amount sign changed, and the user must be able to
// reach the field to see that link, Undo it, or pick "None", not just a
// currently-open loan on a currently-eligible debit. `buildLoanOptions`
// already unions that same loan back into `loanOptions`, so this is a
// belt-and-suspenders direct check, not the only guard.
export const isLoanFieldVisible = (
  existingAmountMinorUnits: number | undefined,
  loanOptionCount: number,
  converting: boolean,
  selectedLoanHoldingId: string | null,
): boolean =>
  existingAmountMinorUnits !== undefined &&
  !converting &&
  (selectedLoanHoldingId !== null || (existingAmountMinorUnits < 0 && loanOptionCount > 0));

// The current loan link's own two pieces, resolved together so the screen
// body reads one call instead of two separate `?? null` chains — kept
// module-level for the same cognitive-complexity-budget reason as
// `isLoanFieldVisible` above.
export const resolveLoanLinkState = (
  existing: Pick<TransactionRow, 'loanHoldingId' | 'loanLinkSource'> | undefined,
): { selectedLoanHoldingId: string | null; loanLinkSource: 'auto' | 'manual' | null } => ({
  selectedLoanHoldingId: existing?.loanHoldingId ?? null,
  loanLinkSource: existing?.loanLinkSource ?? null,
});
