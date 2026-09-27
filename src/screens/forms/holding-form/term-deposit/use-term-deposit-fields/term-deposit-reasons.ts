import { Money } from '@kiko/currency/money';
import { parseAmount } from '@kiko/currency/parse';
import type { Currency } from '@kiko/currency/currency';
import { termReasonKey, type TermReasonKey, type TermUnit } from '@kiko/screens/forms/term-reasons';

// `saved` marks a contribution that is already persisted in the holding's
// stored metadata (an edit-mode hydrated row) versus one the user just added
// in this session. Only unsaved rows may be removed — a persisted
// contribution is part of the deposit's history, so its Remove control
// renders disabled. The flag is explicit rather than inferred from id
// ordering: an explicit boolean is clearer and does not break if the
// seeding/id scheme ever changes.
export type Contribution = { id: number; amount: string; date: number | null; saved: boolean };

// The shape every term-deposit field function validates — kept as one type
// so `termDepositFieldErrors` and `termDepositReasonKey` can never drift
// apart on WHAT they read.
type TermDepositValidationParams = {
  contributions: Contribution[];
  annualRate: string;
  term: string;
  termUnit: TermUnit;
  currency: Currency;
};

// The literal i18n keys `termDepositReasonKey` may return, so `t()` (typed
// from src/i18n/locales/en.ts) accepts them.
export type TermDepositReasonKey =
  | 'forms.holding.contributionsRequiredError'
  | 'forms.holding.contributionIncompleteError'
  | 'forms.holding.annualRateError'
  | TermReasonKey;

export type TermDepositFieldErrors = {
  contributionsError:
    | 'forms.holding.contributionsRequiredError'
    | 'forms.holding.contributionIncompleteError'
    | null;
  annualRateError: 'forms.holding.annualRateError' | null;
  termError: TermReasonKey | null;
};

// Drop blank/partial rows: keep only a positive amount paired with a picked date.
export const parsedContributions = (
  contributions: Contribution[],
  currency: Currency,
): { amountMinorUnits: number; date: number }[] =>
  contributions.flatMap(({ amount, date }) => {
    const amountValue = parseAmount(amount);

    if (!(amountValue > 0) || date === null) {
      return [];
    }

    return [{ amountMinorUnits: Money.fromMajor(currency, amountValue).minorUnits, date }];
  });

// A single contribution ROW's own validity: a positive amount paired with a
// picked date, the same pair `parsedContributions` requires to keep a row.
// Used to catch a row `parsedContributions` would otherwise silently DROP —
// a blank or partially-filled row (most often a fresh add-contribution left
// unfilled) — while at least one OTHER row is already valid, so the overall
// `contributionsRequiredError` never fires: saving must never silently drop
// that row without any indication it was ignored.
export const isContributionRowValid = (contribution: Contribution): boolean =>
  parseAmount(contribution.amount) > 0 && contribution.date !== null;

// The contributions group's OWN reason: at least one contribution with a
// positive amount and a picked date (`parsedContributions` already drops
// blank/partial rows), and EVERY row present either fully filled in or
// removed (never silently dropped).
const contributionsFieldReasonKey = (
  params: TermDepositValidationParams,
): TermDepositFieldErrors['contributionsError'] => {
  if (parsedContributions(params.contributions, params.currency).length === 0) {
    return 'forms.holding.contributionsRequiredError';
  }

  if (params.contributions.some((contribution) => !isContributionRowValid(contribution))) {
    return 'forms.holding.contributionIncompleteError';
  }

  return null;
};

// The annual-rate field's OWN reason, independent of the contributions/term
// fields around it.
const annualRateFieldReasonKey = (
  annualRate: string,
): TermDepositFieldErrors['annualRateError'] => {
  const rate = parseAmount(annualRate);

  return annualRate.trim() === '' || !(rate >= 0) ? 'forms.holding.annualRateError' : null;
};

// Every field's OWN blocking reason, each derived from ONLY that field's own
// input — mirrors `loanFieldErrors`'s own doc comment on why the screen
// renders from this, never from `termDepositReasonKey` below.
export const termDepositFieldErrors = (
  params: TermDepositValidationParams,
): TermDepositFieldErrors => ({
  contributionsError: contributionsFieldReasonKey(params),
  annualRateError: annualRateFieldReasonKey(params.annualRate),
  termError: termReasonKey(params.term, params.termUnit),
});

// A term deposit needs a valid contributions group, a non-negative annual
// rate that was actually entered, and a whole-number term greater than zero
// (in months or years — `termReasonKey`).
// Recapitalization and compounding always carry defaults. Derived from
// `termDepositFieldErrors` above, in the SAME priority order each field
// itself displays, so this can never drift from what any one field shows —
// kept for the Save-block gate and the scroll-to-first-invalid target only.
export const termDepositReasonKey = (
  params: TermDepositValidationParams,
): TermDepositReasonKey | null => {
  const fieldErrors = termDepositFieldErrors(params);

  return fieldErrors.contributionsError ?? fieldErrors.annualRateError ?? fieldErrors.termError;
};
