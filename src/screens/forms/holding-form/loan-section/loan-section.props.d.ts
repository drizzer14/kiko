import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';

import type { FieldInstance } from '../../scroll-to-field/scroll-to-field';
import type { LoanKind, LoanSchedule } from '../../../../holdings/holding-metadata';

export type LoanSectionProps = {
  kind: LoanKind;
  onSelectKind: (kind: LoanKind) => void;
  principal: string;
  onChangePrincipal: (text: string) => void;
  principalError?: string;
  principalFieldRef?: RefObject<FieldInstance | null>;
  principalInputRef?: RefObject<TextInputInstance | null>;
  currencySuffix: string;
  startDate: number | null;
  onChangeStartDate: (value: number) => void;
  startDateError?: string;
  startDateFieldRef?: RefObject<FieldInstance | null>;
  schedule: LoanSchedule;
  onSelectSchedule: (schedule: LoanSchedule) => void;
  // The rate/term fields only apply while `schedule` is
  // `'annuity'`/`'differentiated'` — `'none'` (an informal debt, spec 5.1)
  // hides them entirely, mirroring `PropertySection`'s `showCost`/
  // `MetalSection`'s `showFirstLot` conditional-field convention.
  annualRatePct: string;
  onChangeAnnualRatePct: (text: string) => void;
  annualRatePctError?: string;
  annualRatePctFieldRef?: RefObject<FieldInstance | null>;
  annualRatePctInputRef?: RefObject<TextInputInstance | null>;
  termMonths: string;
  onChangeTermMonths: (text: string) => void;
  termMonthsError?: string;
  termMonthsFieldRef?: RefObject<FieldInstance | null>;
  termMonthsInputRef?: RefObject<TextInputInstance | null>;
};
