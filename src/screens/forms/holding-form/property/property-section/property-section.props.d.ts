import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';

import type { FieldInstance } from '../../../../../design-system/scroll-to-field/scroll-to-field';

export type PropertySectionProps = {
  cost: string;
  onChangeCost: (text: string) => void;
  currencySuffix: string;
  costError?: string;
  costFieldRef?: RefObject<FieldInstance | null>;
  costInputRef?: RefObject<TextInputInstance | null>;
};
