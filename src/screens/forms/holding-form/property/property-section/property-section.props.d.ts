import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';

import type { FieldInstance } from '../../../scroll-to-field/scroll-to-field';
import type { PropertyCategory } from '../../../../../holdings/holding-metadata';

export type PropertySectionProps = {
  category: PropertyCategory;
  onSelectCategory: (category: PropertyCategory) => void;
  // The cost field only applies at CREATE time — it seeds the holding's one
  // lot and its first `manual` price point (kiko-domain). A later revaluation
  // goes through the dedicated "Update value" form (PricePointForm), never
  // through this metadata patch, so an edit-mode render hides it entirely.
  showCost: boolean;
  cost: string;
  onChangeCost: (text: string) => void;
  currencySuffix: string;
  costError?: string;
  costFieldRef?: RefObject<FieldInstance | null>;
  costInputRef?: RefObject<TextInputInstance | null>;
};
