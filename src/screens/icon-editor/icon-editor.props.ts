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
  // Optional explicit accessibility label for the picker toggle, overriding the
  // caption-derived "Change <label>"/"Change icon" default. A captionless caller
  // (a category row, which shows no field label) uses it to keep a descriptive,
  // per-row toggle label such as "Change Groceries icon".
  iconAccessibilityLabel?: string;
  // Persist the chosen SF Symbol name (the caller calls the repo's setIcon).
  onSelect: (icon: string) => void;
  // Clear the stored icon back to none (the caller calls setIcon(id, null)).
  // Only offered inside the picker when a custom icon is currently set AND the
  // caller supplies this handler; omit it to suppress the Remove control for a
  // row whose icon is mandatory (a category always keeps one).
  onRemove?: () => void;
};
