import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { parseAmount } from '@kiko/currency/parse';
import type { Currency } from '@kiko/currency/currency';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';
import type { TemplateDraft } from '@kiko/transaction-templates/draft';

import { toTemplateMode } from '../hydration';
import { type ChangeReturnRow, storedDescription } from '../row-labels';

type FormState = {
  mode: FormMode;
  primaryHoldingId: string | null;
  // The picked holding's currency, null while no holding is. It sets the scale every amount is
  // stored in, so an amount typed before a holding is picked is not stored.
  currency: Currency | null;
  amount: string;
  description: string;
  prefilledLabel: string | null;
  selectedCategory: string | null;
  destinationHoldingId: string | null;
  destinationCurrency: Currency | null;
  valueIn: string;
  changeReturns: readonly ChangeReturnRow[];
};

// A blank, unreadable or non-positive amount is stored as null: a template keeps every amount
// optional, and a stored amount is always one a transaction could be written with.
const minorUnitsOrNull = (currency: Currency | null, text: string): number | null => {
  const major = parseAmount(text);

  if (currency === null || !(major > 0)) {
    return null;
  }

  const minorUnits = Money.fromMajor(currency, major).minorUnits;

  return minorUnits > 0 ? minorUnits : null;
};

// Builds the draft a template saves from the form, by the same rules a transaction saves by: the
// description a blank pre-filled label stores, and exact minor units in the holding's own scale.
// The category key is stored lowercase because the delete-time clear matches the lowercase key. An
// exchange has no category or description, and only a split has returns. There is no loan and no
// comment: neither is part of a template.
export const draftFromForm = (state: FormState): TemplateDraft => {
  const { mode, currency } = state;
  const isExchange = mode === 'exchange';

  return {
    version: 1,
    mode: toTemplateMode(mode),
    holdingId: state.primaryHoldingId,
    currency,
    amountMinorUnits: minorUnitsOrNull(currency, state.amount),
    description: isExchange ? '' : storedDescription(state.description, state.prefilledLabel),
    category: isExchange
      ? null
      : (foldMap(maybe(state.selectedCategory), (category) => category.toLowerCase()) ?? null),
    exchange: isExchange
      ? {
          destinationHoldingId: state.destinationHoldingId,
          destinationCurrency: state.destinationCurrency,
          valueInMinorUnits: minorUnitsOrNull(state.destinationCurrency, state.valueIn),
        }
      : null,
    returns:
      mode === 'split'
        ? state.changeReturns
            .map((change) => ({
              holdingId: change.holdingId,
              amountMinorUnits: minorUnitsOrNull(currency, change.amount),
            }))
            .filter((change) => change.holdingId !== null || change.amountMinorUnits !== null)
        : [],
  };
};
