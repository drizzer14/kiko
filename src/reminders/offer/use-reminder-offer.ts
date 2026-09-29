import { useState } from 'react';
import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { accountsRepo } from '@kiko/accounts';
import { remindersRepo } from '@kiko/reminders/repo';
import { useDataReady, useLiveQuery } from '@kiko/db';
import type { ReminderKind } from '@kiko/reminders/schedule';
import { eligibleReminderKinds } from '@kiko/reminders/rules';
import { isReminderOfferDismissed, settingsRepo } from '@kiko/settings';

export type ReminderOfferTrigger = 'afterImport' | 'manualActivity';

type ReminderOffer = { kind: ReminderKind; accept: () => void; dismiss: () => Promise<void> };

type ReminderFormOpener = (form: { accountId: string; kind: ReminderKind }) => void;

const MANUAL_ACTIVITY_DAYS = 30;
const MANUAL_ACTIVITY_ENTRIES = 2;

// From the start of a local calendar day, so the window is stable for the
// whole day and a DST change inside it moves nothing.
const manualActivitySince = (now: number): number => {
  const today = new Date(now);

  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - MANUAL_ACTIVITY_DAYS,
  ).getTime();
};

const kindOf = (trigger: ReminderOfferTrigger): ReminderKind =>
  match(trigger)
    .returnType<ReminderKind>()
    .with('afterImport', () => 'statement_import')
    .with('manualActivity', () => 'add_transactions')
    .exhaustive();

/**
 * The in-app offer to set up a reminder, after an import or on the second
 * manual entry in 30 days. It shows only while the account can have that
 * kind, has none yet, and the user has not dismissed it there. The trigger's
 * own read waits for that, so a decided offer costs no transactions read, and
 * a synced account never reads its manual entries.
 */
export const useReminderOffer = (
  accountId: string,
  trigger: ReminderOfferTrigger,
  openForm: ReminderFormOpener,
): ReminderOffer | undefined => {
  const kind = kindOf(trigger);
  const [since] = useState(() => manualActivitySince(Date.now()));
  const { data: accounts, isLoading: accountLoading } = useLiveQuery(
    accountsRepo.byIdQuery(accountId),
    ['accounts'],
    true,
    { cached: true },
  );
  const { data: reminders, isLoading: remindersLoading } = useLiveQuery(
    remindersRepo.listByAccountQuery(accountId),
    ['reminders'],
    true,
    { cached: true },
  );
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    true,
    { cached: true },
  );
  const accountReady = useDataReady(accountLoading, remindersLoading, settingsLoading);
  const account = accounts.at(0);
  const dismissed =
    foldMap(maybe(settingsRows.at(0)), (settingsRow) =>
      isReminderOfferDismissed(settingsRow, accountId, kind),
    ) ?? false;
  const undecided =
    accountReady &&
    account !== undefined &&
    !reminders.some((reminder) => reminder.kind === kind) &&
    !dismissed;
  const { data: imports, isLoading: importLoading } = useLiveQuery(
    remindersRepo.hasImportQuery(accountId),
    ['transactions', 'holdings'],
    undecided && trigger === 'afterImport',
    { cached: true },
  );
  const eligible = (
    foldMap(maybe(account), (found) => eligibleReminderKinds(found, imports.length > 0)) ?? []
  ).includes(kind);
  const { data: manualEntries, isLoading: manualEntriesLoading } = useLiveQuery(
    remindersRepo.manualEntryDaysQuery(accountId, since),
    ['transactions', 'holdings'],
    undecided && trigger === 'manualActivity' && eligible,
    { cached: true },
  );
  const triggerReady = useDataReady(importLoading, manualEntriesLoading);
  const triggered = match(trigger)
    .with('afterImport', () => true)
    .with('manualActivity', () => (manualEntries.at(0)?.entries ?? 0) >= MANUAL_ACTIVITY_ENTRIES)
    .exhaustive();

  if (!(undecided && triggerReady && eligible && triggered)) {
    return undefined;
  }

  return {
    kind,
    accept: () => openForm({ accountId, kind }),
    dismiss: () => settingsRepo.dismissReminderOffer(accountId, kind),
  };
};
