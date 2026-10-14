import type { TFunction } from 'i18next';
import { Money } from '@kiko/currency/money';
import { parseAmount } from '@kiko/currency/parse';
import type { HoldingRow, TransactionRow } from '@kiko/db';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';
import { type Currency, currencySymbol } from '@kiko/currency/currency';
import { transactionRowDescription } from '@kiko/transactions/row-description';

export type Sign = 'income' | 'expense';

// The form's own mode (`FormMode`, from the mode-select-field the screen
// renders) is a superset of `Sign`: an Exchange is neither an income nor an
// expense row, so it gets its own branch through `save` (see `saveExchange` in
// the screen) rather than trying to force it through the signed income/expense
// amount path.

// One change-return row of a split payment while it is being entered: the
// picked holding (null until chosen) and its still-unparsed major-amount text.
// `id` is a stable client key for the dynamic row list (mirrors the term-
// deposit contribution rows), never persisted.
export type ChangeReturnRow = { id: number; holdingId: string | null; amount: string };

// The notice text for a read-only row: a statement-imported row names its file,
// every other non-manual row (a sync's) says it was synced.
export const readOnlyNoticeKey = (
  source: TransactionRow['source'] | undefined,
): 'forms.transaction.importedNotice' | 'forms.transaction.syncedNotice' =>
  source === 'import' ? 'forms.transaction.importedNotice' : 'forms.transaction.syncedNotice';

// The header title reflects the mode: a template mode names itself, a synced row is a plain
// read-only view, an existing manual row is an edit, and no id at all is a fresh add. The
// candidate titles are catalog-resolved strings, passed in as a labels object rather than read
// from a module-level constant, so the helper stays translation-agnostic.
export const headerTitle = (
  isReadOnly: boolean,
  isEditing: boolean,
  templateEntry: 'add' | 'edit' | null,
  labels: {
    readOnly: string;
    editing: string;
    adding: string;
    addingTemplate: string;
    editingTemplate: string;
  },
): string => {
  if (templateEntry !== null) {
    const templateTitles: Record<'add' | 'edit', string> = {
      add: labels.addingTemplate,
      edit: labels.editingTemplate,
    };

    return templateTitles[templateEntry];
  }

  if (isReadOnly) {
    return labels.readOnly;
  }

  return isEditing ? labels.editing : labels.adding;
};

// The trailing currency glyph for the holding a leg targets, looked up by id:
// the holding's own currency symbol, or an empty string when no holding is
// selected yet (so a not-yet-known currency shows no symbol, never a wrong
// one). Used for the Exchange Value-In leg and the convert counterpart leg,
// whose currency comes from a picked holding rather than the source holding.
export const holdingSuffix = (
  holdings: readonly HoldingRow[],
  holdingId: string | null,
): string => {
  const holding = holdings.find((candidate) => candidate.id === holdingId);

  return holding ? currencySymbol[holding.currency] : '';
};

export const signedMinorUnits = (currency: Currency, amount: string, sign: Sign): number => {
  const magnitude = Money.fromMajor(currency, parseAmount(amount));

  return sign === 'expense' ? -magnitude.minorUnits : magnitude.minorUnits;
};

// The description field's placeholder: a preview of the label the row would
// carry if its description is left blank, resolved by the SAME
// `transactionRowDescription` the Home and Holding-detail lists render — so an
// edited exchange leg previews its "Exchange to/from <counterpart>" label (or
// "Transfer to/from" for a same-currency pair or an untracked wallet) rather
// than a holding-name expense the list never shows. Only the polarity of
// the sign matters to that helper, so the current `mode` maps to a
// representative signed value (a negative for expense, non-negative
// otherwise). Falls back to a concrete example ("Coffee") when no holding has
// resolved yet, so there is nothing to preview — an example the user can type,
// not an echo of the field's own label. Kept module-level and pure so its
// branch stays out of the screen component's cognitive-complexity budget. Both
// `expense` and `split` are expenses (a split's payment is negative), so each
// maps to a negative representative value; only a plain income maps to
// non-negative. Only an EDITED row carries the exchange marker — a duplicate is
// written through `recordManual` without one, so its source's marker is not
// read here.
export const resolveDescriptionPlaceholder = (input: {
  holding: Pick<HoldingRow, 'id' | 'name'> | undefined;
  existing:
    | Pick<TransactionRow, 'exchangeCounterpartHoldingId' | 'untrackedCounterpart'>
    | undefined;
  holdings: readonly Pick<HoldingRow, 'id' | 'name' | 'currency'>[];
  mode: FormMode;
  t: TFunction;
}): string => {
  const { holding, existing, holdings, mode, t } = input;

  if (holding === undefined) {
    return t('forms.transaction.descriptionPlaceholder');
  }

  return transactionRowDescription({
    transaction: {
      holdingId: holding.id,
      description: '',
      amountMinorUnits: mode === 'expense' || mode === 'split' ? -1 : 0,
      exchangeCounterpartHoldingId: existing?.exchangeCounterpartHoldingId ?? null,
      untrackedCounterpart: existing?.untrackedCounterpart ?? null,
    },
    holdingName: holding.name,
    holdingNameById: buildHoldingNameById(holdings),
    holdingCurrencyById: buildHoldingCurrencyById(holdings),
    t,
  });
};

const buildHoldingNameById = (
  holdings: readonly Pick<HoldingRow, 'id' | 'name'>[],
): ReadonlyMap<string, string> =>
  new Map(holdings.map((candidate) => [candidate.id, candidate.name]));

const buildHoldingCurrencyById = (
  holdings: readonly Pick<HoldingRow, 'id' | 'currency'>[],
): ReadonlyMap<string, string> =>
  new Map(holdings.map((candidate) => [candidate.id, candidate.currency]));

// The text an edited row with a BLANK stored description opens with: the label
// the transaction lists show for it (an exchange leg's "Exchange to/from
// <counterpart>", "Transfer to/from <counterpart>" for a same-currency pair or
// an untracked wallet, else the holding-name default), so the field never reads
// empty while the list reads a label. Null when nothing is pre-filled — no
// edit, a description of the row's own, or a holding not yet resolved.
export const resolveBlankLabel = (input: {
  existing:
    | Pick<
        TransactionRow,
        | 'holdingId'
        | 'description'
        | 'amountMinorUnits'
        | 'exchangeCounterpartHoldingId'
        | 'untrackedCounterpart'
      >
    | undefined;
  holding: Pick<HoldingRow, 'name'> | undefined;
  holdings: readonly Pick<HoldingRow, 'id' | 'name' | 'currency'>[];
  t: TFunction;
}): string | null => {
  const { existing, holding } = input;

  if (existing === undefined || existing.description !== '' || holding === undefined) {
    return null;
  }

  return transactionRowDescription({
    transaction: existing,
    holdingName: holding.name,
    holdingNameById: buildHoldingNameById(input.holdings),
    holdingCurrencyById: buildHoldingCurrencyById(input.holdings),
    t: input.t,
  });
};

// An untouched pre-filled label saves as '' so the row keeps resolving its
// label at render time — a stored copy would stay in the language it was
// written in and go stale after a rename. Anything the user typed is stored.
export const storedDescription = (typed: string, prefilledLabel: string | null): string =>
  typed === prefilledLabel ? '' : typed;
