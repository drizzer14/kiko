import type { AccountRow, HoldingRow } from '@kiko/db';

import type { HoldingType } from '../holding-type';
import { recordByType } from '../holding-descriptor';
import { type PropertyCategory, propertyCategoryOf } from '../holding-metadata';

// The default SF Symbol shown for an account/holding icon, keyed by its
// kind/type. Mirrors src/holdings/entity-colors.ts: fixed UI symbols (not
// drawn from the user-facing curated icon pool in
// src/design-system/components/icon-picker-modal/icon-picker-modal.component.tsx), so
// a user may still override the icon per entity later; until then the row
// renders the kind/type default.

type AccountKind = AccountRow['kind'];

// bank -> building.columns.fill, cash -> banknote, crypto ->
// bitcoinsign.circle, property -> house.fill, metals -> cube.fill, debt ->
// minus.circle.fill. Typed over the full `AccountKind` union, so adding an
// account kind is a compile error here until its default symbol is supplied.
// `bank` is the filled classic bank-with-columns glyph (SF Symbols iOS 14),
// confirmed to paint on this device; `building.classical.columns.fill` is an
// iOS-27-only SF Symbol confirmed invisible on this device, so it is not used
// here. The crypto ACCOUNT default is persisted at create time, so its change
// to `bitcoinsign.circle` ships alongside migration 0032_icon_crypto_account,
// which refines un-customized existing rows. `cube.fill` (SF Symbols 1, safe
// on the iOS-16 floor) is the pick for `metals` — icon choice was
// unspecified for it, as with `house.fill` for `property`. `minus.circle.fill`
// (SF Symbols 1) is the pick for `debt` — same "negative amount owed"
// semantics as its sole holding type below, mirroring the property/metals
// kind-and-type icon reuse.
export const accountKindSymbol: Record<AccountKind, string> = {
  bank: 'building.columns.fill',
  cash: 'banknote',
  crypto: 'bitcoinsign.circle',
  property: 'house.fill',
  metals: 'cube.fill',
  debt: 'minus.circle.fill',
};

// card -> creditcard, term_deposit -> calendar, bond -> receipt, jar ->
// rectangle.portrait, cash -> banknote, crypto_asset -> bitcoinsign.circle,
// property_item -> house.fill, metal -> cube.fill, loan -> minus.circle.fill —
// each type's own descriptor (`src/holdings/holding-descriptor/`) is the
// source, read through `recordByType` for the same per-type exhaustiveness
// guarantee as the account map above. The `jar` and `crypto_asset` HOLDING
// defaults are pure render-time fallbacks (holdings persist a null icon
// until the user picks one), so these changes update every un-customized
// holding with NO data migration — unlike the crypto ACCOUNT default above.
// `loan` shares its `debt` kind's icon, the same reuse `property_item`/
// `metal` already follow for their own standalone kinds.
export const holdingTypeSymbol: Record<HoldingType, string> = recordByType(
  (descriptor) => descriptor.symbol,
);

// Every `property_item` shares one holding type, so its category — not the
// type — picks the default glyph. All six are SF Symbols 1/2 (iOS 13/14), safe
// on the deployment floor.
export const propertyCategorySymbol: Record<PropertyCategory, string> = {
  real_estate: 'house.fill',
  vehicle: 'car.fill',
  valuable: 'diamond.fill',
  business_share: 'briefcase.fill',
  loan_given: 'arrow.up.forward.circle.fill',
  other: 'square.grid.2x2.fill',
};

// The glyph a holding shows while the user has picked no icon of its own. The
// category is read leniently (`propertyCategoryOf`), so garbled metadata still
// gets a glyph rather than a blank tile.
export const defaultHoldingSymbol = (holding: Pick<HoldingRow, 'type' | 'metadata'>): string =>
  holding.type === 'property_item'
    ? propertyCategorySymbol[propertyCategoryOf(holding.metadata)]
    : holdingTypeSymbol[holding.type];

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
