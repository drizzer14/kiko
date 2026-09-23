import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';

import type { Metal, MetalForm, MetalUnit } from '../../../../holdings/holding-metadata';
import type { FieldInstance } from '../../scroll-to-field/scroll-to-field';

export type MetalSectionProps = {
  metal: Metal;
  onSelectMetal: (metal: Metal) => void;
  form: MetalForm;
  onSelectForm: (form: MetalForm) => void;
  unit: MetalUnit;
  onSelectUnit: (unit: MetalUnit) => void;
  purity: string;
  onChangePurity: (text: string) => void;
  // The first-lot fields only apply at CREATE time — they seed the holding's
  // one lot (mirrors PropertySection's `showCost`). A later buy/sell goes
  // through the dedicated Lot form instead, so an edit-mode render hides them.
  showFirstLot: boolean;
  quantity: string;
  onChangeQuantity: (text: string) => void;
  cost: string;
  onChangeCost: (text: string) => void;
  currencySuffix: string;
  quantityError?: string;
  costError?: string;
  quantityFieldRef?: RefObject<FieldInstance | null>;
  quantityInputRef?: RefObject<TextInputInstance | null>;
  costFieldRef?: RefObject<FieldInstance | null>;
  costInputRef?: RefObject<TextInputInstance | null>;
};
