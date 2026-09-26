import { Money } from '../../currency/money';
import { type Currency, currencyScale } from '../../currency/currency';
import { EMPTY_PRICE_BOOK, type PriceBook } from '../../prices/price-book';
import { holdingValue, type ValuableHolding } from '../../holdings/holding-value';

/**
 * A currency's price in ONE UAH — `rate(X, UAH)` — the single pivot every
 * A->B conversion resolves through at read time (`rateBetween`). `UAH`
 * itself is NEVER a key: its own price is implicitly `1`.
 */
export type RateTable = Partial<Record<Currency, number>>;

/** A single normalized rate from a provider, before it is stored or tabulated. */
export type RateEntry = {
  base: Currency;
  quote: Currency;
  rate: number;
  source: 'monobank' | 'coingecko' | 'nbu';
};

/** A single stored-or-composed cross rate, before it is tabulated into a `RateTable`. */
type RateRow = { base: Currency; quote: Currency; rate: string };

/**
 * Parses a list of string-rate rows into a numeric `RateTable`, keeping only
 * a row that is actually an `X:UAH` star row (`quote === 'UAH'`, `base !==
 * 'UAH'`) and whose rate parses to a finite, positive number. A stray cross
 * row (a legacy `X:Y` pair, or `UAH` itself as `base`) is ignored, never
 * read — `UAH`'s own price is implicit `1`. A rate of "0" (a bad provider
 * tick) is treated the same as a missing rate — admitting it would let
 * `canConvert` treat it as present while converting a holding to a false
 * zero. Shared by `buildRateTable` (live DB rows) and the fiat rate seed
 * (`fiat-rate-seed.ts`, composed from a static snapshot), so both build
 * their `RateTable` through the identical rule.
 */
export const rateTableFromRows = (rows: RateRow[]): RateTable => {
  const table: RateTable = {};

  for (const row of rows) {
    if (row.quote !== 'UAH' || row.base === 'UAH') {
      continue;
    }
    const rate = Number(row.rate);
    if (Number.isFinite(rate) && rate > 0) {
      table[row.base] = rate;
    }
  }
  return table;
};

/** A currency's UAH price, `1` for `UAH` itself (never a stored key). */
const uahPer = (rates: RateTable, currency: Currency): number | undefined =>
  currency === 'UAH' ? 1 : rates[currency];

/**
 * `rate(A, B)` resolved through the UAH pivot: `uahPer(A) / uahPer(B)`. The
 * same currency always resolves to `1`, even with no stored price at all.
 * Otherwise `undefined` unless BOTH legs resolve to a finite, positive UAH
 * price — a missing, zero, or `NaN` leg on either side must never convert a
 * holding to a false value.
 */
export const rateBetween = (rates: RateTable, from: Currency, to: Currency): number | undefined => {
  if (from === to) {
    return 1;
  }
  const fromPrice = uahPer(rates, from);
  const toPrice = uahPer(rates, to);
  if (
    fromPrice === undefined ||
    toPrice === undefined ||
    !Number.isFinite(fromPrice) ||
    !Number.isFinite(toPrice) ||
    fromPrice <= 0 ||
    toPrice <= 0
  ) {
    return undefined;
  }
  return fromPrice / toPrice;
};

export const convert = (money: Money, target: Currency, rates: RateTable): Money => {
  if (money.currency === target) {
    return money;
  }
  const rate = rateBetween(rates, money.currency, target);
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
