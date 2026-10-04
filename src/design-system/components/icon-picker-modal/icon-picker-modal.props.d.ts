export type IconPickerModalProps = {
  // Whether the sheet is presented. Driven by the owning category row's picker
  // state; when false the underlying RN Modal renders nothing.
  visible: boolean;
  // The closed pool of SF Symbol names to offer as pickable swatches. The picker
  // is deliberately pool-driven, not hardcoded: the caller selects which pool to
  // show — KIKO_ENTITIES_ICONS for the account/holding IconEditor, or
  // KIKO_CATEGORIES_ICONS for the category picker (see ../icon-pools).
  icons: readonly string[];
  // The row's current icon, highlighted in the grid so the active choice reads
  // as selected at a glance.
  selectedIcon: string;
  // Called with the tapped SF Symbol name. The caller persists it and closes
  // the sheet.
  onSelect: (icon: string) => void;
  // Called for every non-selecting dismissal: the cancel control, a backdrop
  // tap, or a hardware/gesture back (Modal's onRequestClose).
  onDismiss: () => void;
  // Optional. When provided, the sheet offers a "Remove" control that clears
  // the current icon back to none. Callers whose icon is nullable (accounts,
  // holdings) pass it; the categories picker, whose icon is non-nullable, omits
  // it and no control is rendered. The caller persists null and closes.
  onRemove?: () => void;
};
