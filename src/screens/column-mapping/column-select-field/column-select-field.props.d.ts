export type ColumnSelectFieldOption<T extends string | number> = {
  value: T;
  label: string;
};

export type ColumnSelectFieldProps<T extends string | number> = {
  label: string;
  options: ColumnSelectFieldOption<T>[];
  selected: T | undefined;
  onSelect: (value: T | undefined) => void;
  // Renders a trailing "Not used" row that selects `undefined` — only for an
  // OPTIONAL role (e.g. the counterparty column). Omitted for a required
  // role, which always needs a real selection.
  allowNotUsed?: boolean;
  // Forwarded straight to the underlying `FieldTrigger` — shows the red
  // asterisk required-field marker (device-feedback-round-F1, item 11).
  // Defaults to false, matching an optional field like the counterparty
  // column.
  required?: boolean;
  testID?: string;
};
