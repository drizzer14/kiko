import type { Currency } from '@kiko/currency/currency';
import { currencyFromCode } from '@kiko/monobank/currency-code';

const ISO_NUMERIC_CODE_COUNT = 1000;

const isCodedCurrency = (
  entry: readonly [Currency | undefined, number],
): entry is [Currency, number] => entry[0] !== undefined;

// Built once at module load: a Monobank feed asks for every fiat, and a scan of all
// three-digit codes per call made each feed build take hundreds of milliseconds.
const CODE_BY_CURRENCY = new Map<Currency, number>(
  Array.from(
    { length: ISO_NUMERIC_CODE_COUNT },
    (_unused, code): [Currency | undefined, number] => [currencyFromCode(code), code],
  ).filter(isCodedCurrency),
);

/**
 * The ISO 4217 numeric code of `currency`, found by asking `currencyFromCode` for every
 * three-digit code. Only tests build a Monobank feed from currencies, so production keeps
 * one table (`currencyFromCode`) instead of a second one for the reverse direction.
 */
export const codeFromCurrency = (currency: Currency): number | undefined =>
  CODE_BY_CURRENCY.get(currency);
