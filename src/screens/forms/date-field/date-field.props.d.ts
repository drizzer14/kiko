export type DateFieldProps = {
  // The caption rendered above the field, and the field's accessibility label.
  label: string;
  // The selected day as a unix-millis timestamp (local midnight), or null when
  // nothing is picked yet.
  value: number | null;
  // Reports the picked day as a unix-millis timestamp (local midnight).
  onChange: (timestamp: number) => void;
  // Shown in the field when `value` is null.
  placeholder?: string;
  // When true, the label shows a red asterisk marking the field as required.
  // Defaults to false. See the shared FieldLabel.
  required?: boolean;
  // When true, the field is read-only: a press is inert (the calendar never
  // opens) and the field is dimmed to read as locked — matching the disabled
  // TextField / ChipRow treatment. A synced (Monobank) transaction's date uses
  // this so its bank-owned date cannot be changed.
  disabled?: boolean;
};
