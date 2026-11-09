export type ColorPickerProps = {
  // The effective CANONICAL (dark) color hex currently in force: either the user's manual
  // pick or, while they have not picked, the entity's type/kind default (the caller
  // resolves that fallback). The one swatch whose dark hex equals this renders in the
  // selected state. Never a display hex.
  value: string;
  // Report the tapped swatch's canonical (dark) hex, whichever scheme paints the disc. The
  // caller stores it as the entity's color and, on the create forms, marks its color state
  // dirty so it stops following the type/kind default.
  onSelect: (color: string) => void;
  // Which of the two light sets paints the discs: accounts and holdings use `entity`,
  // categories use `category`. Both report the same dark hex.
  swatchSet: 'entity' | 'category';
  // Optional caption rendered above the swatch row (a `Text variant="caption"
  // tone="textSecondary"`), matching the ChipRow/field-label treatment so the
  // picker reads as a labeled field alongside the other form controls.
  label?: string;
  // Optional prefix for each swatch's accessibility label (`${prefix} ${name}`),
  // defaulting to the catalog's forms.fields.color ('Color'/'Колір'). When
  // several pickers render at once (e.g. one per category row), pass a
  // per-instance prefix so VoiceOver — and label-based test queries — can tell
  // a "yellow" swatch on one picker from another's.
  accessibilityLabelPrefix?: string;
};
