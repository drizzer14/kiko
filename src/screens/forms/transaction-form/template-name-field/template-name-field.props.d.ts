import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';

export type TemplateNameFieldProps = {
  visible: boolean;
  value: string;
  onChangeText: (text: string) => void;
  // The validation-failure message, or `undefined` while the name is fine.
  error?: string;
  // The field's wrapping View, for scroll-to-invalid.
  fieldRef?: RefObject<FieldInstance | null>;
  // The inner input, so a blocked Save can focus it once it has scrolled into view.
  inputRef?: RefObject<TextInputInstance | null>;
};
