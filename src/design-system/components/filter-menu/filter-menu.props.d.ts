// One selectable row in a filter menu. `value` is the STABLE identity the
// filter matches and toggles on (an account's stored name, or — since a
// category's display title is language-dependent — a category's `categories.key`
// slug, never its resolved title). `label`, when present, is the text actually
// rendered for the row and may differ from `value` (an account option's
// localized display name, a category's resolved display title); when absent
// the row renders `value` itself as its label. When present, `icon` is an SF Symbol rendered before the label
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
  // The control's label, shown on the button.
  label: string;
  // The menu sheet's header: a Title Case sheet title, a separate key from the
  // sentence-case `label` (kiko-translator: one key per UI role).
  sheetTitle: string;
  // The selectable options, each rendered as a checkable menu item; matching
  // still keys on each option's `value`.
  options: FilterOption[];
  // The currently selected values; an empty set means "All".
  selected: Set<string>;
  // Called with the tapped value (or FILTER_ALL) to toggle it in/out.
  onToggle: (value: string) => void;
  // The SF Symbol on the trigger button. Optional — defaults to the legacy
  // funnel glyph so a caller that passes none is unchanged. Every current site
  // passes one to read as its dimension (account filters → `tray`, category
  // filters → `tag`); the shared component itself hardcodes no icon.
  triggerIcon?: string;
  // Test hook so a test can read the built actions and drive a selection.
  testID: string;
};
