import type { Currency } from '../currency/currency';
import { Money } from '../currency/money';

type CurrencyHolding = {
  currency: Currency;
  balanceMinorUnits: number;
};

/**
 * Sums a list of holdings into one {@link Money} per distinct currency,
 * ordered by descending absolute minor-unit value. Empty input yields `[]`.
 */
export const sumByCurrency = (holdings: CurrencyHolding[]): Money[] => {
  const totals = new Map<Currency, number>();

  for (const { currency, balanceMinorUnits } of holdings) {
    totals.set(currency, (totals.get(currency) ?? 0) + balanceMinorUnits);
  }

  return Array.from(totals, ([currency, minorUnits]) => Money.of(currency, minorUnits)).sort(
    (a, b) => Math.abs(b.minorUnits) - Math.abs(a.minorUnits),
  );
};
