import type { Currency } from '@kiko/currency/currency';
import { multiplyToMinorUnits, normalizeDecimal } from '@kiko/currency/decimal';
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

  const quantityDecimal = normalizeDecimal(quantity);
  const priceDecimal = normalizeDecimal(pricePerBond);

  if (quantityDecimal === null || priceDecimal === null) {
    return undefined;
  }

  const totalMinorUnits = multiplyToMinorUnits([quantityDecimal, priceDecimal], currency);

  return totalMinorUnits > 0 ? totalMinorUnits : undefined;
};

/** The price of one bond the edit form shows for a stored batch total. */
export const pricePerBondText = (
  totalMinorUnits: number,
  quantity: number,
  currency: Currency,
): string => {
  if (quantity <= 0) {
    return '';
  }

  const perBondMinorUnits = multiplyToMinorUnits(
    [majorAmountText(currency, totalMinorUnits)],
    currency,
    String(quantity),
  );

  return groupAmount(majorAmountText(currency, perBondMinorUnits));
};
