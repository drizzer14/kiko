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

// A daily reminder as the restore stores it: started now, though the backup is
// two months old and no response came since.
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
    NOW,
  );
  replaceRequests.mockReset().mockResolvedValue(undefined);
  dateNow = jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  dateNow.mockRestore();
});

describe('replanRestoredReminders', () => {
  it('would back-off pause the reminder if the restore had kept the backup start', async () => {
    run('UPDATE reminders SET active_since = ?', BACKED_UP_AT);

    await syncReminders(i18n.t);

    expect(stored().pause_reason).toBe('backoff');
  });

  it('plans the restored reminder, which the restore started from now', async () => {
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
});
