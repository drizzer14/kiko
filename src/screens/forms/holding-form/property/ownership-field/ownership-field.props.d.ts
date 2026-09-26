import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import type { OwnershipInput } from '@kiko/holdings/holding-metadata';

import type { FieldInstance } from '../../../../../design-system/scroll-to-field/scroll-to-field';

export type OwnershipFieldProps = {
  mode: OwnershipInput;
  onSelectMode: (mode: OwnershipInput) => void;
  percent: string;
  onChangePercent: (text: string) => void;
  numerator: string;
  onChangeNumerator: (text: string) => void;
  denominator: string;
  onChangeDenominator: (text: string) => void;
  // Edit mode only, once the typed share differs from the one in effect today.
  showsEffectiveDate: boolean;
  // A local-midnight timestamp, the DateField convention.
  effectiveDate: number;
  onChangeEffectiveDate: (timestamp: number) => void;
  error?: string;
  fieldRef?: RefObject<FieldInstance | null>;
  // The first input of the active mode, focused when Save scrolls here.
  inputRef?: RefObject<TextInputInstance | null>;
};
