export type FilterPillProps = {
  // The text shown on the pill; a caller with a count builds the whole string, a caller with a
  // named choice passes it as `value` instead.
  label: string;
  // A value shown after the label as "<label>: <value>", for a filter that picks one of several
  // named choices. It is also the spoken value unless `accessibilityValue` says otherwise.
  value?: string;
  // The leading SF Symbol; omitted renders no glyph.
  icon?: string;
  onPress: () => void;
  // What a screen reader announces. It stays the same whatever `label` shows, so a count or a
  // value in the visible text never renames the control.
  accessibilityLabel: string;
  // The spoken state; it defaults to `value` when there is one. Set it when the visible text does
  // not carry the state, such as how many options are selected.
  accessibilityValue?: { text: string };
  // Whether a filter is applied: the fill takes the accent tint, the glyph and border the accent.
  active?: boolean;
  // Caps the pill at the shared select trigger width, the text wrapping inside it, so a long
  // value cannot push the row it sits in.
  capped?: boolean;
  testID?: string;
};
