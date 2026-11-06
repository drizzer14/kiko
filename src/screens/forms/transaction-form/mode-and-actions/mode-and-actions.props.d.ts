import type { RefObject } from 'react';
import type { TFunction } from 'i18next';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { FundingCaptionKey } from '@kiko/statistics/exchange-funding-match';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

export type ModeAndActionsProps = {
  converting: boolean;
  isReadOnly: boolean;
  isExchange: boolean;
  categoryOptions: { key: string; title: string; icon: string; color: string }[];
  selectedCategory: string | null;
  onSelectCategory: (key: string) => void;
  categoryRequired: boolean;
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
  // The copy key of the caption under the category picker that says why a bank debit is left out
  // of spending (it paid for an exchange purchase), or `undefined` when the row has none.
  exchangeFundingCaptionKey?: FundingCaptionKey;
};
