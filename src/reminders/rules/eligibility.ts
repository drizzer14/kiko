import { match } from 'ts-pattern';
import type { AccountRow } from '@kiko/db';
import { isSyncedAccount } from '@kiko/holdings/deletable';
import { type ReminderKind, reminderKinds } from '@kiko/reminders/schedule';

// Only a bank account no sync owns can import a statement, so an import
// reminder anywhere else would open a page with nothing to import. It needs
// no import yet. Add-transactions reminders are for accounts no sync fills.
export const eligibleReminderKinds = (
  account: Pick<AccountRow, 'institution' | 'kind'>,
): ReminderKind[] =>
  reminderKinds.filter((kind) =>
    match(kind)
      .with('statement_import', () => account.kind === 'bank' && !isSyncedAccount(account))
      .with('add_transactions', () => !isSyncedAccount(account))
      .exhaustive(),
  );
