import {
  scaleMinorUnits,
  multiplyToMinorUnits,
  decimalFromJsonNumber,
} from '@kiko/currency/decimal';
import { parseAmount } from '@kiko/currency/parse';
import type { Currency } from '@kiko/currency/currency';
import { groupAmount, majorAmountText } from '@kiko/screens/forms/amount-format';

/** The price fields as the edit form seeded them, and the stored total behind them. */
export type SeededPurchasePrice = {
  quantity: string;
  pricePerBond: string;
  totalMinorUnits: number;
};

type BondPurchaseTotalParams = {
  quantity: string;
  pricePerBond: string;
  currency: Currency;
  seeded: SeededPurchasePrice | null;
};

// The validation reads the price and the quantity through `parseAmount`, so
// the total reads them the same way: "1 076," is 1 076, as in every other
// amount field, not an unreadable price that Save would silently leave out. A
// typed amount has far fewer than 15 significant digits, so its double
// converts back to the same decimal exactly.
const typedDecimal = (text: string): string | null => decimalFromJsonNumber(parseAmount(text));

/**
 * The batch total a bond stores for the price the form takes per bond:
 * quantity x price, exact. None for a blank, zero or unreadable price or
 * quantity. While both fields still show what the edit form seeded, the
 * stored total stays as it is: the seeded price per bond is rounded to the
 * minor unit, so recomputing would change a total that does not divide by
 * the quantity.
 */
export const bondPurchaseTotal = ({
  quantity,
  pricePerBond,
  currency,
  seeded,
}: BondPurchaseTotalParams): number | undefined => {
  if (seeded !== null && seeded.quantity === quantity && seeded.pricePerBond === pricePerBond) {
    return seeded.totalMinorUnits;
  }

  const quantityDecimal = typedDecimal(quantity);
  const priceDecimal = typedDecimal(pricePerBond);

  if (quantityDecimal === null || priceDecimal === null) {
    return undefined;
  }

  const totalMinorUnits = multiplyToMinorUnits([quantityDecimal, priceDecimal], currency);

  return totalMinorUnits > 0 ? totalMinorUnits : undefined;
};

/**
 * The price of one bond the edit form shows for a stored batch total. None
 * for a quantity that is not a whole, positive number of bonds, which the
 * exact division cannot take.
 */
export const pricePerBondText = (
  totalMinorUnits: number,
  quantity: number,
  currency: Currency,
): string =>
  Number.isInteger(quantity) && quantity > 0
    ? groupAmount(majorAmountText(currency, scaleMinorUnits(totalMinorUnits, 1, quantity)))
    : '';
