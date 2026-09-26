import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';

import type { FieldInstance } from '../../../design-system/scroll-to-field/scroll-to-field';

import type { TermUnit } from './term-reasons';

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
