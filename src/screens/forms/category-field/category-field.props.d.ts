export type CategoryOption = { key: string; title: string; icon: string; color: string };

export type CategoryFieldProps = {
  label: string;
  options: readonly CategoryOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  // When true, the label shows a red asterisk marking the field as required.
  // Defaults to false. Forwarded to the shared FieldTrigger.
  required?: boolean;
};
