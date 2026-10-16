import type { TFunction } from 'i18next';
import { Money } from '@kiko/currency/money';
import { parseAmount } from '@kiko/currency/parse';
import type { Currency } from '@kiko/currency/currency';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';
import { isTemplateNameTaken } from '@kiko/transaction-templates/template-name';

// Whether a money field holds a strictly positive number — the same guard every
// `save` path applies before it writes. `parseAmount` yields NaN for a blank,
// whitespace, or junk field, and `NaN > 0` is false, so one comparison covers
// every rejected case (the same idiom as `contribution-form`'s `canSave`).
const isPositiveAmountText = (text: string): boolean => parseAmount(text) > 0;

// Whether Save is blocked, per mode — each branch mirrors
// exactly what that mode's `save` path validates before it writes:
// - convert: a counterpart holding picked AND a positive counterpart amount.
// - exchange: a destination picked AND a positive Value Out AND Value In.
// - read-only (synced) row: never disabled here — Save only appears once the
//   category changed (`showsSaveButton`), and its write touches only the
//   category, never the bank-owned amount.
// - edit (manual): a positive amount; the category is optional on an edit.
// - fresh add: a positive amount AND a category.
// Kept module-level and pure (a params object, not a long positional list) so
// its branch count stays out of the screen component's cognitive-complexity
// budget.
export type SaveDisabledParams = {
  isSplit: boolean;
  isReadOnly: boolean;
  isEditing: boolean;
  amount: string;
  valueIn: string;
  counterpartAmount: string;
  destinationHoldingId: string | null;
  counterpartHoldingId: string | null;
  selectedCategory: string | null;
  changeReturns: readonly { holdingId: string | null; amount: string }[];
  currency: Currency;
  // The holding the form saves against, whichever way it was fixed: the picker, the page it was
  // opened from, or the row being edited. Null while none is.
  primaryHoldingId: string | null;
  templateName: string;
  // Whether the name field is asked for: a template mode always, a transaction when its
  // "save as a template" switch is on.
  templateNameRequired: boolean;
  isTemplateMode: boolean;
  // Every stored template, for the case-insensitive name check; `editTemplateId` is the one being
  // edited, which does not count against its own name.
  templateNames: readonly { id: string; name: string }[];
  editTemplateId: string | null;
};

// The field key each save-blocking condition below belongs to.
export type SaveDisabledField =
  | 'templateName'
  | 'holding'
  | 'counterpartHolding'
  | 'counterpartAmount'
  | 'destinationHolding'
  | 'valueOut'
  | 'valueIn'
  | 'selectedCategory'
  | 'splitReturns'
  | 'amount';

// Every field's OWN independent error, gated only by which mode is ACTIVE
// (converting/exchange/split/plain are mutually exclusive, so only one
// of these ever renders at a time), typed to hold ONLY the active mode's own
// field keys — a mode's function never even mentions a field it has no
// opinion on, so there is no all-undefined record to keep in sync by hand.
type TransactionFieldErrors = Partial<Record<SaveDisabledField, string>>;

const holdingError = (params: SaveDisabledParams, t: TFunction): string | undefined =>
  params.primaryHoldingId === null ? t('forms.transaction.selectHoldingError') : undefined;

// The name field's own error, in a template mode and beside a transaction alike. A taken name is
// judged here against the live list alone; a name taken since that list was read is refused by the
// write, which the shared save-error alert reports.
const templateNameError = (params: SaveDisabledParams, t: TFunction): string | undefined => {
  if (params.templateName.trim() === '') {
    return t('forms.transaction.templateNameError');
  }

  return isTemplateNameTaken(params.templateName, params.templateNames, params.editTemplateId)
    ? t('forms.transaction.templateNameTakenError')
    : undefined;
};

// A template leaves every amount optional: a blank one is fine, a filled one must still be
// positive.
const isBlankOrPositive = (text: string): boolean =>
  text.trim() === '' || isPositiveAmountText(text);

const filledAmountError = (text: string, message: string): string | undefined =>
  isBlankOrPositive(text) ? undefined : message;

// Every field's OWN independent error in a template mode. Only the holding is required (beside
// the name, `resolveFieldErrors`): the destination, the return holdings and the category are not
// checked at all. One function serves all four modes: `resolveFieldOrder` picks the keys a mode
// shows, so the Value out and plain amount errors share the one amount text.
const templateModeFieldErrors = (
  params: SaveDisabledParams,
  t: TFunction,
): TransactionFieldErrors => ({
  holding: holdingError(params, t),
  amount: filledAmountError(params.amount, t('forms.transaction.amountError')),
  valueOut: filledAmountError(params.amount, t('forms.transaction.valueOutError')),
  valueIn: filledAmountError(params.valueIn, t('forms.transaction.valueInError')),
  splitReturns: params.changeReturns.every((change) => isBlankOrPositive(change.amount))
    ? undefined
    : t('forms.transaction.amountError'),
});

