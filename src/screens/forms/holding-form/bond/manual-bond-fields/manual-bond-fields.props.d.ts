import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import type { BondKind, BondCouponFrequency } from '@kiko/holdings/holding-metadata';

import type { BondEntryMode } from '../bond-isin-section/bond-isin-section.props';
import type { FieldInstance } from '../../../../../design-system/scroll-to-field/scroll-to-field';

export type ManualBondFieldsProps = {
  // Renders nothing outside Manual mode — these five fields
  // are hidden in ISIN mode, where they are register-sourced instead.
  bondMode: BondEntryMode;
  faceValue: string;
  onChangeFaceValue: (text: string) => void;
  faceValueError?: string;
  faceValueFieldRef?: RefObject<FieldInstance | null>;
  faceValueInputRef?: RefObject<TextInputInstance | null>;
  couponPct: string;
  onChangeCouponPct: (text: string) => void;
  couponPctError?: string;
  couponPctFieldRef?: RefObject<FieldInstance | null>;
  couponPctInputRef?: RefObject<TextInputInstance | null>;
  maturityDate: number | null;
  onChangeMaturityDate: (value: number) => void;
  maturityDateError?: string;
  maturityDateFieldRef?: RefObject<FieldInstance | null>;
  bondKind: BondKind;
  onSelectBondKind: (kind: BondKind) => void;
  couponFrequency: BondCouponFrequency;
  onSelectCouponFrequency: (frequency: BondCouponFrequency) => void;
  currencySuffix: string;
};
