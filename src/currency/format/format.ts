import type { Money } from '../money';
import { applySymbolPlacement, currencyScale, isCrypto } from '../currency';

const MINIMUM_CRYPTO_FRACTION_DIGITS = 2;

const decimalSeparatorOf = (locale: string): string =>
  (1.5).toLocaleString(locale, { minimumFractionDigits: 1 }).replace(/\p{Nd}/gu, '');

// The whole and fraction digits come from integer division of the stored minor units, so every
// stored digit survives; dividing by the scale would round it through a float above
// 2^53 / 10^scale. The fraction keeps its trailing zeros, and is empty at scale 0.
export const splitMinorUnits = (
  minorUnits: number,
  scale: number,
): { whole: number; fraction: string } => {
  // A stored real (a seeded bond value) must still split into whole digits, not "12.5" padded.
  const absolute = Math.round(Math.abs(minorUnits));
  const remainder = absolute % 10 ** scale;

  return {
    whole: (absolute - remainder) / 10 ** scale,
    fraction: scale === 0 ? '' : String(remainder).padStart(scale, '0'),
  };
};

const formatCryptoBody = (minorUnits: number, scale: number, locale: string): string => {
  const { whole, fraction } = splitMinorUnits(minorUnits, scale);
  const paddedFraction = fraction
    .replace(/0+$/, '')
    .padEnd(Math.min(MINIMUM_CRYPTO_FRACTION_DIGITS, scale), '0');
  const wholeText = whole.toLocaleString(locale, { maximumFractionDigits: 0 });

  return `${wholeText}${decimalSeparatorOf(locale)}${paddedFraction}`;
};

const formatFiatBody = (minorUnits: number, scale: number, locale: string): string =>
  (Math.abs(minorUnits) / 10 ** scale).toLocaleString(locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });

// True when `formatMoney` prints this amount as a zero ("0.00", "-0.00", "₿0.00"): the same
// integer rounding of the stored minor units that the body formatters apply, so a hide-zero
// filter never disagrees with what the row would show.
export const displaysAsZero = (money: Money): boolean => {
  const { whole, fraction } = splitMinorUnits(money.minorUnits, currencyScale[money.currency]);

  return whole === 0 && /^0*$/.test(fraction);
};

export const formatMoney = (money: Money, locale = 'en-US'): string => {
  const scale = currencyScale[money.currency];
  const formatted = isCrypto(money.currency)
    ? formatCryptoBody(money.minorUnits, scale, locale)
    : formatFiatBody(money.minorUnits, scale, locale);
  const sign = money.minorUnits < 0 ? '-' : '';

  return applySymbolPlacement(money.currency, sign, formatted);
};
