export type FieldLabelProps = {
  // The field's caption text, rendered as the muted caption every labeled form
  // field shows above its control.
  label: string;
  // When true, render a red asterisk after the label so a required field is
  // marked at a glance. Defaults to false. The marker is decorative: the field's
  // own control owns its accessibilityLabel, so the caption row (label + marker)
  // never becomes the accessible name and VoiceOver is unaffected.
  required?: boolean;
};
