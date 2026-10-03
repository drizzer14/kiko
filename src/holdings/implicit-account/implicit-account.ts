import type { TFunction } from 'i18next';
import type { AccountRow } from '@kiko/db';

export const implicitAccountKinds = [
  'property',
  'debt',
] as const satisfies readonly AccountRow['kind'][];

export type ImplicitAccountKind = (typeof implicitAccountKinds)[number];

export const isImplicitAccountKind = (kind: AccountRow['kind']): kind is ImplicitAccountKind =>
  (implicitAccountKinds as readonly AccountRow['kind'][]).includes(kind);

// A live (non-archived) property/debt account is THE implicit account of its
// kind: the partial unique index `accounts_implicit_kind` (migration 0050, in
// `src/db/schema.ts`) allows at most one per kind. An archived one is a plain
// account that the index and every merge leave alone.
export const isImplicitAccount = <Account extends Pick<AccountRow, 'kind' | 'archivedAt'>>(
  account: Account,
): account is Account & { kind: ImplicitAccountKind; archivedAt: null } =>
  isImplicitAccountKind(account.kind) && account.archivedAt === null;

// The fixed English sentinel stored in `accounts.name` for an implicit account
// (migration 0050 and every implicit create write it). Nothing reads it back to
// detect an implicit account (the kind decides), and every display site goes
// through `accountDisplayName`, so it only shows where a site misses that, or
// in an older build that restores a newer `.kiko`. The same precedent as the
// seeded categories' English seed titles (kiko-translator).
export const IMPLICIT_ACCOUNT_STORED_NAME: Record<ImplicitAccountKind, string> = {
  property: 'Properties',
  debt: 'Loans',
};

// The name every screen shows for an account: the localized kind name for an
// implicit account (its stored `name` is only the sentinel), the stored name
// for any other.
export const accountDisplayName = (
  account: Pick<AccountRow, 'kind' | 'name' | 'archivedAt'>,
  t: TFunction,
): string =>
  isImplicitAccount(account) ? t(`accounts.implicitName.${account.kind}`) : account.name;
