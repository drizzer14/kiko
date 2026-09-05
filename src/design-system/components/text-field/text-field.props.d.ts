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
  // Defaults to `true`. Set `false` to render the field read-only — see
  // text-field.styles.ts for the disabled visual treatment.
  editable?: boolean;
  // Defaults to `label` so a caller only needs to override it when the
  // visible label isn't descriptive enough for a screen reader on its own.
  accessibilityLabel?: string;
};