// Every field's OWN independent error for the convert mode.
const convertingFieldErrors = (
  params: SaveDisabledParams,
  t: TFunction,
): TransactionFieldErrors => ({
  counterpartHolding:
    params.counterpartHoldingId === null
      ? t('forms.transaction.selectCounterpartError')
      : undefined,
  counterpartAmount: isPositiveAmountText(params.counterpartAmount)
    ? undefined
    : t('forms.transaction.counterpartAmountError'),
});

// Every field's OWN independent error for the exchange mode.
const exchangeFieldErrors = (params: SaveDisabledParams, t: TFunction): TransactionFieldErrors => ({
  holding: holdingError(params, t),
  destinationHolding:
    params.destinationHoldingId === null
      ? t('forms.transaction.selectDestinationError')
      : undefined,
  valueOut: isPositiveAmountText(params.amount) ? undefined : t('forms.transaction.valueOutError'),
  valueIn: isPositiveAmountText(params.valueIn) ? undefined : t('forms.transaction.valueInError'),
});

// Every field's OWN independent error for the split mode. Together they gate on
// the same invariant `saveSplit` writes (`canSaveSplit`), PLUS a category — a
// split expense's netted magnitude lands in the spending pie, so it must be
// categorised like any other create expense. An empty payment is the Amount's
// own error; returns that cover the payment stay the returns' error, which
// also turns the Amount label red (`isSplitAmountInvalid`).
const splitFieldErrors = (params: SaveDisabledParams, t: TFunction): TransactionFieldErrors => ({
  holding: holdingError(params, t),
  amount: isPositiveAmountText(params.amount) ? undefined : t('forms.transaction.amountError'),
  selectedCategory:
    params.selectedCategory === null ? t('forms.transaction.selectCategoryError') : undefined,
  splitReturns:
    areWellFormedReturns(params.changeReturns) &&
    !returnsCoverPayment(params.amount, params.changeReturns, params.currency)
      ? undefined
      : t('forms.transaction.splitInvalidError'),
});

export const isSplitAmountInvalid = (params: SaveDisabledParams, attemptedSave: boolean): boolean =>
  attemptedSave &&
  params.isSplit &&
  !params.isTemplateMode &&
  returnsCoverPayment(params.amount, params.changeReturns, params.currency);

// Every field's OWN independent error for the read-only/editing/fresh-add
// modes — a fresh add's amount and category are two SEPARATE fields, so
// both show at once instead of the category error waiting for amount to
// clear first. A read-only (synced) row is never blocked here: Save only
// appears once the category changed (`showsSaveButton`), and its write
// touches only the category, never the bank-owned amount.
const plainFieldErrors = (params: SaveDisabledParams, t: TFunction): TransactionFieldErrors => {
  if (params.isReadOnly) {
    return {};
  }

  return {
    holding: holdingError(params, t),
    amount: isPositiveAmountText(params.amount) ? undefined : t('forms.transaction.amountError'),
    selectedCategory:
      params.isEditing || params.selectedCategory !== null
        ? undefined
        : t('forms.transaction.selectCategoryError'),
  };
};

// Converting an existing row to an exchange is a sub-flow of an edit, not a
// `FormMode`, so it is its own key here and wins over whatever form mode is
// selected.
type ActiveMode = FormMode | 'converting';

// Module-level, not inline in the screen: the one extra ternary there pushes
// the screen past Biome's cognitive-complexity ceiling.
export const resolveActiveMode = (converting: boolean, mode: FormMode): ActiveMode =>
  converting ? 'converting' : mode;

export type SpecialSaves = Record<'convert' | 'split' | 'exchange', () => Promise<void>>;

type ModeBehavior = {
  fieldErrors: (params: SaveDisabledParams, t: TFunction) => TransactionFieldErrors;
  // The mode's field keys in the SAME priority order `fieldErrors` tests them —
  // `firstInvalidField` below finds the first of these with an actual error,
  // which is both the Save-block gate AND the scroll-to-first-invalid target, so
  // the two can never disagree.
  fieldOrder: readonly SaveDisabledField[];
  // Null for the income/expense path: `performSave` writes that one itself, then
  // raises the category confirm the three special modes have no use for.
  save: keyof SpecialSaves | null;
};

const PLAIN_MODE_BEHAVIOR: ModeBehavior = {
  fieldErrors: plainFieldErrors,
  fieldOrder: ['holding', 'amount', 'selectedCategory'],
  save: null,
};

