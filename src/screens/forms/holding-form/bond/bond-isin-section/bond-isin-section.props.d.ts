import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';

import type { BondTerms } from '../../../../../bonds/nbu-register';
import type { FieldInstance } from '../../../scroll-to-field/scroll-to-field';
import type { BondCouponFrequency } from '../../../../../holdings/holding-metadata';

// "ISIN" pre-fills a found bond's terms from the NBU register; "Manual" is
// the classic hand-entered form (spec 6.3/6.4). A CREATE defaults to
// 'isin'; an EDIT always opens 'manual', with the stored ISIN shown and
// still editable (spec 6.4 #6) — `useBondFields` owns that seeding, this
// type is just the shared vocabulary.
export type BondEntryMode = 'isin' | 'manual';

export type BondIsinSectionProps = {
  mode: BondEntryMode;
  onSelectMode: (mode: BondEntryMode) => void;
  isin: string;
  onChangeIsin: (isin: string) => void;
  // The blocking validation reason (required/format/check-digit), gated on
  // `attemptedSave` by the caller — mirrors every other field's `error`
  // prop. The not-in-register/not-loaded reasons are NOT surfaced here:
  // they have their own always-visible hint block below (not gated on
  // Save), rendered from `foundTerms`/`registerLoaded` instead.
  isinError?: string;
  isinFieldRef?: RefObject<FieldInstance | null>;
  isinInputRef?: RefObject<TextInputInstance | null>;
  // The register's resolved terms for the current ISIN, or `null` while
  // nothing has matched yet — `useBondIsinMode` owns the lookup and passes
  // the result straight through, so this component stays presentational
  // (the same split `MetalSection`/`PropertySection` already establish).
  foundTerms: BondTerms | null;
  // Whether the `bond_register` cache has EVER been populated — tells "no
  // cache yet" from a confident "not in the register" (T25 review round 2,
  // M6): both still offer the same Switch-to-Manual path (spec 6.4 #3),
  // only the message differs.
  registerLoaded: boolean;
  // "Not in the NBU register" → Switch to Manual (spec 6.4 #3). Keeps the
  // typed ISIN — the caller's mode state is the only thing that changes.
  onSwitchToManual: () => void;
  // True while ISIN mode has a found match whose register `couponFrequency`
  // is unmapped (spec 6.2's own fallback) — the picker below is shown with
  // NO default, and Save is blocked until picked (T25 review round 2, N2,
  // orchestrator ruling).
  needsCouponFrequencyPick: boolean;
  pickedCouponFrequency: BondCouponFrequency | null;
  onPickCouponFrequency: (frequency: BondCouponFrequency) => void;
  couponFrequencyError?: string;
};
