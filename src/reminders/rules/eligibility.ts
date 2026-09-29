import { match } from 'ts-pattern';
import type { AccountRow } from '@kiko/db';
import { isSyncedAccount } from '@kiko/holdings/deletable';
import { type ReminderKind, reminderKinds } from '@kiko/reminders/schedule';

// Import reminders need a statement import on the account, synced accounts
// included; add-transactions reminders are for accounts no sync fills.
export const eligibleReminderKinds = (
  account: Pick<AccountRow, 'institution'>,
  hasImport: boolean,
): ReminderKind[] =>
  reminderKinds.filter((kind) =>
    match(kind)
      .with('statement_import', () => hasImport)
      .with('add_transactions', () => !isSyncedAccount(account))
      .exhaustive(),
  );
