import { Money } from '@kiko/currency/money';
import type { Currency } from '@kiko/currency/currency';
import { convert, type RateTable, rateBetween } from '@kiko/rates/conversion';

// Seed the Convert flow's counterpart amount: the cash leg's amount
// in ITS OWN minor units, from the withdrawal magnitude and the latest cached
// rate. Same currency → 1:1. A missing cross-rate → null, so the form leaves the
// field BLANK and editable rather than crashing (convert throws on a missing
// pair). The bank withdrawal row is never touched by this — it is pure math.
export const seedCounterpartMinorUnits = (input: {
  sourceAmountMinorUnits: number;
  sourceCurrency: Currency;
  counterpartCurrency: Currency;
  rateTable: RateTable;
}): number | null => {
  const { sourceAmountMinorUnits, sourceCurrency, counterpartCurrency, rateTable } = input;
  const magnitude = Math.abs(sourceAmountMinorUnits);

  if (sourceCurrency === counterpartCurrency) {
    return magnitude;
  }

  if (rateBetween(rateTable, sourceCurrency, counterpartCurrency) === undefined) {
    return null;
  }

  return convert(Money.of(sourceCurrency, magnitude), counterpartCurrency, rateTable).minorUnits;
};
