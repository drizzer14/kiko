import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';

export type SaveAsTemplateProps = {
  // False where the template could not be written with the transaction: a read-only row, or a
  // convert. Nothing renders then, whatever `isOn` holds.
  visible: boolean;
  isOn: boolean;
  onToggle: (isOn: boolean) => void;
  name: string;
  onChangeName: (name: string) => void;
  // The name's validation-failure message, or `undefined` while it is fine.
  error?: string;
  // The name field's wrapping View, for scroll-to-invalid.
  nameFieldRef?: RefObject<FieldInstance | null>;
  // The name's inner input, so a blocked Save can focus it once it has scrolled into view.
  nameInputRef?: RefObject<TextInputInstance | null>;
};
