import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import type { BondTerms } from '@kiko/bonds/nbu-register';
import type { BondCouponFrequency } from '@kiko/holdings/holding-metadata';

import type { FieldInstance } from '../../../../../design-system/scroll-to-field/scroll-to-field';

// "ISIN" pre-fills a found bond's terms from the NBU register; "Manual" is
// the classic hand-entered form. A CREATE defaults to
// 'isin'; an EDIT always opens 'manual', with the stored ISIN shown and
// still editable — `useBondFields` owns that seeding, this
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
  // cache yet" from a confident "not in the register": both still offer
  // the same Switch-to-Manual path, only the message differs.
  registerLoaded: boolean;
  // "Not in the NBU register" → Switch to Manual. Keeps the
  // typed ISIN — the caller's mode state is the only thing that changes.
  onSwitchToManual: () => void;
  // True while ISIN mode has a found match whose register `couponFrequency`
  // is unmapped — the picker below is shown with
  // NO default, and Save is blocked until picked.
  needsCouponFrequencyPick: boolean;
  pickedCouponFrequency: BondCouponFrequency | null;
  onPickCouponFrequency: (frequency: BondCouponFrequency) => void;
  couponFrequencyError?: string;
};
