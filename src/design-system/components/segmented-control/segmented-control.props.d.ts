export type SegmentedControlProps<Option extends string> = {
  options: readonly Option[];
  selected: Option;
  onSelect: (option: Option) => void;
  // Optional caption rendered above the control, so it reads as a labeled
  // field alongside the TextField/Switch fields it sits with in a form — the
  // same convention ChipRow's own `label` follows.
  label?: string;
  // When true (and a label is set), the label shows a red asterisk marking
  // the field as required. Defaults to false. See the shared FieldLabel.
  required?: boolean;
  // Optional value -> display-text map. A segment whose value is an id-like
  // enum (`debitCredit`, `fixed`) shows human text while `onSelect` still
  // reports the underlying value. A value absent from the map renders
  // verbatim.
  labels?: Partial<Record<Option, string>>;
  // When true, the control is read-only: presses are inert and it dims to
  // the shared `DISABLED_OPACITY`. Still shows the stored value's selected
  // segment, but cannot switch it.
  disabled?: boolean;
  testID?: string;
};
