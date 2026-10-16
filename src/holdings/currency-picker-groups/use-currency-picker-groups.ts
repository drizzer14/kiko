import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrencyGroup } from '@kiko/currency/currency-group';

import { useHeldCurrencies } from '../use-held-currencies';

import { type CurrencyPickerContext, currencyPickerGroups } from './currency-picker-groups';

// The groups a currency picker lists in the active language. The memo keys on the context's own
// fields (its serialized form: kind, type, target currency and type), so a caller may pass a
// fresh literal on every render without rebuilding the groups.
export const useCurrencyPickerGroups = (
  context: CurrencyPickerContext,
): readonly CurrencyGroup[] => {
  const { t, i18n } = useTranslation();
  const held = useHeldCurrencies();
  const contextKey = JSON.stringify(context);

  return useMemo(
    () =>
      currencyPickerGroups(JSON.parse(contextKey) as CurrencyPickerContext, {
        held,
        nameOf: (code) => t(`currencyNames.${code}`),
        language: i18n.language,
      }),
    [contextKey, held, t, i18n.language],
  );
};
