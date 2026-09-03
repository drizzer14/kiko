export type ColorPickerProps = {
  // The effective color hex currently in force: either the user's manual pick or,
  // while they have not picked, the entity's type/kind default (the caller
  // resolves that fallback). The one swatch whose hex equals this renders in the
  // selected state.
  value: string;
  // Report the tapped swatch's hex. The caller stores it as the entity's color
  // and, on the create forms, marks its color state dirty so it stops following
  // the type/kind default.
  onSelect: (color: string) => void;
  // Optional caption rendered above the swatch row (a `Text variant="caption"
  // tone="textSecondary"`), matching the ChipRow/field-label treatment so the
  // picker reads as a labeled field alongside the other form controls.
  label?: string;
};
