import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { BondKind, BondEntryMode, BondCouponFrequency } from '@kiko/holdings/holding-metadata';

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
  // True while an edit keeps the bond's stored payment schedule, which then
  // sets the coupon % and frequency: both show read-only (user ruling).
  couponFromSchedule: boolean;
  currencySuffix: string;
};
