export type ColumnSelectFieldOption<T extends string | number> = {
  value: T;
  label: string;
};

export type ColumnSelectFieldProps<T extends string | number> = {
  label: string;
  // The picker sheet's header: a Title Case sheet title, a separate key from
  // the sentence-case `label` (kiko-translator: one key per UI role).
  sheetTitle: string;
  options: ColumnSelectFieldOption<T>[];
  selected: T | undefined;
  onSelect: (value: T | undefined) => void;
  // Renders a trailing "Not used" row that selects `undefined` — only for an
  // OPTIONAL role (e.g. the counterparty column). Omitted for a required
  // role, which always needs a real selection.
  allowNotUsed?: boolean;
  // Forwarded straight to the underlying `FieldTrigger` — shows the red
  // asterisk required-field marker. Defaults to false, matching an
  // optional field like the counterparty column.
  required?: boolean;
  // The "nothing picked yet" copy shown as the field's value — a per-role
  // string (e.g. "Select a date") the caller supplies, never the field's own
  // `label` repeated, and never a bare generic "Select" that reads the same
  // for every field. Required — every call site names its own column role.
  placeholder: string;
  // The validation-failure message for this field, or `undefined` when it's
  // currently valid — forwarded straight to the underlying `FieldTrigger`.
  error?: string;
  testID?: string;
};
