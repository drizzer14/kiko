import { currencyScale, currencySymbol } from './currency';
import type { Money } from './money';

export const formatMoney = (money: Money, locale = 'en-US'): string => {
  const scale = currencyScale[money.currency];
  const major = Math.abs(money.minorUnits) / 10 ** scale;
  const formatted = major.toLocaleString(locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  const symbol = currencySymbol[money.currency];
  const sign = money.minorUnits < 0 ? '-' : '';

  return money.currency === 'UAH'
    ? `${sign}${formatted} ${symbol}`
    : `${sign}${symbol}${formatted}`;
};
