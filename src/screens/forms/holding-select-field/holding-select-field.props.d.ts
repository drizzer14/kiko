import type { Currency } from '../../../currency/currency';

export type HoldingSelectOption = {
  id: string;
  name: string;
  icon: string;
  color: string;
  currency: Currency;
  accountName: string; // the parent account's display name (Requirement C)
};

export type HoldingSelectFieldProps = {
  label: string;
  placeholder: string;
  options: readonly HoldingSelectOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};
