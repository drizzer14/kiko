import type { RefObject } from 'react';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

export type PrimaryHoldingFieldProps = {
  visible: boolean;
  label: string;
  sheetTitle: string;
  placeholder: string;
  options: readonly HoldingSelectOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateNew: () => void;
  // The validation-failure message, or `undefined` while a holding is picked.
  error?: string;
  // The field's wrapping View, for scroll-to-invalid.
  fieldRef?: RefObject<FieldInstance | null>;
};
