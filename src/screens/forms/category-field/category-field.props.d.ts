export type CategoryOption = { key: string; title: string; icon: string; color: string };

export type CategoryFieldProps = {
  label: string;
  // The picker sheet's header: a Title Case sheet title, a separate key from
  // the sentence-case `label` (kiko-translator: one key per UI role).
  sheetTitle: string;
  options: readonly CategoryOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  // When true, the label shows a red asterisk marking the field as required.
  // Defaults to false. Forwarded to the shared FieldTrigger.
  required?: boolean;
  // The validation-failure message, or `undefined` while valid. Forwarded to
  // the shared FieldTrigger, which renders it under the field and turns the
  // label red.
  error?: string;
  // An optional testID forwarded to the field trigger, so a flow can open the
  // category picker sheet deterministically.
  testID?: string;
};
