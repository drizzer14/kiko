export type ClipboardTextFieldProps = {
  label: string;
  value: string;
  // Called with the new text on every edit AND on a clipboard paste, where the
  // pasted value arrives already trimmed — the same hook a caller already uses
  // to reset its own stale save-result status.
  onChangeText: (text: string) => void;
  placeholder: string;
  // The translated accessibility label for the trailing paste-icon button —
  // VoiceOver has no visible text to read on an icon-only control.
  pasteAccessibilityLabel: string;
  secureTextEntry?: boolean;
  // The validation-failure message for this field, or `undefined` when it's
  // currently valid — rendered as a `FieldError` below the input/paste row
  // (same REFLOW-not-reserve contract, see text-field.props.d.ts), not inside
  // `TextField`, so the paste button stays centered on the input. Also tints
  // this field's own `FieldLabel` negative, since the caption renders OUTSIDE
  // `TextField` here (see this component's own doc comment).
  error?: string;
};
