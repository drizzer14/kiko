import { useState } from 'react';
import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { remindersRepo } from '@kiko/reminders/repo';
import type { ReminderKind } from '@kiko/reminders/schedule';
import { eligibleReminderKinds } from '@kiko/reminders/rules';
import { isReminderOfferDismissed, settingsRepo } from '@kiko/settings';
import { type AccountRow, type SettingsRow, useDataReady, useLiveQuery } from '@kiko/db';

export type ReminderOfferTrigger = 'afterImport' | 'manualActivity';

type ReminderOffer = { kind: ReminderKind; dismiss: () => Promise<void> };

// The page's own account and settings rows, `undefined` while its reads load:
// a second subscription here would queue the same reads again on op-sqlite's
// one worker.
type ReminderOfferInput = {
  accountId: string;
  account: AccountRow | undefined;
  settings: SettingsRow | undefined;
  trigger: ReminderOfferTrigger;
};

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
 * manual entry in 30 days. It shows only while the account is not archived
 * (its reminder would never be sent), can have that kind, has none yet, and
 * the user has not dismissed it there. The trigger's own read waits for that,
 * so a decided offer costs no transactions read, and a synced account never
 * reads its manual entries.
 */
export const useReminderOffer = ({
  accountId,
  account,
  settings,
  trigger,
}: ReminderOfferInput): ReminderOffer | undefined => {
  const kind = kindOf(trigger);
  const [since] = useState(() => manualActivitySince(Date.now()));
  const { data: reminders, isLoading: remindersLoading } = useLiveQuery(
    remindersRepo.listByAccountQuery(accountId),
    ['reminders'],
    true,
    { cached: true },
  );
  const remindersReady = useDataReady(remindersLoading);
  const dismissed =
    foldMap(maybe(settings), (settingsRow) =>
      isReminderOfferDismissed(settingsRow, accountId, kind),
    ) ?? false;
  const undecided =
    remindersReady &&
    settings !== undefined &&
    account !== undefined &&
    account.archivedAt === null &&
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

  return { kind, dismiss: () => settingsRepo.dismissReminderOffer(accountId, kind) };
};
