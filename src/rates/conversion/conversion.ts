import { Money } from '../../currency/money';
import { type Currency, currencyScale } from '../../currency/currency';
import { holdingValue, type ValuableHolding } from '../../holdings/holding-value';
import { EMPTY_PRICE_BOOK, type PriceBook } from '../../prices/price-book';

/** A rate table keyed `${base}:${quote}` mapping to a major-unit rate. */
export type RateTable = Record<string, number>;

/** A single normalized rate from a provider, before it is stored or tabulated. */
export type RateEntry = {
  base: Currency;
  quote: Currency;
  rate: number;
  source: 'monobank' | 'coingecko' | 'nbu';
};

const rateKey = (base: Currency, quote: Currency) => `${base}:${quote}`;

/** A single stored-or-composed cross rate, before it is tabulated into a `RateTable`. */
type RateRow = { base: Currency; quote: Currency; rate: string };

/**
 * Parses a list of string-rate rows into a numeric `RateTable`, dropping any
 * row whose rate does not parse to a finite, positive number. A rate of "0"
 * (a bad provider tick) is treated the same as a missing rate — admitting it
 * would let `canConvert` treat it as present while converting a holding to a
 * false zero. Shared by `buildRateTable` (live DB rows) and the fiat rate
 * seed (`fiat-rate-seed.ts`, composed from a static snapshot), so both build
 * their `RateTable` through the identical rule.
 */
export const rateTableFromRows = (rows: RateRow[]): RateTable => {
  const table: RateTable = {};

  for (const row of rows) {
    const rate = Number(row.rate);
    if (Number.isFinite(rate) && rate > 0) {
      table[rateKey(row.base, row.quote)] = rate;
    }
  }
  return table;
};

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
  holdings: ValuableHolding[],
  base: Currency,
  rates: RateTable,
  now: number,
  book: PriceBook = EMPTY_PRICE_BOOK,
): Money =>
  holdings.reduce(
    (sum, holding) => sum.add(convert(holdingValue(holding, now, book), base, rates)),
    Money.of(base, 0),
  );
