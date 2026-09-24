import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';

import type { BondKind, BondCouponFrequency } from '../../../../holdings/holding-metadata';
import type { BondEntryMode } from '../bond-isin-section/bond-isin-section.props';
import type { FieldInstance } from '../../scroll-to-field/scroll-to-field';

export type ManualBondFieldsProps = {
  // Renders nothing outside Manual mode (spec 6.3 hides these five fields
  // in ISIN mode — they are register-sourced there instead). The caller
  // passes `bondMode` straight through rather than gating
  // `{bondMode === 'manual' && <ManualBondFields .../>}` itself, so this
  // component's own conditional never nests inside the bond block's outer
  // `{type === 'bond' && (...)}` gate in `holding-form.screen.tsx`.
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
  bondKindOptions: readonly BondKind[];
  bondKindLabels: Record<BondKind, string>;
  couponFrequency: BondCouponFrequency;
  onSelectCouponFrequency: (frequency: BondCouponFrequency) => void;
  couponFrequencyOptions: readonly BondCouponFrequency[];
  couponFrequencyLabels: Record<BondCouponFrequency, string>;
  currencySuffix: string;
};
