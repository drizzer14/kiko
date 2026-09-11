import { applySymbolPlacement, currencyScale } from '../currency';
import type { Money } from '../money';

export const formatMoney = (money: Money, locale = 'en-US'): string => {
  const scale = currencyScale[money.currency];
  const major = Math.abs(money.minorUnits) / 10 ** scale;
  const formatted = major.toLocaleString(locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  const sign = money.minorUnits < 0 ? '-' : '';

  return applySymbolPlacement(money.currency, sign, formatted);
};
