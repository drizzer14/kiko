import type { Money } from '@kiko/currency/money';

export type AccountTotalProps = {
  // The account's total in its own currency.
  total: Money;
  // The base-currency figure for the caption, or `null` when the account is in the base
  // currency or has no rate to it.
  inBase: Money | null;
  convertedTestID: string;
};
