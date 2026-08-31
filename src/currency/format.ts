import { currencyScale, currencySymbol } from './currency';
import type { Money } from './money';

export const formatMoney = (money: Money, locale = 'en-US'): string => {
  const scale = currencyScale[money.currency];
  const major = money.minorUnits / 10 ** scale;
  const formatted = major.toLocaleString(locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  const symbol = currencySymbol[money.currency];
  return money.currency === 'UAH' ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
};
