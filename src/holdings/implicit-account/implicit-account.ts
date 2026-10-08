import type { TFunction } from 'i18next';
import type { AccountRow, HoldingRow } from '@kiko/db';

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

// The accounts the Home and Statistics account filters offer: every live
// (non-archived) account, except a live implicit account with no holding at
// all. Such an account (its last holding deleted) has nothing left to isolate:
// a holding's delete is hard and takes its transactions and price series with
// it, and a transaction can only hang off a holding (`transactions.holding_id`
// is NOT NULL), so no holding means no transaction either. One that still
// holds a CLOSED holding stays listed, because that holding's history still
// counts in the totals and must stay selectable. No total reads this list
// directly; a stored selection of a left-out account is pruned to All against
// it (that account holds nothing).
export const accountsForFilter = <Account extends Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>>(
  accounts: readonly Account[],
  holdings: readonly Pick<HoldingRow, 'accountId'>[],
): Account[] => {
  const accountIdsWithHoldings = new Set(holdings.map((holding) => holding.accountId));

  return accounts.filter(
    (account) =>
      account.archivedAt == null &&
      (!isImplicitAccount(account) || accountIdsWithHoldings.has(account.id)),
  );
};

// True when the user has nothing to show as an account: no live account of a
// kind other than property or debt, and no OPEN holding under a live implicit
// account. A live implicit account with nothing open (a new one, or one whose
// holdings are all closed) shows no section on the Accounts screen, so it
// counts as no account; one open flat or loan is something the user added.
export const hasNoAccounts = (
  accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>[],
  holdings: readonly Pick<HoldingRow, 'accountId' | 'closedAt'>[],
): boolean => {
  const liveAccounts = accounts.filter((account) => account.archivedAt == null);

  if (liveAccounts.some((account) => !isImplicitAccount(account))) {
    return false;
  }

  // Every live account left here is implicit.
  const liveAccountIds = new Set(liveAccounts.map((account) => account.id));

  return !holdings.some(
    (holding) => holding.closedAt == null && liveAccountIds.has(holding.accountId),
  );
};

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
