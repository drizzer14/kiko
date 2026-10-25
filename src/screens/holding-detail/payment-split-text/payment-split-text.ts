import type { TFunction } from 'i18next';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { Currency } from '@kiko/currency/currency';

// A payment with no interest names only its principal: a 0% loan would otherwise repeat
// "interest 0.00" on every card.
export const paymentSplitText = (
  t: TFunction,
  currency: Currency,
  principalMinorUnits: number,
  interestMinorUnits: number,
): string => {
  const principal = formatMoney(Money.of(currency, principalMinorUnits), activeLocale());

  if (interestMinorUnits === 0) {
    return t('holdingDetail.paymentSplitPrincipalOnly', { principal });
  }

  return t('holdingDetail.paymentSplit', {
    principal,
    interest: formatMoney(Money.of(currency, interestMinorUnits), activeLocale()),
  });
};
