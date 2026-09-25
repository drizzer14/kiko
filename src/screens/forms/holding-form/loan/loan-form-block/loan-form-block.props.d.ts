import type { RefObject } from 'react';
import type { TFunction } from 'i18next';
import type { TextInputInstance } from 'react-native';
import type { Currency } from '@kiko/currency/currency';
import type { HoldingType } from '@kiko/holdings/holding-type';

import type { FieldInstance } from '../../../scroll-to-field/scroll-to-field';
import type { UseLoanFieldsResult } from '../use-loan-fields/use-loan-fields';

export type LoanFormBlockProps = {
  type: HoldingType;
  t: TFunction;
  attemptedSave: boolean;
  currency: Currency;
  loanFields: UseLoanFieldsResult;
  loanPrincipalFieldRef: RefObject<FieldInstance | null>;
  loanPrincipalInputRef: RefObject<TextInputInstance | null>;
  loanStartDateFieldRef: RefObject<FieldInstance | null>;
  annualRateFieldRef: RefObject<FieldInstance | null>;
  annualRateInputRef: RefObject<TextInputInstance | null>;
  termMonthsFieldRef: RefObject<FieldInstance | null>;
  termMonthsInputRef: RefObject<TextInputInstance | null>;
};
