import type { TFunction } from 'i18next';

import type { TransactionRow } from '../../db/schema';

import { defaultTransactionDescription } from '../default-description';
import { exchangeLegDescription } from '../exchange-description';

/**
 * The label a transaction list row shows, resolved at RENDER time in three
 * ordered steps: a stored description wins; failing that, an Exchange/Convert
 * leg (structurally marked by `exchangeCounterpartHoldingId` — see
 * `src/db/schema.ts`) reads as "Exchange to/from <counterpart>"; failing that,
 * the row falls back to its own holding's income/expense default.
 *
 * Shared by Home and Holding detail so both lists resolve the same row
 * identically — the two used to each inline the two-step `description ||
 * default` fallback, and only one of them would have learned about exchange
 * legs.
 *
 * `holdingNameById` maps a holding id to its CURRENT name (built from the
 * holdings live query both screens already run), so a rename flows through
 * with no write. A marker pointing at a deleted holding still reads as an
 * exchange, with an empty name, rather than being mislabeled as spending.
 */
export const transactionRowDescription = (input: {
  transaction: Pick<
    TransactionRow,
    'description' | 'amountMinorUnits' | 'exchangeCounterpartHoldingId'
  >;
  holdingName: string;
  holdingNameById: ReadonlyMap<string, string>;
  t: TFunction;
}): string => {
  const { description, amountMinorUnits, exchangeCounterpartHoldingId } = input.transaction;

  if (description) {
    return description;
  }

  if (exchangeCounterpartHoldingId !== null) {
    return exchangeLegDescription({
      counterpartName: input.holdingNameById.get(exchangeCounterpartHoldingId) ?? '',
      amountMinorUnits,
      t: input.t,
    });
  }

  return defaultTransactionDescription(input.holdingName, amountMinorUnits, input.t);
};
