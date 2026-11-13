export type FilterPillProps = {
  // The text shown on the pill; a caller with a count or a value builds the whole string.
  label: string;
  // The leading SF Symbol; omitted renders no glyph.
  icon?: string;
  onPress: () => void;
  // What a screen reader announces. It stays the same whatever `label` shows, so a count or a
  // value in the visible text never renames the control.
  accessibilityLabel: string;
  // A spoken state that the visible text does not carry, such as how many options are selected.
  accessibilityValue?: { text: string };
  // Whether a filter is applied: the fill takes the accent tint, the glyph and border the accent.
  active?: boolean;
  testID?: string;
};
