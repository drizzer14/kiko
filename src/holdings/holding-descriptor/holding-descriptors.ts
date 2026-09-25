import { holdingTypes, type HoldingType } from '../holding-type';

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
 * so a corrupted row could hold any string — including an inherited
 * `Object.prototype` key such as `'constructor'` or `'toString'`, which a
 * plain index would resolve to a non-undefined value despite never being a
 * real holding type. `Object.hasOwn` checks the object's OWN keys only, so
 * those resolve to `undefined` too. Returns `undefined` instead of throwing,
 * matching the pre-registry `ts-pattern` dispatches' `.otherwise()` tolerance
 * for a malformed/absent type.
 */
export const holdingDescriptorOrUndefined = (type: HoldingType): HoldingDescriptor | undefined => {
  const descriptors = holdingDescriptors as Record<string, HoldingDescriptor>;

  return Object.hasOwn(descriptors, type) ? descriptors[type] : undefined;
};

// A transaction row must NOT stamp a term_deposit contribution or a bond
// purchase/coupon/redemption with a time-of-day: both are day-granular events,
// not moment-in-time movements (Home drops the HH:MM entirely; Holding Detail
// renders the date without the trailing time). Every other type keeps its
// HH:MM stamp. `holdingDescriptorOrUndefined`'s `?? false` keeps this safe for
// a malformed/absent type, mirroring the old direct `===` chain.
export const isTimeExemptHoldingType = (type: HoldingType): boolean =>
  holdingDescriptorOrUndefined(type)?.timeExempt ?? false;

// The holding types that write no manual ledger (transaction) rows at all —
// their value derives entirely from `lots` in metadata (kiko-domain), priced
// at read time. `isTransactionEligibleType` (transaction-form.screen.tsx)
// gates on this predicate rather than re-deriving its own type list; the
// detail footer's own `holdingDetailSpecs` (holding-detail-spec/) is a
// SEPARATE registry that must independently agree on the same set — held to
// it by `holding-detail-spec.test.ts`'s "agreement with
// isLedgerlessHoldingType" invariant test, not by sharing this predicate.
export const isLedgerlessHoldingType = (type: HoldingType): boolean =>
  holdingDescriptorOrUndefined(type)?.ledgerless ?? false;

// Reads one field off every type's descriptor into a `Record<HoldingType,
// Value>` — the shape `holdingTypeSymbol`/`defaultHoldingColor` publish today
// — built from the `holdingTypes` tuple rather than a second hand-written
// map, so those two stay in sync with the descriptors by construction. The
// cast is needed because `Object.fromEntries` widens its return type to
// `Record<string, Value>`; the object built here IS a `Record<HoldingType,
// Value>` because `holdingTypes` enumerates every member exactly once.
export const recordByType = <Value>(
  select: (descriptor: HoldingDescriptor) => Value,
): Record<HoldingType, Value> =>
  Object.fromEntries(
    holdingTypes.map((type) => [type, select(holdingDescriptors[type])]),
  ) as Record<HoldingType, Value>;
