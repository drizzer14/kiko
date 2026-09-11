import type { AccountRow } from '../../db/schema';

import type { HoldingType } from '../holding-type';

// The default SF Symbol shown for an account/holding icon, keyed by its
// kind/type. Mirrors src/holdings/entity-colors.ts: fixed UI symbols (not
// drawn from the user-facing curated icon pool in
// src/screens/settings/icon-picker-modal/icon-picker-modal.component.tsx), so
// a user may still override the icon per entity later; until then the row
// renders the kind/type default.

type AccountKind = AccountRow['kind'];

// bank -> building.columns.fill, cash -> banknote, crypto -> bitcoinsign.
// Typed over the full `AccountKind` union, so adding an account kind is a
// compile error here until its default symbol is supplied. `bank` is the
// filled classic bank-with-columns glyph (SF Symbols iOS 14), confirmed to
// paint on this device; `building.classical.columns.fill` is an
// iOS-27-only SF Symbol confirmed invisible on this device, so it is not
// used here.
export const accountKindSymbol: Record<AccountKind, string> = {
  bank: 'building.columns.fill',
  cash: 'banknote',
  crypto: 'bitcoinsign',
};

// card -> creditcard, term_deposit -> calendar, bond -> receipt, jar ->
// archivebox, cash -> banknote, crypto_asset -> bitcoinsign. Typed over the
// full `HoldingType` union for the same exhaustiveness guarantee as the
// account map above.
export const holdingTypeSymbol: Record<HoldingType, string> = {
  card: 'creditcard',
  term_deposit: 'calendar',
  bond: 'receipt',
  jar: 'archivebox',
  cash: 'banknote',
  crypto_asset: 'bitcoinsign',
};
