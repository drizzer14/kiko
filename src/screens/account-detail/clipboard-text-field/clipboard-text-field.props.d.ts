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
};
