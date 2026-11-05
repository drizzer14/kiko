import { identity } from 'fnts';
import { logFailure } from '@kiko/diagnostics';
import { curatedCoins } from '@kiko/currency/coins';
import { bifold, bifoldMap, type Either, isLeft } from 'fnts/either';
import { type Currency, currencyScale, isCrypto } from '@kiko/currency/currency';
import { type DecimalAmountError, decimalToMinorUnits } from '@kiko/currency/decimal';

export type AmountError = DecimalAmountError;

/**
 * A balance rounds past the scale; a row is refused there, unless its coin is stored reduced. A
 * trade row is a row that also rounds a fiat coin: Binance quotes a fiat pair at more decimals
 * than the fiat is stored at (a BTCEUR quote amount runs to 7), so the order's one summed amount
 * is rounded, never refused.
 */
export type AmountUse = 'balance' | 'row' | 'trade-row';

// Fixed text, never the amount: a log line stays on the device and a balance is the user's data.
const ROUNDED_TAG: Record<AmountUse, string> = {
  balance: 'balance-precision-rounded',
  row: 'row-precision-rounded',
  'trade-row': 'row-precision-rounded',
};

const isReducedScale = (currency: Currency): boolean =>
  isCrypto(currency) && curatedCoins[currency].reducedScale;

const mayRound = (currency: Currency, use: AmountUse): boolean =>
  use === 'balance' || isReducedScale(currency) || (use === 'trade-row' && !isCrypto(currency));

/**
 * An exchange's decimal text as integer minor units of `currency`, exact. Digits past the scale
 * are the only thing that differs by use (see `AmountUse`): an exponent form is malformed and a
 * result beyond the safe integer is too large, for both. Only a value that did round is logged.
 */
export const exchangeMinorUnits = (
  currency: Currency,
  text: string,
  use: AmountUse,
): Either<AmountError, number> => {
  const scale = currencyScale[currency];
  const exact = decimalToMinorUnits(text, scale, 'exact');

  if (!isLeft(exact) || bifold(exact) !== 'amount-precision' || !mayRound(currency, use)) {
    return exact;
  }

  const rounded = decimalToMinorUnits(text, scale, 'half-away-from-zero');

  if (!isLeft(rounded)) {
    logFailure(ROUNDED_TAG[use], new Error(ROUNDED_TAG[use]));
  }

  return rounded;
};

/** The least balance that creates a holding: a coin's dust threshold, any non-zero fiat balance. */
export const appearMinorUnitsOf = (currency: Currency): number =>
  isCrypto(currency)
    ? bifoldMap(
        exchangeMinorUnits(currency, curatedCoins[currency].dustBelow, 'balance'),
        () => 1,
        identity,
      )
    : 1;
