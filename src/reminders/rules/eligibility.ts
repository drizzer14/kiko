import { match } from 'ts-pattern';
import type { AccountRow } from '@kiko/db';
import { isSyncedAccount } from '@kiko/holdings/deletable';
import { type ReminderKind, reminderKinds } from '@kiko/reminders/schedule';

// Only a bank account can import a statement, so an import reminder anywhere
// else would open a page with nothing to import. It needs no import yet, and
// a synced bank still takes one. Add-transactions reminders are for accounts
// no sync fills.
export const eligibleReminderKinds = (
  account: Pick<AccountRow, 'institution' | 'kind'>,
): ReminderKind[] =>
  reminderKinds.filter((kind) =>
    match(kind)
      .with('statement_import', () => account.kind === 'bank')
      .with('add_transactions', () => !isSyncedAccount(account))
      .exhaustive(),
  );
