export type FieldLabelProps = {
  // The field's caption text, rendered as the muted caption every labeled form
  // field shows above its control.
  label: string;
  // When true, render a red asterisk after the label so a required field is
  // marked at a glance. Defaults to false. The marker is decorative: the field's
  // own control owns its accessibilityLabel, so the caption row (label + marker)
  // never becomes the accessible name and VoiceOver is unaffected.
  required?: boolean;
  // When true, tints the label text the same `negative` red as the field's own
  // error message, so a blocked field reads as invalid at a glance even before
  // the eye reaches its error line below — a uniform affordance across every
  // field type (the reflow error model: no per-field outline, see
  // `FieldError`'s own doc comment). Defaults to false. Never the ONLY invalid signal on its own — it
  // always accompanies a rendered `FieldError` message, never colour alone.
  invalid?: boolean;
};
