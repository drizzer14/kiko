import { activeLocale } from '@kiko/i18n/active-locale';

// Two decimals of a percent — the precision a seller's statement shows a
// yield in (15.40%).
export const yieldToMaturityText = (rate: number): string =>
  `${(rate * 100).toLocaleString(activeLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
