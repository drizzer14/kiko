import { useMemo } from 'react';
import { useLiveQuery } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';

import { holdingsRepo } from '../repo';

// The currencies of the user's open holdings, live. A picker only orders by this, so nothing
// gates on it: it reads empty until the first read lands, and the list is just unordered then.
export const useHeldCurrencies = (): readonly Currency[] => {
  const { data, isLoading } = useLiveQuery(holdingsRepo.openCurrenciesQuery(), [
    'holdings',
    'accounts',
  ]);

  return useMemo(() => (isLoading ? [] : data.map(({ currency }) => currency)), [data, isLoading]);
};