// Each mode's field errors, scroll order and save path in one place, keyed by the
// active mode so adding a mode is a compile error until each of the three is
// supplied.
export const MODE_BEHAVIOR: Record<ActiveMode, ModeBehavior> = {
  income: PLAIN_MODE_BEHAVIOR,
  expense: PLAIN_MODE_BEHAVIOR,
  exchange: {
    fieldErrors: exchangeFieldErrors,
    fieldOrder: ['holding', 'destinationHolding', 'valueOut', 'valueIn'],
    save: 'exchange',
  },
  split: {
    fieldErrors: splitFieldErrors,
    fieldOrder: ['holding', 'amount', 'selectedCategory', 'splitReturns'],
    save: 'split',
  },
  converting: {
    fieldErrors: convertingFieldErrors,
    fieldOrder: ['counterpartHolding', 'counterpartAmount'],
    save: 'convert',
  },
};

// The fields a template mode can block on, besides its name: it asks for the holding and checks
// the amounts only when filled.
const TEMPLATE_BLOCKING_FIELDS: ReadonlySet<SaveDisabledField> = new Set([
  'holding',
  'amount',
  'valueOut',
  'valueIn',
  'splitReturns',
]);

// Every field's errors for the active mode: a template mode swaps the mode's own rules for the
// template's, and the name field adds its error wherever it is asked for.
export const resolveFieldErrors = (
  activeMode: ActiveMode,
  params: SaveDisabledParams,
  t: TFunction,
): TransactionFieldErrors => {
  const modeErrors = params.isTemplateMode
    ? templateModeFieldErrors(params, t)
    : MODE_BEHAVIOR[activeMode].fieldErrors(params, t);

  return params.templateNameRequired
    ? { ...modeErrors, templateName: templateNameError(params, t) }
    : modeErrors;
};

// The scroll/priority order that goes with `resolveFieldErrors`: the name leads a template mode
// (it sits on top of the form) and trails a transaction (it sits under the switch at the bottom).
export const resolveFieldOrder = (
  activeMode: ActiveMode,
  params: SaveDisabledParams,
): readonly SaveDisabledField[] => {
  const modeOrder = MODE_BEHAVIOR[activeMode].fieldOrder;

  if (params.isTemplateMode) {
    return ['templateName', ...modeOrder.filter((key) => TEMPLATE_BLOCKING_FIELDS.has(key))];
  }

  return params.templateNameRequired ? [...modeOrder, 'templateName'] : modeOrder;
};

// The first still-invalid field in priority order, or null once every field
// in that order has cleared.
export const firstInvalidField = (
  order: readonly SaveDisabledField[],
  errors: TransactionFieldErrors,
): SaveDisabledField | null => order.find((key) => errors[key] !== undefined) ?? null;

type SplitReturn = { holdingId: string | null; amount: string };

// Whether a split payment + its returns are writable: a positive payment, at
// least one return, each return a positive amount on a DISTINCT holding, and Σ
// returns strictly less than |payment| (the net stays an expense). The payer
// holding IS an allowed return target: its balance nets the payment and the
// return with no double-count, so a return on the payer is valid and the guard
// has no payer id to exclude. Same-currency
// returns only for v1 (enforced by the picker's filter). This is the ENFORCEMENT
// point for the distinct-holding/positive-amount invariant —
// `recordManualWithReturns` has no runtime guard — so it is exported and unit-
// tested directly (the picker's own filter makes a duplicate pick UI-unreachable,
// but a future caller or refactor must still be caught here).
export const canSaveSplit = (
  paymentAmount: string,
  returns: readonly SplitReturn[],
  currency: Currency,
): boolean =>
  isPositiveAmountText(paymentAmount) &&
  areWellFormedReturns(returns) &&
  !returnsCoverPayment(paymentAmount, returns, currency);

// The part of the split invariant the returns answer for on their own, apart
// from the payment, so a split form can judge them while the payment is empty.
const areWellFormedReturns = (returns: readonly SplitReturn[]): boolean =>
  returns.length > 0 &&
  returns.every((change) => change.holdingId !== null && isPositiveAmountText(change.amount)) &&
  new Set(returns.map((change) => change.holdingId)).size === returns.length;

// Whether a positive payment is matched or exceeded by its returns — the part
// of the split invariant that judges the payment too. Compared in INTEGER minor
// units, via the exact conversion the write uses (`Money.fromMajor`), so a
// boundary case can never disagree with what `saveSplit` records because of
// float-major math.
const returnsCoverPayment = (
  paymentAmount: string,
  returns: readonly SplitReturn[],
  currency: Currency,
): boolean => {
  if (!isPositiveAmountText(paymentAmount)) {
    return false;
  }

  const returnsMinor = returns
    .filter((change) => isPositiveAmountText(change.amount))
    .reduce(
      (total, change) => total + Money.fromMajor(currency, parseAmount(change.amount)).minorUnits,
      0,
    );

  return returnsMinor >= Money.fromMajor(currency, parseAmount(paymentAmount)).minorUnits;
};
