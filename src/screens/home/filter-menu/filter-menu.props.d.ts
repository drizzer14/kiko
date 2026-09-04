// One selectable row in a filter menu. `value` is the exact string the filter
// matches on (an account name / a resolved category title) AND the row's label —
// selection state keys on it, unchanged by the optional presentation below. When
// present, `icon` is an SF Symbol rendered before the label and `color` tints
// that glyph (an entity/category color hex); either may be absent (e.g. the
// synthetic "All" row), and the row then renders label-only.
export type FilterOption = {
  value: string;
  icon?: string;
  color?: string;
};

export type FilterMenuProps = {
  // The control's label, shown on the button and used as the menu title.
  label: string;
  // The selectable options, each rendered as a checkable menu item; matching
  // still keys on each option's `value`.
  options: FilterOption[];
  // The currently selected values; an empty set means "All".
  selected: Set<string>;
  // Called with the tapped value (or FILTER_ALL) to toggle it in/out.
  onToggle: (value: string) => void;
  // Test hook so a test can read the built actions and drive a selection.
  testID: string;
};
