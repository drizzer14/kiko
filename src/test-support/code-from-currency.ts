import type { Currency } from '@kiko/currency/currency';
import { currencyFromCode } from '@kiko/monobank/currency-code';

const ISO_NUMERIC_CODE_COUNT = 1000;

const ISO_NUMERIC_CODES = Array.from({ length: ISO_NUMERIC_CODE_COUNT }, (_unused, code) => code);

/**
 * The ISO 4217 numeric code of `currency`, found by asking `currencyFromCode` for every
 * three-digit code. Only tests build a Monobank feed from currencies, so production keeps
 * one table (`currencyFromCode`) instead of a second one for the reverse direction.
 */
export const codeFromCurrency = (currency: Currency): number | undefined =>
  ISO_NUMERIC_CODES.find((code) => currencyFromCode(code) === currency);
