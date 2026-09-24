import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';

import type { BondTerms } from '../../../../bonds/nbu-register';
import type { FieldInstance } from '../../scroll-to-field/scroll-to-field';

// "ISIN" pre-fills a found bond's terms from the NBU register; "Manual" is
// the classic hand-entered form (spec 6.3/6.4). A CREATE defaults to
// 'isin'; an EDIT always opens 'manual', with the stored ISIN shown and
// still editable (spec 6.4 #6) — `holding-form.screen.tsx` owns that
// seeding, this type is just the shared vocabulary.
export type BondEntryMode = 'isin' | 'manual';

export type BondIsinSectionProps = {
  mode: BondEntryMode;
  onSelectMode: (mode: BondEntryMode) => void;
  isin: string;
  onChangeIsin: (isin: string) => void;
  // The blocking validation reason (required/format/check-digit), gated on
  // `attemptedSave` by the caller — mirrors every other field's `error`
  // prop. The "not in the NBU register" case is NOT surfaced here: it has
  // its own always-visible hint block below (not gated on Save), rendered
  // from `foundTerms` instead.
  isinError?: string;
  isinFieldRef?: RefObject<FieldInstance | null>;
  isinInputRef?: RefObject<TextInputInstance | null>;
  // The register's resolved terms for the current ISIN, or `null` while
  // nothing has matched yet — `useBondIsinMode` owns the lookup and passes
  // the result straight through, so this component stays presentational
  // (the same split `MetalSection`/`PropertySection` already establish).
  foundTerms: BondTerms | null;
  // "Not in the NBU register" → Switch to Manual (spec 6.4 #3). Keeps the
  // typed ISIN — the caller's mode state is the only thing that changes.
  onSwitchToManual: () => void;
};
