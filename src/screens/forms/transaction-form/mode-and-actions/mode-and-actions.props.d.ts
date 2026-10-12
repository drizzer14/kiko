import type { RefObject } from 'react';
import type { TFunction } from 'i18next';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

export type ModeAndActionsProps = {
  converting: boolean;
  isReadOnly: boolean;
  isExchange: boolean;
  categoryOptions: { key: string; title: string; icon: string; color: string }[];
  selectedCategory: string | null;
  onSelectCategory: (key: string) => void;
  convertEligible: boolean;
  onPressConvert: () => void;
  isEditing: boolean;
  t: TFunction;
  // The category picker's own validation-failure message, or `undefined` when
  // valid — the `CategoryField` renders it under itself and turns its label
  // red; the field is wrapped in `categoryFieldRef` for scroll-to-invalid.
  categoryError?: string;
  categoryFieldRef?: RefObject<FieldInstance | null>;
  loanFieldVisible: boolean;
  loanOptions: readonly HoldingSelectOption[];
  selectedLoanHoldingId: string | null;
  onSelectLoanPayment: (loanHoldingId: string | null) => void;
  loanLinkSource: 'auto' | 'manual' | null;
  onUndoLoanLink: () => void;
};
