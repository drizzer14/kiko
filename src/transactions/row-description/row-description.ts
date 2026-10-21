import { match, P } from 'ts-pattern';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import type { TransactionRow } from '@kiko/db';

import {
  exchangeLegDescription,
  fiatCounterpartDescription,
  transferLegDescription,
} from '../exchange-description';
import { parseUntrackedCounterpart } from '../untracked-counterpart';
import { defaultTransactionDescription } from '../default-description';

// The label of a row whose counterpart is a stored code; undefined for a code this build does
// not know, so the row falls back to its default label instead of a raw code.
const codeCounterpartDescription = (
  untrackedCounterpart: string | null,
  amountMinorUnits: number,
  t: TFunction,
): string | undefined => {
  return foldMap(maybe(parseUntrackedCounterpart(untrackedCounterpart)), (counterpart) =>
    match(counterpart)
      .with({ kind: 'wallet' }, ({ name }) =>
        transferLegDescription({ counterpartName: name, amountMinorUnits, t }),
      )
      .with({ kind: 'asset' }, ({ code }) =>
        exchangeLegDescription({ counterpartName: code, amountMinorUnits, sameCurrency: false, t }),
      )
      .with({ kind: P.union('p2p', 'card', 'bank') }, ({ kind, fiat }) =>
        fiatCounterpartDescription({ kind, fiat, amountMinorUnits, t }),
      )
      .exhaustive(),
  );
};

/**
 * The label a transaction list row shows, resolved at RENDER time in five
 * ordered steps: a stored description wins; failing that, a trading fee
 * (`operation`) reads "Trading fee"; failing that, an Exchange/Convert leg
 * (structurally marked by `exchangeCounterpartHoldingId` — see
 * `src/db/schema.ts`) reads as "Exchange to/from <counterpart>", or as
 * "Transfer to/from <counterpart>" when both holdings are in one currency;
 * failing that, a stored counterpart code (`untrackedCounterpart`) reads by its
 * kind: a wallet Kiko does not track is "Transfer to/from <product name>", an
 * asset is "Exchange to/from <coin>", and a P2P, card or bank code names its
 * fiat; failing that, the row falls back to its own holding's income/expense
 * default (an unknown code lands here too, never as a raw code).
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
    | 'operation'
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
    operation,
  } = input.transaction;

  if (description) {
    return description;
  }

  if (operation === 'trade-fee') {
    return input.t('transactions.tradingFee');
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

  return (
    codeCounterpartDescription(untrackedCounterpart, amountMinorUnits, input.t) ??
    defaultTransactionDescription(input.holdingName, amountMinorUnits, input.t)
  );
};
