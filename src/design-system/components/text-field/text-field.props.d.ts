import type { TextInputProps } from 'react-native';

export type TextFieldProps = Pick<
  TextInputProps,
  | 'placeholder'
  | 'keyboardType'
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'multiline'
  // Masks the input (a secret like the Monobank token). Off by default, so an
  // ordinary field is never masked unless the caller opts in.
  | 'secureTextEntry'
> & {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  // When true, the label shows a red asterisk marking the field as required.
  // Defaults to false. See the shared FieldLabel for the marker treatment.
  required?: boolean;
  // Defaults to `true`. Set `false` to render the field read-only — see
  // text-field.styles.ts for the disabled visual treatment.
  editable?: boolean;
  // Defaults to `label` so a caller only needs to override it when the
  // visible label isn't descriptive enough for a screen reader on its own.
  accessibilityLabel?: string;
  // A short trailing string rendered inside the field, after the input, in a
  // muted tone — a money field passes its currency glyph here so a value reads
  // as "100.00 ₴". Optional and empty-safe: `undefined` (or an empty string,
  // e.g. a currency not yet known) renders exactly as a plain field with no
  // trailing node.
  suffix?: string;
};
