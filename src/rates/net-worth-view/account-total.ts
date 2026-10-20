import type { Money } from '@kiko/currency/money';
import type { Currency } from '@kiko/currency/currency';
import { EMPTY_PRICE_BOOK, type PriceBook } from '@kiko/prices/price-book';

import type { RateTable } from '../conversion';

import { canConvert, type ConvertibleHolding, guardedNetWorth } from './net-worth-view';

/**
 * An account's total in the account's own currency, and the base-currency figure the card
 * shows beside it.
 *
 * `inBase` is `guardedNetWorth` in the base currency, not a second conversion of `total`: it
 * is the same figure the Home total sums for these holdings, with no double rounding through
 * the UAH pivot. It is `null` when the account is in the base currency or has no rate to it
 * (a crypto account before its first price), so a caption never needs a rate that is missing.
 */
export const accountTotal = (
  holdings: ConvertibleHolding[],
  accountCurrency: Currency,
  baseCurrency: Currency,
  rates: RateTable,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): { total: Money; inBase: Money | null } => ({
  total: guardedNetWorth(holdings, accountCurrency, rates, now, book),
  inBase:
    accountCurrency !== baseCurrency && canConvert(accountCurrency, baseCurrency, rates)
      ? guardedNetWorth(holdings, baseCurrency, rates, now, book)
      : null,
});
