import {
  compareDecimal,
  multiplyToDecimal,
  normalizeDecimal,
  trimDecimal,
} from '@kiko/currency/decimal';
import maybe, { foldMap } from 'fnts/maybe';

// A share trades below one minor unit (a penny stock) and is quoted past the
// currency's own places, so its price keeps far more places than money does.
// Enough that quantity × price rounds back to a typed total cost for any
// realistic quantity, so a share never shows a gain or loss it never had.
export const SHARE_PRICE_SCALE = 8;

/**
 * A typed price per share as a decimal string, rounded to
 * `SHARE_PRICE_SCALE` places with trailing zeros dropped. Undefined when the
 * input is not a plain decimal, or when it is not above 0 at that scale.
 */
export const sharePriceOf = (input: string): string | undefined => {
  const price = foldMap(maybe(normalizeDecimal(input)), (normalized) =>
    trimDecimal(multiplyToDecimal([normalized], SHARE_PRICE_SCALE)),
  );

  if (price === undefined || compareDecimal(price, '0') <= 0) {
    return undefined;
  }

  return price;
};
