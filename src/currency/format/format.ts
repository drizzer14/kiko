import type { Money } from '../money';
import { applySymbolPlacement, currencyScale, isCrypto } from '../currency';

const MINIMUM_CRYPTO_FRACTION_DIGITS = 2;

const decimalSeparatorOf = (locale: string): string =>
  (1.5).toLocaleString(locale, { minimumFractionDigits: 1 }).replace(/\p{Nd}/gu, '');

// The whole and fraction digits come from integer division of the stored minor units, so a crypto
// amount prints every stored digit; dividing by the scale would round it through a float.
const formatCryptoBody = (minorUnits: number, scale: number, locale: string): string => {
  const absolute = Math.abs(minorUnits);
  const remainder = absolute % 10 ** scale;
  const whole = (absolute - remainder) / 10 ** scale;
  const fraction = String(remainder)
    .padStart(scale, '0')
    .replace(/0+$/, '')
    .padEnd(Math.min(MINIMUM_CRYPTO_FRACTION_DIGITS, scale), '0');
  const wholeText = whole.toLocaleString(locale, { maximumFractionDigits: 0 });

  return `${wholeText}${decimalSeparatorOf(locale)}${fraction}`;
};

const formatFiatBody = (minorUnits: number, scale: number, locale: string): string =>
  (Math.abs(minorUnits) / 10 ** scale).toLocaleString(locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });

export const formatMoney = (money: Money, locale = 'en-US'): string => {
  const scale = currencyScale[money.currency];
  const formatted = isCrypto(money.currency)
    ? formatCryptoBody(money.minorUnits, scale, locale)
    : formatFiatBody(money.minorUnits, scale, locale);
  const sign = money.minorUnits < 0 ? '-' : '';

  return applySymbolPlacement(money.currency, sign, formatted);
};
