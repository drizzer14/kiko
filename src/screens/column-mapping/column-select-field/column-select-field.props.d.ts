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
  testID?: string;
};
