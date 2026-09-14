import type { AccountRow } from '../../db/schema';
import type { HoldingType } from '../holding-type';

// The default SF Symbol shown for an account/holding icon, keyed by its
// kind/type. Mirrors src/holdings/entity-colors.ts: fixed UI symbols (not
// drawn from the user-facing curated icon pool in
// src/design-system/components/icon-picker-modal/icon-picker-modal.component.tsx), so
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

// The GENERIC entity glyphs — TYPE-agnostic references used for headings, empty
// states, and section labels, NOT a per-entity user-chosen icon and NOT the
// per-kind/type defaults above. They MUST NOT override an icon the user chose.
// `holding` uses `text.pad.header`, an iOS-26 symbol: SymbolIcon renders its
// `list.bullet.rectangle` fallback centrally on an older device (see
// symbol.availability.ts). Only `account` (`tray`) has a consumer today (the
// Accounts tab, wired in a later task); `holding`/`transaction` ship as
// scaffolding until a generic reference is introduced.
export const genericEntitySymbol = {
  account: 'tray',
  holding: 'text.pad.header',
  transaction: 'arrow.up.arrow.down',
} as const;

// The iOS-16-safe fallback for any generic glyph that is an iOS-26 symbol,
// exported alongside so a consumer rendering the glyph OUTSIDE SymbolIcon can
// pass it explicitly. Only `holding` needs one today.
export const genericEntitySymbolFallback: Partial<
  Record<keyof typeof genericEntitySymbol, string>
> = {
  holding: 'list.bullet.rectangle',
};
