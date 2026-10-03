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

// The fixed English sentinel stored in `accounts.name` for an UNRENAMED implicit
// account (migration 0050 and every implicit create write it). It stands for
// "the localized kind name": nothing reads it back to detect an implicit
// account (the kind decides), and every display site goes through
// `accountDisplayName`, which shows the localized name for it. Once the user
// types another name, that name is stored and shown as it is. The same
// precedent as the seeded categories' English seed titles (kiko-translator).
export const IMPLICIT_ACCOUNT_STORED_NAME: Record<ImplicitAccountKind, string> = {
  property: 'Properties',
  debt: 'Loans',
};

// The name every screen shows for an account: the stored name, except a live
// implicit account still holding its kind's sentinel (or a blank name, which
// no form writes) shows the localized kind name. Only the account's OWN kind's
// sentinel counts as the default: the other kind's sentinel typed by the user
// is just a name.
export const accountDisplayName = (
  account: Pick<AccountRow, 'kind' | 'name' | 'archivedAt'>,
  t: TFunction,
): string =>
  isImplicitAccount(account) &&
  (account.name.trim() === '' || account.name === IMPLICIT_ACCOUNT_STORED_NAME[account.kind])
    ? t(`accounts.implicitName.${account.kind}`)
    : account.name;

// What the account form stores for the name it holds: the kind's sentinel when
// the name is that sentinel or the localized default (the form shows the
// localized one, so an untouched name must stay "unrenamed" in either
// language), else the trimmed name as typed.
export const implicitAccountStoredName = (
  kind: ImplicitAccountKind,
  typedName: string,
  t: TFunction,
): string => {
  const trimmed = typedName.trim();

  return trimmed === t(`accounts.implicitName.${kind}`)
    ? IMPLICIT_ACCOUNT_STORED_NAME[kind]
    : trimmed;
};
