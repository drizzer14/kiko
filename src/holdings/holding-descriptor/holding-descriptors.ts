import type { HoldingType } from '../holding-type';

import { loanDescriptor } from './loan';
import { bondDescriptor } from './bond';
import { metalDescriptor } from './metal';
import { termDepositDescriptor } from './term-deposit';
import { propertyItemDescriptor } from './property-item';
import type { HoldingDescriptor } from './holding-descriptor.d';
import { cardDescriptor, cashDescriptor, cryptoAssetDescriptor, jarDescriptor } from './balance';

// The ONE place every holding type's descriptor is looked up. The `satisfies
// Record<HoldingType, HoldingDescriptor>` gives a compile error the moment a
// new holding type is added to the schema without a descriptor here — the
// same exhaustiveness `holdingTypes` already gives the type chips/account-kind
// map.
export const holdingDescriptors = {
  card: cardDescriptor,
  term_deposit: termDepositDescriptor,
  bond: bondDescriptor,
  cash: cashDescriptor,
  crypto_asset: cryptoAssetDescriptor,
  jar: jarDescriptor,
  property_item: propertyItemDescriptor,
  metal: metalDescriptor,
  loan: loanDescriptor,
} as const satisfies Record<HoldingType, HoldingDescriptor>;

export const holdingDescriptor = (type: HoldingType): HoldingDescriptor => holdingDescriptors[type];

/**
 * A lookup safe for a `type` read straight off a stored row: the schema types
 * `holdings.type` as this exact enum, but SQLite enforces no such constraint,
 * so a corrupted row could hold any string. Returns `undefined` instead of
 * throwing, matching the pre-registry `ts-pattern` dispatches' `.otherwise()`
 * tolerance for a malformed/absent type.
 */
export const holdingDescriptorOrUndefined = (type: HoldingType): HoldingDescriptor | undefined =>
  (holdingDescriptors as Record<string, HoldingDescriptor>)[type];
