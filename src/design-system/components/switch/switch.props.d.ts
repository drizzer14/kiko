export type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  // When given, renders a labeled row (label left, toggle right) instead of
  // the bare toggle.
  label?: string;
  testID?: string;
};
