// A restore on a real, fully migrated `node:sqlite` engine, through the real
// re-plan; only the native module is stubbed, so each test sees what would
// reach iOS and what the re-plan stores.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { i18n } from '@kiko/i18n/init';
import { DatabaseSync } from 'node:sqlite';
import { remindersRepo } from '@kiko/reminders/repo';
import { waitFor } from '@testing-library/react-native';
import { remindersNative } from '@kiko/reminders/native';
import { syncReminders } from '@kiko/reminders/scheduler';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { replanRestoredReminders } from './replan-restored-reminders';

const NOW = new Date(2026, 9, 1, 12, 0).getTime();
const BACKED_UP_AT = new Date(2026, 7, 1, 12, 0).getTime();

const replaceRequests = jest.spyOn(remindersNative, 'replaceRequests');

jest.spyOn(remindersNative, 'drainResponses').mockResolvedValue([]);
jest.spyOn(remindersNative, 'authorizationStatus').mockResolvedValue('authorized');

const run = (statement: string, ...parameters: (string | number | null)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const stored = (): { active_since: number; pause_reason: string | null } =>
  mockDatabase.prepare('SELECT active_since, pause_reason FROM reminders').get() as {
    active_since: number;
    pause_reason: string | null;
  };

const scheduledIds = (): string[] => [
  ...new Set((replaceRequests.mock.calls.at(-1)?.[0] ?? []).map(({ reminderId }) => reminderId)),
];

let dateNow: jest.SpyInstance;

// A two-month-old daily reminder with no response since, as a restore brings
// it in: every evening since the backup would read as ignored.
beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  run('INSERT INTO settings (id, notifications_deliverable_since) VALUES (1, ?)', BACKED_UP_AT);
  run("INSERT INTO accounts (id, name, kind) VALUES ('cash', 'Cash', 'cash')");
  run(
    'INSERT INTO reminders (id, account_id, kind, schedule, active_since) VALUES (?, ?, ?, ?, ?)',
    'reminder-1',
    'cash',
    'add_transactions',
    JSON.stringify({ frequency: 'daily', minuteOfDay: 20 * 60 }),
    BACKED_UP_AT,
  );
  replaceRequests.mockReset().mockResolvedValue(undefined);
  dateNow = jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  dateNow.mockRestore();
});

describe('replanRestoredReminders', () => {
  it('would back-off pause the restored reminder if its count were not restarted', async () => {
    await syncReminders(i18n.t);

    expect(stored().pause_reason).toBe('backoff');
  });

  it('restarts the ignored count before the re-plan, so the restored reminder stays scheduled', async () => {
    await replanRestoredReminders();

    await waitFor(() => expect(replaceRequests).toHaveBeenCalledTimes(2));
    expect(stored()).toEqual({ active_since: NOW, pause_reason: null });
    expect(scheduledIds()).toEqual(['reminder-1']);
  });

  // On the same phone, a snooze from before an older backup is still pending
  // while the restored row knows nothing of it, so it would fire beside the
  // regular reminder at the same minute.
  it('drops every pending request, snoozes included, before the re-plan', async () => {
    await replanRestoredReminders();

    await waitFor(() => expect(replaceRequests).toHaveBeenCalledTimes(2));
    expect(replaceRequests.mock.calls[0]).toEqual([[], []]);
  });

  // On a new phone, a restored snooze has no request here, so the slot it
  // held free would fire nothing.
  it('forgets a restored snooze and plans the occurrence it held free', async () => {
    run('UPDATE reminders SET last_snoozed_at = ?', new Date(2026, 9, 1, 9, 0).getTime());

    await replanRestoredReminders();

    await waitFor(() => expect(replaceRequests).toHaveBeenCalledTimes(2));
    expect(
      (replaceRequests.mock.calls.at(-1)?.[0] ?? []).map(({ identifier }) => identifier),
    ).toEqual([
      'kiko.reminder.reminder-1.202610012000',
      'kiko.reminder.reminder-1.202610022000',
      'kiko.reminder.reminder-1.202610032000',
      'kiko.reminder.reminder-1.paused',
    ]);
  });

  it('logs a failed drop and still re-plans', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    replaceRequests.mockRejectedValueOnce(new Error('native SECRET'));

    await expect(replanRestoredReminders()).resolves.toBeUndefined();

    await waitFor(() => expect(replaceRequests).toHaveBeenCalledTimes(2));
    expect(warn).toHaveBeenCalledWith('[reminders] re-plan failed', {
      name: 'Error',
      code: undefined,
    });
    expect(scheduledIds()).toEqual(['reminder-1']);

    warn.mockRestore();
  });

  it('still re-plans when the restart fails, and never rejects', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const restart = jest
      .spyOn(remindersRepo, 'restartAfterRestore')
      .mockRejectedValue(new Error('disk full SECRET'));

    await expect(replanRestoredReminders()).resolves.toBeUndefined();

    await waitFor(() => expect(replaceRequests).toHaveBeenCalledTimes(2));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[reminders] re-plan failed', {
      name: 'Error',
      code: undefined,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');

    restart.mockRestore();
    warn.mockRestore();
  });
});
