import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import type { TermUnit } from '@kiko/screens/forms/term-reasons';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { LoanKind, LoanSchedule } from '@kiko/holdings/holding-metadata';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

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
  // `'annuity'`/`'differentiated'` — `'none'` (an informal debt)
  // hides them entirely, mirroring `PropertySection`'s `showCost`/
  // `MetalSection`'s `showFirstLot` conditional-field convention.
  annualRatePct: string;
  onChangeAnnualRatePct: (text: string) => void;
  annualRatePctError?: string;
  annualRatePctFieldRef?: RefObject<FieldInstance | null>;
  annualRatePctInputRef?: RefObject<TextInputInstance | null>;
  term: string;
  onChangeTerm: (text: string) => void;
  termUnit: TermUnit;
  onSelectTermUnit: (unit: TermUnit) => void;
  termError?: string;
  termFieldRef?: RefObject<FieldInstance | null>;
  termInputRef?: RefObject<TextInputInstance | null>;
  // The loan-payment matcher's own optional inputs (kiko-domain) — never
  // validated, hidden alongside rate/term for a `'none'` schedule (the
  // matcher never links against an informal debt at all, so these would do
  // nothing there). `paymentHoldingOptions` is every OPEN, non-ledgerless
  // holding in this loan's own currency — built and filtered by the caller,
  // mirroring every other holding-picker field in this app.
  paymentHoldingId: string | null;
  onSelectPaymentHoldingId: (id: string | null) => void;
  paymentHoldingOptions: readonly HoldingSelectOption[];
  lenderName: string;
  onChangeLenderName: (text: string) => void;
  lenderIban: string;
  onChangeLenderIban: (text: string) => void;
};
