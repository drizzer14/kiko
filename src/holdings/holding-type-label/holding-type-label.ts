import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';

import {
  type LoanKind,
  type Metal,
  type PropertyCategory,
  asMetalMeta,
  loanKindOf,
  propertyCategoryOf,
} from '../holding-metadata';
import type { HoldingType } from '../holding-type';
import { holdingDescriptorOrUndefined } from '../holding-descriptor';

// The display name of each holding type. `forms.account.cash` is the one
// "Cash" string the catalog has, shared with the account kind of the same name.
export const holdingTypeName = (type: HoldingType, t: TFunction): string =>
  match<HoldingType, string>(type)
    .with('card', () => t('forms.holding.card'))
    .with('term_deposit', () => t('forms.holding.deposit'))
    .with('bond', () => t('forms.holding.bond'))
    .with('cash', () => t('forms.account.cash'))
    .with('crypto_asset', () => t('forms.holding.cryptoAsset'))
    .with('jar', () => t('forms.holding.jar'))
    .with('property_item', () => t('forms.holding.propertyItem'))
    .with('metal', () => t('forms.holding.metal'))
    .with('loan', () => t('forms.holding.loan'))
    .exhaustive();

const propertyCategoryName = (category: PropertyCategory, t: TFunction): string =>
  match<PropertyCategory, string>(category)
    .with('real_estate', () => t('forms.holding.propertyCategory.realEstate'))
    .with('vehicle', () => t('forms.holding.propertyCategory.vehicle'))
    .with('valuable', () => t('forms.holding.propertyCategory.valuable'))
    .with('business_share', () => t('forms.holding.propertyCategory.businessShare'))
    .with('loan_given', () => t('forms.holding.propertyCategory.loanGiven'))
    .with('other', () => t('forms.holding.propertyCategory.other'))
    .exhaustive();

const loanKindName = (kind: LoanKind, t: TFunction): string =>
  match<LoanKind, string>(kind)
    .with('mortgage', () => t('forms.holding.loanKind.mortgage'))
    .with('car_loan', () => t('forms.holding.loanKind.carLoan'))
    .with('consumer_loan', () => t('forms.holding.loanKind.consumerLoan'))
    .with('personal', () => t('forms.holding.loanKind.personal'))
    .exhaustive();

const metalName = (metal: Metal, t: TFunction): string =>
  match<Metal, string>(metal)
    .with('XAU', () => t('forms.holding.metalKind.gold'))
    .with('XAG', () => t('forms.holding.metalKind.silver'))
    .with('XPT', () => t('forms.holding.metalKind.platinum'))
    .with('XPD', () => t('forms.holding.metalKind.palladium'))
    .exhaustive();

// What the holding form's Type field shows for this holding, so a card names
// its type the way the form does: a property item by its category, a loan by
// its kind, a metal by its element, any other type by its own name. A loan
// with no valid kind, or a metal whose metadata does not parse, falls back to
// the type's own name. A stored type this build has no descriptor for (a
// removed type's row) has no label, and `holdingTypeName`'s exhaustive match
// would throw on it, so the descriptor lookup guards the whole thing.
export const holdingTypeLabel = (
  holding: Pick<HoldingRow, 'type' | 'metadata'>,
  t: TFunction,
): string | undefined =>
  foldMap(
    maybe(holdingDescriptorOrUndefined(holding.type)),
    () =>
      match(holding.type)
        .with('property_item', () => propertyCategoryName(propertyCategoryOf(holding.metadata), t))
        .with('loan', () =>
          foldMap(maybe(loanKindOf(holding.metadata)), (kind) => loanKindName(kind, t)),
        )
        .with('metal', () =>
          foldMap(maybe(asMetalMeta(holding.metadata)), ({ metal }) => metalName(metal, t)),
        )
        .otherwise(() => undefined) ?? holdingTypeName(holding.type, t),
  );
