import type { AccountRow, HoldingRow } from '../../db/schema';

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
// cash stash holds only cash; a crypto wallet holds only crypto assets. The
// holding form filters its type chips through this map by the account's kind so
// an impossible pairing can never be created. This is the FULL set (used for
// edit mode and as the source for the create-only subset below).
export const holdingTypesForAccountKind: Record<AccountKind, readonly HoldingType[]> = {
  bank: ['card', 'term_deposit', 'bond', 'jar'],
  cash: ['cash'],
  crypto: ['crypto_asset'],
};

// The holding types the Monobank sync pipeline OWNS: it creates a `card` per
// bank card and a `jar` per jar programmatically (see src/monobank/sync.ts), so
// a user never manually creates one. The manual create form drops these from its
// options; editing an existing synced row still works (its type is read-only and
// stays whatever the sync wrote).
export const syncOnlyHoldingTypes = ['card', 'jar'] as const satisfies readonly HoldingType[];

export const isSyncOnlyHoldingType = (type: HoldingType): boolean =>
  (syncOnlyHoldingTypes as readonly HoldingType[]).includes(type);

// The holding types a transaction row must NOT stamp with a time-of-day: a
// term_deposit contribution and a bond purchase/coupon/redemption are
// day-granular events, not moment-in-time movements, so their rows show the
// date only (Home drops the HH:MM entirely; Holding Detail renders the date
// without the trailing time). Every other type keeps its HH:MM stamp.
export const isTimeExemptHoldingType = (type: HoldingType): boolean =>
  type === 'term_deposit' || type === 'bond';

// The holding types a user may MANUALLY CREATE under a given account kind AND
// synced state: the kind's full set minus whichever sync-only types that
// PARTICULAR account has a sync owning.
//
// `jar` is ALWAYS excluded, synced or not: it is a Monobank-API-specific
// concept (a sub-account the Monobank API itself exposes) with no equivalent
// in a bank statement, so a statement-import account has nothing to name a
// manually-created "jar" after — keep it sync-only regardless of `isSynced`.
//
// `card` is different: it is sync-only ONLY because the Monobank sync
// pipeline auto-creates one per bank card for a LIVE-CONNECTED account. The 5
// import-only banks (`isSynced` false — no `accounts.institution`, see
// `isSyncedAccount` in `src/holdings/deletable/`) have no such sync, so a
// statement-import user needs to manually create the `card` holding their
// imported card transactions attach to — dropping it there left no holding
// type to use at all, which was the bug. `cash`/`crypto` are unaffected by
// `isSynced`: their single type is never sync-only.
export const creatableHoldingTypesForAccount = (
  kind: AccountKind,
  isSynced: boolean,
): readonly HoldingType[] =>
  holdingTypesForAccountKind[kind].filter((type) => {
    if (type === 'jar') {
      return false;
    }
    return !isSynced || !isSyncOnlyHoldingType(type);
  });
