import type { AccountRow, HoldingRow } from '../db/schema';

// Runtime tuple mirroring the `holdings.type` enum in db/schema.ts. The
// `satisfies` ties it to the schema: adding a type to the schema enum is a
// compile error here until this list is updated, and vice versa. The form's
// type chips and the account->type filter below both read from this one list
// rather than re-declaring the set.
export const holdingTypes = [
  'card',
  'term_deposit',
  'bond',
  'cash',
  'crypto_asset',
  'jar',
] as const satisfies readonly HoldingRow['type'][];

export type HoldingType = (typeof holdingTypes)[number];

type AccountKind = AccountRow['kind'];

// The holding types a given account kind may contain. A holding lives under an
// account, so its type is constrained by that account's kind: a bank account
// holds cards/deposits/bonds/jars but never physical cash or a crypto asset; a
// cash stash holds only cash; a crypto wallet holds only crypto assets; a
// broker holds interest/coupon instruments and (for crypto brokers) crypto
// assets. The holding form filters its type chips through this map by the
// account's kind so an impossible pairing can never be created.
export const holdingTypesForAccountKind: Record<AccountKind, readonly HoldingType[]> = {
  bank: ['card', 'term_deposit', 'bond', 'jar'],
  cash: ['cash'],
  crypto: ['crypto_asset'],
  broker: ['term_deposit', 'bond', 'crypto_asset'],
};
