import type { TFunction } from 'i18next';
import type { TransactionRow } from '@kiko/db';

import { untrackedCounterpartName } from '../untracked-counterpart';
import { defaultTransactionDescription } from '../default-description';
import { exchangeLegDescription, transferLegDescription } from '../exchange-description';

/**
 * The label a transaction list row shows, resolved at RENDER time in four
 * ordered steps: a stored description wins; failing that, an Exchange/Convert
 * leg (structurally marked by `exchangeCounterpartHoldingId` — see
 * `src/db/schema.ts`) reads as "Exchange to/from <counterpart>", or as
 * "Transfer to/from <counterpart>" when both holdings are in one currency;
 * failing that, a move to a wallet Kiko does not track
 * (`untrackedCounterpart`) reads as "Transfer to/from <product name>"; failing
 * that, the row falls back to its own holding's income/expense default (an
 * unknown code lands here too, never as a raw code).
 *
 * Shared by Home and Holding detail so both lists resolve the same row
 * identically — inlining the two-step `description || default` fallback
 * separately in each screen risks the two drifting, with only one of them
 * ever learning about exchange legs.
 *
 * `holdingNameById` maps a holding id to its CURRENT name and
 * `holdingCurrencyById` to its currency (both built from the holdings live query
 * the screens already run), so a rename flows through with no write. A marker
 * pointing at a deleted holding still reads as an exchange, with an empty name,
 * rather than being mislabeled as spending; a currency that is unknown on either
 * side keeps the exchange wording.
 */
export const transactionRowDescription = (input: {
  transaction: Pick<
    TransactionRow,
    | 'holdingId'
    | 'description'
    | 'amountMinorUnits'
    | 'exchangeCounterpartHoldingId'
    | 'untrackedCounterpart'
  >;
  holdingName: string;
  holdingNameById: ReadonlyMap<string, string>;
  holdingCurrencyById: ReadonlyMap<string, string>;
  t: TFunction;
}): string => {
  const {
    holdingId,
    description,
    amountMinorUnits,
    exchangeCounterpartHoldingId,
    untrackedCounterpart,
  } = input.transaction;

  if (description) {
    return description;
  }

  if (exchangeCounterpartHoldingId !== null) {
    const ownCurrency = input.holdingCurrencyById.get(holdingId);

    return exchangeLegDescription({
      counterpartName: input.holdingNameById.get(exchangeCounterpartHoldingId) ?? '',
      amountMinorUnits,
      sameCurrency:
        ownCurrency !== undefined &&
        ownCurrency === input.holdingCurrencyById.get(exchangeCounterpartHoldingId),
      t: input.t,
    });
  }

  const walletName = untrackedCounterpartName(untrackedCounterpart);

  if (walletName !== undefined) {
    return transferLegDescription({ counterpartName: walletName, amountMinorUnits, t: input.t });
  }

  return defaultTransactionDescription(input.holdingName, amountMinorUnits, input.t);
};
