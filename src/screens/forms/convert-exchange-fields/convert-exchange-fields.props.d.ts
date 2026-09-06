import type { HoldingSelectOption } from '../holding-select-field/holding-select-field.props';

export type ConvertExchangeFieldsProps = {
  // The read-only fixed side: the existing leg's label ('Value Out' for an
  // expense-sourced convert, 'Value In' for an income-sourced convert) and its
  // pre-formatted display value (major units, grouped) in the existing holding's
  // currency. Never editable — the existing row is never re-written.
  fixedLabel: string;
  fixedValue: string;
  // The existing (fixed) leg's currency glyph, shown as its suffix.
  fixedSuffix: string;
  // The NEW leg the user records: its picker label ('To' for a destination,
  // 'From' for a source), the eligible options, the picked id, and the amount.
  counterpartLabel: string;
  counterpartPlaceholder: string;
  counterpartOptions: readonly HoldingSelectOption[];
  counterpartHoldingId: string | null;
  onSelectCounterpart: (id: string) => void;
  counterpartAmountLabel: string;
  counterpartAmount: string;
  onChangeCounterpartAmount: (text: string) => void;
  // The counterpart holding's currency glyph, shown as the counterpart amount
  // field's suffix. Empty until a counterpart holding is picked.
  counterpartSuffix: string;
  // The shared Date field (defaults to the existing transaction's time).
  time: number;
  onChangeTime: (timestamp: number) => void;
};
