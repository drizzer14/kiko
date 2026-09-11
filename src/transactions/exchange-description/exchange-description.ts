import type { TFunction } from 'i18next';

/**
 * The label for an Exchange/Convert leg, resolved at RENDER time. Direction
 * comes from the amount's sign — a negative leg paid money OUT to the
 * counterpart ("Exchange to X"), a positive one received it ("Exchange from
 * X") — the same sign-as-source-of-truth rule
 * `defaultTransactionDescription` uses. The name comes from the counterpart
 * holding's CURRENT row, looked up by the stored
 * `exchangeCounterpartHoldingId`, so a rename flows through with no write.
 *
 * Nothing is persisted: the repo used to store a literal English
 * `Exchange to <name>` sentence, which stayed English after a language switch
 * and went stale after a rename.
 */
export const exchangeLegDescription = (input: {
  counterpartName: string;
  amountMinorUnits: number;
  t: TFunction;
}): string => {
  const key = input.amountMinorUnits < 0 ? 'transactions.exchangeTo' : 'transactions.exchangeFrom';

  return input.t(key, { name: input.counterpartName });
};
