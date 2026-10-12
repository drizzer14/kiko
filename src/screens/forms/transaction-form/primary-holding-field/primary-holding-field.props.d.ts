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
};
