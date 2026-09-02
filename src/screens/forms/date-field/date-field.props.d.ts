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
};
