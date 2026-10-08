export type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  // When given, renders a labeled row (label left, toggle right) instead of
  // the bare toggle.
  label?: string;
  // For a bare toggle whose label sits elsewhere in the row, so VoiceOver
  // still names it.
  accessibilityLabel?: string;
  testID?: string;
};
