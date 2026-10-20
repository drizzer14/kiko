import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';

/**
 * The label for a movement between two wallets of one currency, resolved at
 * RENDER time. Direction comes from the amount's sign, as in
 * `exchangeLegDescription`. The name is a holding's CURRENT name, or the product
 * name of a wallet Kiko does not track.
 */
export const transferLegDescription = (input: {
  counterpartName: string;
  amountMinorUnits: number;
  t: TFunction;
}): string => {
  const key = input.amountMinorUnits < 0 ? 'transactions.transferTo' : 'transactions.transferFrom';

  return input.t(key, { name: input.counterpartName });
};

/**
 * The label for an Exchange/Convert leg, resolved at RENDER time. Direction
 * comes from the amount's sign — a negative leg paid money OUT to the
 * counterpart ("Exchange to X"), a positive one received it ("Exchange from
 * X") — the same sign-as-source-of-truth rule
 * `defaultTransactionDescription` uses. The name comes from the counterpart
 * holding's CURRENT row, looked up by the stored
 * `exchangeCounterpartHoldingId`, so a rename flows through with no write.
 *
 * Two holdings of ONE currency make the movement a transfer, not an exchange
 * (nothing was converted), so `sameCurrency` switches the wording to "Transfer
 * to/from X". The rule is about the currencies alone, so it covers a leg the user
 * recorded by hand as well as a synced one.
 *
 * Nothing is persisted: a stored literal `Exchange to <name>` sentence would
 * stay in whichever language was active when it was written, and go stale
 * after a rename.
 */
export const exchangeLegDescription = (input: {
  counterpartName: string;
  amountMinorUnits: number;
  sameCurrency: boolean;
  t: TFunction;
}): string => {
  if (input.sameCurrency) {
    return transferLegDescription(input);
  }

  const key = input.amountMinorUnits < 0 ? 'transactions.exchangeTo' : 'transactions.exchangeFrom';

  return input.t(key, { name: input.counterpartName });
};

/**
 * The label for a row whose counterpart is a P2P, card or bank code, resolved at RENDER time.
 * A P2P purchase reads the same for either sign; a card or bank row reads by the sign of the
 * amount (`< 0` is the outgoing wording, zero the incoming one), as its neighbours do. The
 * currency is the code's own fiat, kept as stored.
 */
export const fiatCounterpartDescription = (input: {
  kind: 'p2p' | 'card' | 'bank';
  fiat: string;
  amountMinorUnits: number;
  t: TFunction;
}): string => {
  const isOutgoing = input.amountMinorUnits < 0;
  const key = match(input.kind)
    .with('p2p', () => 'transactions.p2pPurchase' as const)
    .with('card', () => (isOutgoing ? 'transactions.cardSale' : 'transactions.cardPurchase'))
    .with('bank', () => (isOutgoing ? 'transactions.bankWithdrawal' : 'transactions.bankDeposit'))
    .exhaustive();

  return input.t(key, { currency: input.fiat });
};
