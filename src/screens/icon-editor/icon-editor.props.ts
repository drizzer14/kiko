export type IconEditorProps = {
  // The row's currently stored SF Symbol name, or null/undefined when the row
  // has no custom icon yet (the display falls back to `fallbackIcon`).
  icon: string | null | undefined;
  // The kind/type-derived default glyph shown when `icon` is not set. Keeps the
  // row visually complete before the user ever picks a custom icon.
  fallbackIcon: string;
  // Optional field caption rendered above the chip (a `Text variant="caption"
  // tone="textSecondary"`, matching the form field-label treatment), so the one
  // labelled block reads identically in the create forms and the edit screens.
  // It also composes the picker toggle's accessibility label ("Change <label>").
  // Omit it to render the bare chip with a generic "Change icon" affordance.
  label?: string;
  // Persist the chosen SF Symbol name (the caller calls the repo's setIcon).
  onSelect: (icon: string) => void;
  // Clear the stored icon back to none (the caller calls setIcon(id, null)).
  // Only offered inside the picker when a custom icon is currently set.
  onRemove: () => void;
};
