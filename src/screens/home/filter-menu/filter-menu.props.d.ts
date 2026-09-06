// One selectable row in a filter menu. `value` is the STABLE identity the
// filter matches and toggles on (an account name, or — since a category's
// display title is language-dependent — a category's `categories.key` slug,
// never its resolved title). `label`, when present, is the text actually
// rendered for the row and may differ from `value` (e.g. the category's
// resolved, localized display title); when absent the row renders `value`
// itself as its label, which is what an account option (identity == label)
// relies on. When present, `icon` is an SF Symbol rendered before the label
// and `color` tints that glyph (an entity/category color hex); both — like
// `label` — may be absent (e.g. the synthetic "All" row), and the row then
// renders label-only.
export type FilterOption = {
  value: string;
  label?: string;
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
