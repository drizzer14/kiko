import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import type { TermUnit } from '@kiko/screens/forms/term-reasons';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';

export type TermFieldProps = {
  // The number as typed, in `unit` — never converted while the user types,
  // so switching the unit keeps the number and only changes what it means.
  value: string;
  onChangeValue: (text: string) => void;
  unit: TermUnit;
  onSelectUnit: (unit: TermUnit) => void;
  error?: string;
  fieldRef?: RefObject<FieldInstance | null>;
  inputRef?: RefObject<TextInputInstance | null>;
};
