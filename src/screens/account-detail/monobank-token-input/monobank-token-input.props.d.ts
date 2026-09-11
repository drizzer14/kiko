export type MonobankTokenInputProps = {
  // The current token text (controlled by the consumer).
  value: string;
  // Called with the new text on every edit AND on a clipboard paste, where the
  // pasted value arrives already trimmed. The edit surface uses this same hook
  // to reset its stale save-result status; the create form binds it to state.
  onChangeText: (text: string) => void;
};
