// src/data-transfer/snapshot/with-implicit-accounts-merged.ts
import {
  IMPLICIT_ACCOUNT_STORED_NAME,
  implicitAccountKinds,
  isImplicitAccount,
} from '@kiko/holdings/implicit-account';
import maybe, { foldMap } from 'fnts/maybe';
import type { AccountRow, HoldingRow, ReminderRow, SettingsRow, SyncStateRow } from '@kiko/db';

type AccountFields = Pick<
  AccountRow,
  'id' | 'kind' | 'name' | 'icon' | 'color' | 'sortOrder' | 'archivedAt' | 'createdAt'
>;
type HoldingFields = Pick<HoldingRow, 'id' | 'accountId' | 'sortOrder' | 'createdAt'>;
type ReminderFields = Pick<ReminderRow, 'id' | 'accountId' | 'kind' | 'createdAt'>;
type SettingsFields = Pick<SettingsRow, 'reminderOfferDismissals'>;
type SyncStateFields = Pick<SyncStateRow, 'accountId'>;

type Dismissals = NonNullable<SettingsFields['reminderOfferDismissals']>;

// Orders rows by each key in turn. `<` and `>` on text match SQLite's BINARY
// collation for ASCII and UUID ids, which the migration's ORDER BY compares;
// `localeCompare` would order 'B' after 'a'.
const byKeys =
  <Row>(keys: (row: Row) => (number | string)[]) =>
  (left: Row, right: Row): number => {
    const rightKeys = keys(right);

    for (const [position, leftKey] of keys(left).entries()) {
      const rightKey = rightKeys[position];

      if (leftKey !== rightKey) {
        return leftKey < rightKey ? -1 : 1;
      }
    }

    return 0;
  };

type RankedHolding<Holding extends HoldingFields> = { holding: Holding; rank: number };

const byAge = byKeys((account: AccountFields) => [
  account.createdAt,
  account.sortOrder,
  account.id,
]);

const bySection = byKeys((account: AccountFields) => [
  account.sortOrder,
  account.createdAt,
  account.id,
]);

const byHoldingOrder = byKeys((entry: RankedHolding<HoldingFields>) => [
  entry.rank,
  entry.holding.sortOrder,
  entry.holding.createdAt,
  entry.holding.id,
]);

const byReminderAge = byKeys((reminder: ReminderFields) => [reminder.createdAt, reminder.id]);

type Member = { keptId: string; rank: number };

// The accounts of a kind with more than one live account, each mapped to the
// account it merges into (the oldest: `created_at`, `sort_order`, `id`) and its
// position in the old section order (`sort_order`, `created_at`, `id`).
const mergeMembers = <Account extends AccountFields>(
  snapshotAccounts: Account[],
): Map<string, Member> => {
  const members = new Map<string, Member>();

  for (const kind of implicitAccountKinds) {
    const live = snapshotAccounts.filter(
      (account) => isImplicitAccount(account) && account.kind === kind,
    );

    if (live.length < 2) {
      continue;
    }

    const keptId = live.reduce((oldest, account) =>
      byAge(account, oldest) < 0 ? account : oldest,
    ).id;

    for (const [rank, account] of live.sort(bySection).entries()) {
      members.set(account.id, { keptId, rank });
    }
  }

  return members;
};

// Every holding of a merged account goes to the kept account and is numbered
// 0..n-1 in the old visible order: the accounts in section order, then each
// account's own order.
const holdingsMergedInto = <Holding extends HoldingFields>(
  snapshotHoldings: Holding[],
  members: Map<string, Member>,
): Holding[] => {
  const byKeptId = new Map<string, RankedHolding<Holding>[]>();

  for (const holding of snapshotHoldings) {
    const member = members.get(holding.accountId);

    if (member === undefined) {
      continue;
    }

    const bucket = byKeptId.get(member.keptId) ?? [];

    bucket.push({ holding, rank: member.rank });
    byKeptId.set(member.keptId, bucket);
  }

  const placed = new Map<string, Holding>();

  for (const [keptId, bucket] of byKeptId) {
    for (const [position, entry] of bucket.sort(byHoldingOrder).entries()) {
      placed.set(entry.holding.id, { ...entry.holding, accountId: keptId, sortOrder: position });
    }
  }

  return snapshotHoldings.map((holding) => placed.get(holding.id) ?? holding);
};

// Per (kept account, reminder kind) only the earliest-created reminder (ties by
// id) survives, re-pointed to the kept account with the rest of its own state
// as it was. The others go, so no two reminders of one kind share an account.
const remindersMergedInto = <Reminder extends ReminderFields>(
  snapshotReminders: Reminder[],
  members: Map<string, Member>,
): Reminder[] => {
  const byKeptIdAndKind = new Map<string, { keptId: string; reminders: Reminder[] }>();

  for (const reminder of snapshotReminders) {
    const member = members.get(reminder.accountId);

    if (member === undefined) {
      continue;
    }

    const groupKey = JSON.stringify([member.keptId, reminder.kind]);
    const group = byKeptIdAndKind.get(groupKey) ?? { keptId: member.keptId, reminders: [] };

    group.reminders.push(reminder);
    byKeptIdAndKind.set(groupKey, group);
  }

  // A survivor maps to the account it moves to, a reminder that is dropped maps to null.
  const placement = new Map<string, string | null>();

  for (const { keptId, reminders } of byKeptIdAndKind.values()) {
    for (const [position, reminder] of reminders.sort(byReminderAge).entries()) {
      placement.set(reminder.id, position === 0 ? keptId : null);
    }
  }

  return snapshotReminders.flatMap((reminder) => {
    const keptId = placement.get(reminder.id);

    if (keptId === undefined) {
      return [reminder];
    }

    if (keptId === null) {
      return [];
    }

    return [{ ...reminder, accountId: keptId }];
  });
};

