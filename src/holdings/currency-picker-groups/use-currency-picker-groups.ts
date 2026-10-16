import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrencyGroup } from '@kiko/currency/currency-group';

import { useHeldCurrencies } from '../use-held-currencies';

import { type CurrencyPickerContext, currencyPickerGroups } from './currency-picker-groups';

// The groups a currency picker lists in the active language. `context` must be a stable
// reference (a module constant, or memoized by the caller): it is the memo key.
export const useCurrencyPickerGroups = (
  context: CurrencyPickerContext,
): readonly CurrencyGroup[] => {
  const { t, i18n } = useTranslation();
  const held = useHeldCurrencies();

  return useMemo(
    () =>
      currencyPickerGroups(context, {
        held,
        nameOf: (code) => t(`currencyNames.${code}`),
        language: i18n.language,
      }),
    [context, held, t, i18n.language],
  );
};
