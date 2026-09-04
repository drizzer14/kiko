export type HoldingIdentityFieldProps = {
  // The holding's currently stored SF Symbol name, or null when it has no
  // custom icon yet (the chip then shows `fallbackIcon`).
  icon: string | null;
  // The type-derived default glyph shown until a custom icon is picked. The
  // create form passes the selected type's default so the icon follows the
  // type while it is not "dirty"; the detail header passes the holding type's
  // default.
  fallbackIcon: string;
  // The name field's current value.
  name: string;
  // Report a name keystroke (the create form commits continuously; the detail
  // header holds it in local state and commits on end-of-editing).
  onChangeName: (text: string) => void;
  // Persist a picked SF Symbol name.
  onSelectIcon: (icon: string) => void;
  // Clear the custom icon back to the fallback. Omit it for a mandatory-icon
  // caller (a category row) so the picker offers no Remove control.
  onRemoveIcon?: () => void;
  // Optional a11y label for the name input (defaults to 'Name'). The detail
  // header passes `${holding.name} name` so several holdings stay distinct.
  nameAccessibilityLabel?: string;
  // Optional explicit a11y label for the icon-picker toggle, forwarded to the
  // shared IconEditor. A captionless caller (a category row) uses it to keep a
  // descriptive per-row toggle label such as "Change Groceries icon".
  iconAccessibilityLabel?: string;
  // Optional tint color for the icon glyph (the entity's effective color).
  // Forwarded to the shared IconEditor; when set the chip's icon renders in this
  // color instead of the default tone.
  iconColor?: string;
  // Optional commit-on-blur handler. The detail header renames on
  // end-of-editing; the create form commits via onChangeName and omits this.
  onEndEditingName?: () => void;
  // Optional placeholder shown while the name is empty.
  namePlaceholder?: string;
  // Focus the name input as soon as it mounts. A caller that reveals this field
  // on demand (the inline "Add category" row, which only mounts the field once
  // its form expands) passes `true` so the keyboard opens straight onto the
  // name field without a second tap. Forwarded to the inner TextInput's
  // `autoFocus`; omit it (the default) for an always-mounted field.
  autoFocus?: boolean;
  // Whether to render the "Icon"/"Name" field captions above the two controls
  // (defaults to true, the form treatment). A dense list row (a category row)
  // passes `false` for a bare, caption-free icon+name pair, vertically centered
  // rather than bottom-aligned.
  captioned?: boolean;
};
