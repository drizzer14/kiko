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

// Rounds in integers, half away from zero, before `Intl` sees the value: an engine's own rounding
// mode (half to even on some) must not decide the last digit. The remainder is exact; a float
// quotient near a tie is not.
const roundedToDigits = (absolute: number, scale: number, fractionDigits: number): number => {
  if (fractionDigits >= scale) {
    return absolute / 10 ** scale;
  }

  const divisor = 10 ** (scale - fractionDigits);
  const remainder = absolute % divisor;
  const kept = (absolute - remainder) / divisor;

  return (remainder * 2 >= divisor ? kept + 1 : kept) / 10 ** fractionDigits;
};

const formatFiatBody = (
  minorUnits: number,
  scale: number,
  locale: string,
  fractionDigits = scale,
): string =>
  roundedToDigits(Math.abs(minorUnits), scale, fractionDigits).toLocaleString(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

// Half rounds away from zero, as `roundedToDigits` does, so an amount below half a unit of the last
// shown digit shows as zero. The comparison stays in integers: no float step decides the edge.
const roundsToZero = (minorUnits: number, scale: number, fractionDigits: number): boolean =>
  Math.abs(minorUnits) * 10 ** fractionDigits * 2 < 10 ** scale;

type FormatMoneyOptions = {
  /** Round to this many decimals, for a currency of any scale (a crypto one included). */
  fractionDigits?: number;
  /** False writes the number alone; the sign still leads. */
  symbol?: boolean;
};

export const formatMoney = (
  money: Money,
  locale = 'en-US',
  options: FormatMoneyOptions = {},
): string => {
  const { fractionDigits, symbol = true } = options;
  const scale = currencyScale[money.currency];
  const formatted =
    isCrypto(money.currency) && fractionDigits === undefined
      ? formatCryptoBody(money.minorUnits, scale, locale)
      : formatFiatBody(money.minorUnits, scale, locale, fractionDigits);
  const isRoundedZero =
    fractionDigits !== undefined && roundsToZero(money.minorUnits, scale, fractionDigits);
  const sign = money.minorUnits < 0 && !isRoundedZero ? '-' : '';

  return symbol ? applySymbolPlacement(money.currency, sign, formatted) : `${sign}${formatted}`;
};
