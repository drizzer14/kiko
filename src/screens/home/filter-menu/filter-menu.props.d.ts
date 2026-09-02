export type FilterMenuProps = {
  // The control's label, shown on the button and used as the menu title.
  label: string;
  // The selectable values, each rendered as a checkable menu item.
  options: string[];
  // The currently selected values; an empty set means "All".
  selected: Set<string>;
  // Called with the tapped value (or FILTER_ALL) to toggle it in/out.
  onToggle: (value: string) => void;
  // Test hook so a test can read the built actions and drive a selection.
  testID: string;
};