// The kept account's entry is the union of the kinds dismissed on every merged
// account; the merged-away keys go. An entry with an empty kind list drops out,
// as it does in the migration's `json_each` join.
const dismissalsMergedInto = (dismissals: Dismissals, members: Map<string, Member>): Dismissals => {
  const kindsByKey = new Map<string, Set<ReminderRow['kind']>>();

  for (const [accountId, kinds] of Object.entries(dismissals)) {
    if (kinds.length === 0) {
      continue;
    }

    const key = members.get(accountId)?.keptId ?? accountId;
    const union = kindsByKey.get(key) ?? new Set<ReminderRow['kind']>();

    for (const kind of kinds) {
      union.add(kind);
    }

    kindsByKey.set(key, union);
  }

  return Object.fromEntries([...kindsByKey].map(([key, union]) => [key, [...union]]));
};

// A kept account that absorbed others takes the stored sentinel name and the
// kind's default icon and color, so one custom name or glyph picked for one
// former account never stands for all of them. An account that merged nothing
// keeps what its user chose. Migration 0050 resets EVERY live implicit account
// instead, because it ran once, before a user could rename one (and it is
// applied on devices, so its SQL is never edited); a restore runs after
// renaming exists, so a lone account's name, icon and color must survive it.
const withDefaultIdentity = <Account extends AccountFields>(
  snapshotAccounts: Account[],
  members: Map<string, Member>,
): Account[] =>
  snapshotAccounts.map((account) =>
    isImplicitAccount(account) && members.has(account.id)
      ? { ...account, name: IMPLICIT_ACCOUNT_STORED_NAME[account.kind], icon: null, color: null }
      : account,
  );

type MergeRows<
  Account extends AccountFields,
  Holding extends HoldingFields,
  Reminder extends ReminderFields,
  Settings extends SettingsFields,
  SyncState extends SyncStateFields,
> = {
  accounts: Account[];
  holdings: Holding[];
  reminders: Reminder[];
  settings: Settings[];
  syncState: SyncState[];
};

/**
 * Migration 0050's rule (`drizzle/migrations/0050_implicit_property_debt_accounts.sql`'s
 * doc comment states the merge rule; for name, icon and color see
 * `withDefaultIdentity` above), applied to a `.kiko` restore: a
 * kind with several LIVE property or debt accounts merges into its oldest one,
 * because the partial unique index `accounts_implicit_kind` would otherwise
 * refuse the insert. An archived account is outside the merge, the same as in
 * the migration. Fed the rows the earlier mirrors produced, the order a live
 * device runs 0044, 0049, then 0050.
 *
 * A stray `sync_state` row of a merged-away account is dropped with it, as the
 * migration does, since its foreign key would otherwise fail the insert.
 *
 * Unlike the migration, which resets every live implicit account's identity
 * (it ran once, before a user could rename one), a restore keeps the name, icon
 * and color a user gave an implicit account, and applies the default identity
 * (the sentinel name, no icon or color) only to a kept account that absorbed
 * others. A snapshot where no kind has more than one live account returns the
 * SAME array references, a true no-op: that is an export from this build, or a
 * second restore of the same file.
 */
export const withImplicitAccountsMerged = <
  Account extends AccountFields,
  Holding extends HoldingFields,
  Reminder extends ReminderFields,
  Settings extends SettingsFields,
  SyncState extends SyncStateFields,
>(
  rows: MergeRows<Account, Holding, Reminder, Settings, SyncState>,
): MergeRows<Account, Holding, Reminder, Settings, SyncState> => {
  const members = mergeMembers(rows.accounts);

  if (members.size === 0) {
    return rows;
  }

  const isMergedAway = (accountId: string): boolean =>
    (members.get(accountId)?.keptId ?? accountId) !== accountId;

  return {
    accounts: withDefaultIdentity(
      rows.accounts.filter((account) => !isMergedAway(account.id)),
      members,
    ),
    holdings: holdingsMergedInto(rows.holdings, members),
    reminders: remindersMergedInto(rows.reminders, members),
    settings: rows.settings.map(
      (row) =>
        foldMap(maybe(row.reminderOfferDismissals), (dismissals) => ({
          ...row,
          reminderOfferDismissals: dismissalsMergedInto(dismissals, members),
        })) ?? row,
    ),
    syncState: rows.syncState.filter((row) => !isMergedAway(row.accountId)),
  };
};
