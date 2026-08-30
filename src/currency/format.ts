import { currencyScale } from './currency';
import type { Money } from './money';

export const formatMoney = (money: Money, locale = 'en-US'): string => {
  const scale = currencyScale[money.currency];
  const major = money.minorUnits / 10 ** scale;
  const formatted = major.toLocaleString(locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  return `${formatted} ${money.currency}`;
};
