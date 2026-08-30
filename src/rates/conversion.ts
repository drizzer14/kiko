import { type Currency, currencyScale } from '../currency/currency';
import { Money } from '../currency/money';

/** A rate table keyed `${base}:${quote}` mapping to a major-unit rate. */
export type RateTable = Record<string, number>;

/** A single normalized rate from a provider, before it is stored or tabulated. */
export type RateEntry = {
  base: Currency;
  quote: Currency;
  rate: number;
  source: 'monobank' | 'coingecko';
};

const rateKey = (base: Currency, quote: Currency) => `${base}:${quote}`;

export const convert = (money: Money, target: Currency, rates: RateTable): Money => {
  if (money.currency === target) {
    return money;
  }
  const rate = rates[rateKey(money.currency, target)];
  if (rate === undefined) {
    throw new Error(`Missing rate ${money.currency}->${target}`);
  }
  const sourceMajor = money.minorUnits / 10 ** currencyScale[money.currency];
  return Money.fromMajor(target, sourceMajor * rate);
};

export const netWorth = (
  holdings: { currency: Currency; balanceMinorUnits: number }[],
  base: Currency,
  rates: RateTable,
): Money =>
  holdings.reduce(
    (sum, holding) =>
      sum.add(convert(Money.of(holding.currency, holding.balanceMinorUnits), base, rates)),
    Money.of(base, 0),
  );
