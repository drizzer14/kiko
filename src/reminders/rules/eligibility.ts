import { match } from 'ts-pattern';
import type { AccountRow } from '@kiko/db';
import { isSyncedAccount } from '@kiko/holdings/deletable';
import { type ReminderKind, reminderKinds } from '@kiko/reminders/schedule';

// Import reminders are for every account, synced ones and ones with no import
// yet included; add-transactions reminders are for accounts no sync fills.
export const eligibleReminderKinds = (account: Pick<AccountRow, 'institution'>): ReminderKind[] =>
  reminderKinds.filter((kind) =>
    match(kind)
      .with('statement_import', () => true)
      .with('add_transactions', () => !isSyncedAccount(account))
      .exhaustive(),
  );
