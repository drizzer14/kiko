import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import type { AccountRow, HoldingRow } from '@kiko/db';

import {
  type LoanKind,
  type PropertyCategory,
  loanKindOf,
  propertyCategoryOf,
} from '../holding-metadata';
import type { HoldingType } from '../holding-type';
import { holdingDescriptorOrUndefined, recordByType } from '../holding-descriptor';

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
// on the iOS 15.1 deployment target) is the pick for `metals` — icon choice was
// unspecified for it, as with `house.fill` for `property`. `minus.circle.fill`
// (SF Symbols 1) is the pick for `debt`, "an amount owed". Its sole holding
// type, `loan`, has its own glyph below; the account default is persisted at
// create time, so changing this one would need a 0032-style migration.
// `chart.line.uptrend.xyaxis` (SF Symbols 3, iOS 15)
// is the pick for `broker`.
// Kept as literals (`satisfies`, not an annotation) so the account icon pool
// derived from it stays a literal union.
export const accountKindSymbol = {
  bank: 'building.columns.fill',
  cash: 'banknote',
  crypto: 'bitcoinsign.circle',
  property: 'house.fill',
  metals: 'cube.fill',
  debt: 'minus.circle.fill',
  broker: 'chart.line.uptrend.xyaxis',
} as const satisfies Record<AccountKind, string>;

// card -> creditcard, term_deposit -> calendar, bond -> receipt, jar ->
// rectangle.portrait, cash -> banknote, crypto_asset -> bitcoinsign.circle,
// property_item -> house.fill, metal -> cube.fill, loan ->
// arrow.down.backward.circle.fill — each type's own descriptor
// (`src/holdings/holding-descriptor/`) is the source, read through
// `recordByType` for the same per-type exhaustiveness guarantee as the
// account map above. The `jar` and `crypto_asset` HOLDING
// defaults are pure render-time fallbacks (holdings persist a null icon
// until the user picks one), so these changes update every un-customized
// holding with NO data migration — unlike the crypto ACCOUNT default above.
// `loan` does not reuse its kind's icon: a minus reads as "subtract", so a
// loan taken mirrors a loan given (`propertyCategorySymbol.loan_given`),
// money coming in that is owed back.
// SF Symbols 2 (iOS 14), safe on the deployment floor, and a holding's null
// icon means the change needs no migration.
export const holdingTypeSymbol: Record<HoldingType, string> = recordByType(
  (descriptor) => descriptor.symbol,
);

// Every `loan` shares one holding type, so its kind — not the type — picks the
// default glyph, like a property's category below. All four are SF Symbols
// 1/2 (iOS 13/14: `house.circle.fill` is 2020, the rest 2019), safe on the
// deployment floor, checked against the SF Symbols app's name_availability
// metadata. The mortgage is NOT `house.fill`, the Properties account's own
// glyph, so a mortgage card never reads as a property.
export const loanKindSymbol: Record<LoanKind, string> = {
  mortgage: 'house.circle.fill',
  car_loan: 'car.fill',
  consumer_loan: 'cart.fill',
  personal: 'person.fill',
};

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
// gets a glyph rather than a blank tile. A loan's kind is read leniently too
// (`loanKindOf`); one with no valid kind shows the loan type's own glyph. A
// stored type this build has no descriptor for (a removed type's row) gets the
// generic holding glyph: an undefined symbol reaches the native symbol view as
// a null prop and crashes.
export const defaultHoldingSymbol = (holding: Pick<HoldingRow, 'type' | 'metadata'>): string =>
  match(holding.type)
    .with('property_item', () => propertyCategorySymbol[propertyCategoryOf(holding.metadata)])
    .with(
      'loan',
      () =>
        foldMap(maybe(loanKindOf(holding.metadata)), (kind) => loanKindSymbol[kind]) ??
        holdingTypeSymbol.loan,
    )
    .otherwise(
      () => holdingDescriptorOrUndefined(holding.type)?.symbol ?? genericEntitySymbol.holding,
    );

// The GENERIC entity glyphs — TYPE-agnostic references used for headings, empty
// states, and section labels, NOT a per-entity user-chosen icon and NOT the
// per-kind/type defaults above. They MUST NOT override an icon the user chose.
// `holding` uses `text.pad.header`, an iOS-26 symbol: SymbolIcon renders its
// `list.bullet.rectangle` fallback centrally on an older device (see
// symbol.availability.ts). Each also leads its entity's footer "Add …" button,
// so the add action and the entity it creates read as the same thing.
export const genericEntitySymbol = {
  account: 'tray',
  holding: 'text.pad.header',
  transaction: 'arrow.up.arrow.down',
  category: 'tag',
} as const;

// The iOS-15.1-safe fallback for any generic glyph that is an iOS-26 symbol,
// exported alongside so a consumer rendering the glyph OUTSIDE SymbolIcon can
// pass it explicitly. Only `holding` needs one today.
export const genericEntitySymbolFallback: Partial<
  Record<keyof typeof genericEntitySymbol, string>
> = {
  holding: 'list.bullet.rectangle',
};
