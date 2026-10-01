import type { Currency } from '@kiko/currency/currency';

import type { UseShareFieldsResult } from '../use-share-fields/use-share-fields';

export type ShareFormBlockProps = {
  fields: UseShareFieldsResult;
  attemptedSave: boolean;
  isEdit: boolean;
  currency: Currency;
  onSearchOpenChange: (isOpen: boolean) => void;
};
