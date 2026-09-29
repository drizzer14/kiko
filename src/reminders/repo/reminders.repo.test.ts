// Every query and write here runs on a real, fully migrated `node:sqlite`
// engine: the plan-input join and aggregates, and the NULL handling in the
// engagement write, are exactly what a fake handle would get wrong silently.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: jest.fn(client.write) };
});

import { write } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { remindersRepo } from './reminders.repo';

const DAILY = JSON.stringify({ frequency: 'daily', minuteOfDay: 1200 });
const ACTIVE_SINCE = new Date(2026, 8, 1, 12, 0).getTime();

type StoredReminder = {
  id: string;
  schedule: string;
  active_since: number;
  paused_at: number | null;
  pause_reason: string | null;
  last_engaged_at: number | null;
  last_snoozed_at: number | null;
  updated_at: number;
};

const openDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON');

  return database;
};

const insertAccount = (
  id: string,
  options: {
    name?: string;
    institution?: string | null;
    archivedAt?: number | null;
    sortOrder?: number;
  } = {},
): void => {
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution, archived_at, sort_order) VALUES (?, ?, 'bank', ?, ?, ?)",
    )
    .run(
      id,
      options.name ?? 'Account',
      options.institution ?? null,
      options.archivedAt ?? null,
      options.sortOrder ?? 0,
    );
};

const insertHolding = (id: string, accountId: string): void => {
  mockDatabase
    .prepare(
      "INSERT INTO holdings (id, account_id, name, type, currency) VALUES (?, ?, 'Card', 'card', 'UAH')",
    )
    .run(id, accountId);
};

const insertTransaction = (
  id: string,
  holdingId: string,
  source: string,
  createdAt: number,
): void => {
  mockDatabase
    .prepare(
      'INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id, created_at) VALUES (?, ?, -100, ?, ?, ?, ?)',
    )
    .run(id, holdingId, createdAt, source, id, createdAt);
};

const insertReminder = (
  id: string,
  accountId: string,
  kind: string,
  columns: Partial<
    Pick<StoredReminder, 'paused_at' | 'pause_reason' | 'last_engaged_at' | 'last_snoozed_at'>
  > = {},
): void => {
  mockDatabase
    .prepare(
      'INSERT INTO reminders (id, account_id, kind, schedule, active_since, paused_at, pause_reason, last_engaged_at, last_snoozed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      accountId,
      kind,
      DAILY,
      ACTIVE_SINCE,
      columns.paused_at ?? null,
      columns.pause_reason ?? null,
      columns.last_engaged_at ?? null,
      columns.last_snoozed_at ?? null,
    );
};

const storedReminder = (id: string): StoredReminder =>
  mockDatabase
    .prepare(
      'SELECT id, schedule, active_since, paused_at, pause_reason, last_engaged_at, last_snoozed_at, updated_at FROM reminders WHERE id = ?',
    )
    .get(id) as StoredReminder;

const reminderCount = (): number =>
  (mockDatabase.prepare('SELECT count(*) AS count FROM reminders').get() as { count: number })
    .count;

beforeEach(() => {
  mockDatabase = openDatabase();
  jest.mocked(write).mockClear();
});

describe('remindersRepo.hasAnyQuery', () => {
  it('finds nothing when there are no reminders', async () => {
    expect(await remindersRepo.hasAnyQuery()).toEqual([]);
  });

  it('reads at most one row, however many reminders exist', async () => {
    insertAccount('account-1');
    insertReminder('reminder-1', 'account-1', 'statement_import');
    insertReminder('reminder-2', 'account-1', 'add_transactions');

    expect(await remindersRepo.hasAnyQuery()).toHaveLength(1);
    expect(remindersRepo.hasAnyQuery().toSQL().sql).toMatch(/limit \?$/);
  });
});

describe('remindersRepo.planInputsQuery', () => {
  it('reads each reminder with its account state and parsed schedule', async () => {
    const archivedAt = new Date(2026, 8, 5).getTime();

    insertAccount('account-1', { institution: 'monobank', archivedAt });
    insertReminder('reminder-1', 'account-1', 'statement_import', {
      paused_at: 5,
      pause_reason: 'user',
      last_engaged_at: 6,
      last_snoozed_at: 7,
    });

    expect(await remindersRepo.planInputsQuery()).toEqual([
      {
        id: 'reminder-1',
        accountId: 'account-1',
        kind: 'statement_import',
        schedule: { frequency: 'daily', minuteOfDay: 1200 },
        pausedAt: 5,
        activeSince: ACTIVE_SINCE,
        lastEngagedAt: 6,
        lastSnoozedAt: 7,
        archivedAt,
        institution: 'monobank',
        lastImportAt: null,
        lastManualAt: null,
      },
    ]);
  });

  it('takes the latest import and manual entry times across every holding of the account', async () => {
    insertAccount('account-1');
    insertHolding('holding-1', 'account-1');
    insertHolding('holding-2', 'account-1');
    insertTransaction('import-old', 'holding-1', 'import', 1_000);
    insertTransaction('import-new', 'holding-2', 'import', 3_000);
    insertTransaction('manual-new', 'holding-1', 'manual', 2_000);
    insertTransaction('manual-old', 'holding-2', 'manual', 1_500);
    insertReminder('reminder-1', 'account-1', 'statement_import');
    insertReminder('reminder-2', 'account-1', 'add_transactions');

    const rows = await remindersRepo.planInputsQuery();

    expect(
      rows.map(({ id, lastImportAt, lastManualAt }) => ({ id, lastImportAt, lastManualAt })),
    ).toEqual([
      { id: 'reminder-1', lastImportAt: 3_000, lastManualAt: 2_000 },
      { id: 'reminder-2', lastImportAt: 3_000, lastManualAt: 2_000 },
    ]);
  });

  it('ignores synced entries and the transactions of other accounts', async () => {
    insertAccount('account-1');
    insertAccount('account-2');
    insertHolding('holding-1', 'account-1');
    insertHolding('holding-2', 'account-2');
    insertTransaction('synced', 'holding-1', 'monobank', 9_000);
    insertTransaction('other-import', 'holding-2', 'import', 8_000);
    insertTransaction('other-manual', 'holding-2', 'manual', 8_000);
    insertReminder('reminder-1', 'account-1', 'add_transactions');

    const [row] = await remindersRepo.planInputsQuery();

    expect(row?.lastImportAt).toBeNull();
    expect(row?.lastManualAt).toBeNull();
  });

  it('reads nothing when there are no reminders, even with transactions', async () => {
    insertAccount('account-1');
    insertHolding('holding-1', 'account-1');
    insertTransaction('manual', 'holding-1', 'manual', 1_000);

    expect(await remindersRepo.planInputsQuery()).toEqual([]);
  });
});

describe('remindersRepo.recordEngagements', () => {
  beforeEach(() => {
    insertAccount('account-1');
  });

  it('sets lastEngagedAt from a tap, and leaves lastSnoozedAt alone', async () => {
    insertReminder('reminder-1', 'account-1', 'statement_import', { last_snoozed_at: 50 });

    await remindersRepo.recordEngagements([
      { reminderId: 'reminder-1', action: 'open', respondedAt: 100 },
    ]);

    expect(storedReminder('reminder-1')).toMatchObject({
      last_engaged_at: 100,
      last_snoozed_at: 50,
    });
  });

  it('sets both lastEngagedAt and lastSnoozedAt from a snooze', async () => {
    insertReminder('reminder-1', 'account-1', 'statement_import');

    await remindersRepo.recordEngagements([
      { reminderId: 'reminder-1', action: 'snooze', respondedAt: 200 },
    ]);

    expect(storedReminder('reminder-1')).toMatchObject({
      last_engaged_at: 200,
      last_snoozed_at: 200,
    });
  });

  it('keeps the latest time when an older response arrives after a newer one', async () => {
    insertReminder('reminder-1', 'account-1', 'statement_import', {
      last_engaged_at: 500,
      last_snoozed_at: 500,
    });

    await remindersRepo.recordEngagements([
      { reminderId: 'reminder-1', action: 'snooze', respondedAt: 300 },
      { reminderId: 'reminder-1', action: 'open', respondedAt: 400 },
    ]);

    expect(storedReminder('reminder-1')).toMatchObject({
      last_engaged_at: 500,
      last_snoozed_at: 500,
    });
  });

  it('records each reminder of the batch in one write, and skips a deleted reminder', async () => {
    insertReminder('reminder-1', 'account-1', 'statement_import');
    insertReminder('reminder-2', 'account-1', 'add_transactions');

    await remindersRepo.recordEngagements([
      { reminderId: 'reminder-1', action: 'open', respondedAt: 100 },
      { reminderId: 'deleted', action: 'open', respondedAt: 150 },
      { reminderId: 'reminder-2', action: 'snooze', respondedAt: 200 },
    ]);

    expect(write).toHaveBeenCalledTimes(1);
    expect(storedReminder('reminder-1').last_engaged_at).toBe(100);
    expect(storedReminder('reminder-2').last_snoozed_at).toBe(200);
  });

  it('opens no write when there is nothing to record', async () => {
    await remindersRepo.recordEngagements([]);

    expect(write).not.toHaveBeenCalled();
  });
});

describe('remindersRepo.markBackoffPaused', () => {
  beforeEach(() => {
    insertAccount('account-1');
  });

  it('pauses each reminder at its slot with the back-off reason, in one write', async () => {
    insertReminder('reminder-1', 'account-1', 'statement_import');
    insertReminder('reminder-2', 'account-1', 'add_transactions');

    await remindersRepo.markBackoffPaused([
      { reminderId: 'reminder-1', pausedAt: 700 },
      { reminderId: 'reminder-2', pausedAt: 800 },
    ]);

    expect(write).toHaveBeenCalledTimes(1);
    expect(storedReminder('reminder-1')).toMatchObject({ paused_at: 700, pause_reason: 'backoff' });
    expect(storedReminder('reminder-2')).toMatchObject({ paused_at: 800, pause_reason: 'backoff' });
  });

  it('never overwrites a pause the user made in the meantime', async () => {
    insertReminder('reminder-1', 'account-1', 'statement_import', {
      paused_at: 600,
      pause_reason: 'user',
    });

    await remindersRepo.markBackoffPaused([{ reminderId: 'reminder-1', pausedAt: 700 }]);

    expect(storedReminder('reminder-1')).toMatchObject({ paused_at: 600, pause_reason: 'user' });
  });

  it('opens no write when nothing is paused', async () => {
    await remindersRepo.markBackoffPaused([]);

    expect(write).not.toHaveBeenCalled();
  });
});

describe('remindersRepo.restartIgnoredCounts', () => {
  it('restarts every reminder from now in one write, and keeps its pause and engagement', async () => {
    const now = new Date(2026, 8, 29, 9, 0).getTime();
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(now);

    insertAccount('account-1');
    insertAccount('account-2');
    insertReminder('reminder-1', 'account-1', 'statement_import', {
      paused_at: 600,
      pause_reason: 'backoff',
      last_engaged_at: 500,
      last_snoozed_at: 550,
    });
    insertReminder('reminder-2', 'account-2', 'add_transactions');

    await remindersRepo.restartIgnoredCounts();

    expect(write).toHaveBeenCalledTimes(1);
    expect(storedReminder('reminder-1')).toMatchObject({
      active_since: now,
      paused_at: 600,
      pause_reason: 'backoff',
      last_engaged_at: 500,
      last_snoozed_at: 550,
    });
    expect(storedReminder('reminder-2').active_since).toBe(now);

    dateNow.mockRestore();
  });
});

describe('remindersRepo.clearSnoozes', () => {
  beforeEach(() => {
    insertAccount('account-1');
  });

  it('clears lastSnoozedAt on the given reminders only, in one write', async () => {
    insertReminder('reminder-1', 'account-1', 'statement_import', { last_snoozed_at: 100 });
    insertReminder('reminder-2', 'account-1', 'add_transactions', { last_snoozed_at: 200 });

    await remindersRepo.clearSnoozes(['reminder-1']);

    expect(write).toHaveBeenCalledTimes(1);
    expect(storedReminder('reminder-1').last_snoozed_at).toBeNull();
    expect(storedReminder('reminder-2').last_snoozed_at).toBe(200);
  });

  it('opens no write when no snooze is stale', async () => {
    await remindersRepo.clearSnoozes([]);

    expect(write).not.toHaveBeenCalled();
  });
});

describe('remindersRepo.listByAccountQuery', () => {
  it('reads the reminders of one account only, each with its parsed schedule', async () => {
    insertAccount('account-1');
    insertAccount('account-2');
    insertReminder('reminder-1', 'account-1', 'statement_import', { pause_reason: 'backoff' });
    insertReminder('reminder-2', 'account-1', 'add_transactions');
    insertReminder('reminder-3', 'account-2', 'add_transactions');

    const rows = await remindersRepo.listByAccountQuery('account-1');

    expect(rows.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: 'reminder-2', kind: 'add_transactions' },
      { id: 'reminder-1', kind: 'statement_import' },
    ]);
    expect(rows[1]).toMatchObject({
      accountId: 'account-1',
      schedule: { frequency: 'daily', minuteOfDay: 1200 },
      activeSince: ACTIVE_SINCE,
      pauseReason: 'backoff',
    });
  });
});

describe('remindersRepo.listWithAccountQuery', () => {
  it('reads every reminder with its account, in the accounts list order', async () => {
    insertAccount('account-1', { name: 'Cash', sortOrder: 2 });
    insertAccount('account-2', {
      name: 'Card',
      institution: 'monobank',
      archivedAt: 5,
      sortOrder: 1,
    });
    insertAccount('account-3', { name: 'No reminders', sortOrder: 0 });
    insertReminder('reminder-1', 'account-1', 'add_transactions');
    insertReminder('reminder-2', 'account-2', 'statement_import', { pause_reason: 'backoff' });

    const rows = await remindersRepo.listWithAccountQuery();

    expect(rows.map(({ reminder }) => reminder.id)).toEqual(['reminder-2', 'reminder-1']);
    expect(rows[0]).toEqual({
      reminder: expect.objectContaining({
        id: 'reminder-2',
        accountId: 'account-2',
        kind: 'statement_import',
        schedule: { frequency: 'daily', minuteOfDay: 1200 },
        pauseReason: 'backoff',
      }),
      account: { name: 'Card', institution: 'monobank', archivedAt: 5 },
      hasImport: false,
    });
  });

  it('knows whether each reminder’s account has a statement import', async () => {
    insertAccount('account-1', { sortOrder: 0 });
    insertAccount('account-2', { sortOrder: 1 });
    insertHolding('holding-1', 'account-1');
    insertHolding('holding-2', 'account-2');
    insertTransaction('import-1', 'holding-1', 'import', 1_000);
    insertTransaction('import-2', 'holding-1', 'import', 2_000);
    insertTransaction('manual', 'holding-2', 'manual', 1_000);
    insertReminder('reminder-1', 'account-1', 'statement_import');
    insertReminder('reminder-2', 'account-2', 'add_transactions');

    const rows = await remindersRepo.listWithAccountQuery();

    expect(rows.map(({ reminder, hasImport }) => [reminder.id, hasImport])).toEqual([
      ['reminder-1', true],
      ['reminder-2', false],
    ]);
  });
});

describe('remindersRepo.byIdQuery', () => {
  it('reads the one reminder, or nothing once it is gone', async () => {
    insertAccount('account-1');
    insertReminder('reminder-1', 'account-1', 'statement_import');

    expect(await remindersRepo.byIdQuery('reminder-1')).toMatchObject([
      { id: 'reminder-1', kind: 'statement_import' },
    ]);
    expect(await remindersRepo.byIdQuery('deleted')).toEqual([]);
  });
});

describe('remindersRepo.hasImportQuery', () => {
  beforeEach(() => {
    insertAccount('account-1');
    insertAccount('account-2');
    insertHolding('holding-1', 'account-1');
    insertHolding('holding-2', 'account-1');
    insertHolding('holding-3', 'account-2');
  });

  it('finds an import on any holding of the account', async () => {
    insertTransaction('import', 'holding-2', 'import', 1_000);

    expect(await remindersRepo.hasImportQuery('account-1')).toHaveLength(1);
  });

  it('finds nothing from manual or synced entries, or from another account', async () => {
    insertTransaction('manual', 'holding-1', 'manual', 1_000);
    insertTransaction('synced', 'holding-1', 'monobank', 1_000);
    insertTransaction('other-import', 'holding-3', 'import', 1_000);

    expect(await remindersRepo.hasImportQuery('account-1')).toEqual([]);
  });

  it('reads at most one row, however many imports exist', async () => {
    insertTransaction('import-1', 'holding-1', 'import', 1_000);
    insertTransaction('import-2', 'holding-2', 'import', 2_000);

    expect(await remindersRepo.hasImportQuery('account-1')).toHaveLength(1);
    expect(remindersRepo.hasImportQuery('account-1').toSQL().sql).toMatch(/limit \?$/);
  });
});

describe('remindersRepo.manualEntryDaysQuery', () => {
  const SINCE = new Date(2026, 8, 1, 12, 0).getTime();

  beforeEach(() => {
    insertAccount('account-1');
    insertAccount('account-2');
    insertHolding('holding-1', 'account-1');
    insertHolding('holding-2', 'account-1');
    insertHolding('holding-3', 'account-2');
  });

  it('counts the manual entries on every holding of the account since the given time', async () => {
    insertTransaction('manual-1', 'holding-1', 'manual', SINCE);
    insertTransaction('manual-2', 'holding-2', 'manual', SINCE + 1);

    expect(await remindersRepo.manualEntryDaysQuery('account-1', SINCE)).toEqual([{ entries: 2 }]);
  });

  it('counts the two legs of a transfer, which share their creation time, once', async () => {
    insertTransaction('transfer-out', 'holding-1', 'manual', SINCE + 1);
    insertTransaction('transfer-in', 'holding-2', 'manual', SINCE + 1);

    expect(await remindersRepo.manualEntryDaysQuery('account-1', SINCE)).toEqual([{ entries: 1 }]);
  });

  it('leaves out entries made before the given time', async () => {
    insertTransaction('before', 'holding-1', 'manual', SINCE - 1);
    insertTransaction('at', 'holding-1', 'manual', SINCE);

    expect(await remindersRepo.manualEntryDaysQuery('account-1', SINCE)).toEqual([{ entries: 1 }]);
  });

  it('leaves out imported and synced entries, and the entries of other accounts', async () => {
    insertTransaction('import', 'holding-1', 'import', SINCE + 1);
    insertTransaction('synced', 'holding-2', 'monobank', SINCE + 2);
    insertTransaction('other-manual', 'holding-3', 'manual', SINCE + 3);

    expect(await remindersRepo.manualEntryDaysQuery('account-1', SINCE)).toEqual([{ entries: 0 }]);
  });
});

describe('remindersRepo writes', () => {
  const NOW = new Date(2026, 8, 29, 18, 30).getTime();
  const WEEKLY = { frequency: 'weekly', minuteOfDay: 540, weekdays: [1, 4] } as const;

  let dateNow: jest.SpyInstance;

  beforeEach(() => {
    dateNow = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    insertAccount('account-1');
  });

  afterEach(() => {
    dateNow.mockRestore();
  });

  describe('create', () => {
    it('stores an active reminder counted from now, in one write', async () => {
      const reminderId = await remindersRepo.create({
        accountId: 'account-1',
        kind: 'add_transactions',
        schedule: WEEKLY,
      });

      expect(write).toHaveBeenCalledTimes(1);
      expect(storedReminder(reminderId)).toMatchObject({
        schedule: JSON.stringify(WEEKLY),
        active_since: NOW,
        paused_at: null,
        pause_reason: null,
        last_engaged_at: null,
        last_snoozed_at: null,
      });
    });

    it('refuses a second reminder of the same kind on the account', async () => {
      insertReminder('reminder-1', 'account-1', 'add_transactions');

      await expect(
        remindersRepo.create({
          accountId: 'account-1',
          kind: 'add_transactions',
          schedule: WEEKLY,
        }),
      ).rejects.toThrow();
      expect(reminderCount()).toBe(1);
    });
  });

  describe('update', () => {
    it('stores the schedule and counts the reminder from now again, in one write', async () => {
      insertReminder('reminder-1', 'account-1', 'statement_import');

      await remindersRepo.update('reminder-1', WEEKLY);

      expect(write).toHaveBeenCalledTimes(1);
      expect(storedReminder('reminder-1')).toMatchObject({
        schedule: JSON.stringify(WEEKLY),
        active_since: NOW,
        updated_at: NOW,
      });
    });

    it('clears a back-off pause', async () => {
      insertReminder('reminder-1', 'account-1', 'statement_import', {
        paused_at: 700,
        pause_reason: 'backoff',
      });

      await remindersRepo.update('reminder-1', WEEKLY);

      expect(storedReminder('reminder-1')).toMatchObject({ paused_at: null, pause_reason: null });
    });

    it('keeps a pause the user made', async () => {
      insertReminder('reminder-1', 'account-1', 'statement_import', {
        paused_at: 700,
        pause_reason: 'user',
      });

      await remindersRepo.update('reminder-1', WEEKLY);

      expect(storedReminder('reminder-1')).toMatchObject({ paused_at: 700, pause_reason: 'user' });
    });

    it('keeps a pending snooze and the last engagement', async () => {
      insertReminder('reminder-1', 'account-1', 'statement_import', {
        last_engaged_at: 400,
        last_snoozed_at: 400,
      });

      await remindersRepo.update('reminder-1', WEEKLY);

      expect(storedReminder('reminder-1')).toMatchObject({
        last_engaged_at: 400,
        last_snoozed_at: 400,
      });
    });
  });

  describe('setPaused', () => {
    it('pauses for the user now, in one write, and keeps the active-since time', async () => {
      insertReminder('reminder-1', 'account-1', 'statement_import');

      await remindersRepo.setPaused('reminder-1', true);

      expect(write).toHaveBeenCalledTimes(1);
      expect(storedReminder('reminder-1')).toMatchObject({
        paused_at: NOW,
        pause_reason: 'user',
        active_since: ACTIVE_SINCE,
      });
    });

    it('keeps the time and reason of a pause already in place', async () => {
      insertReminder('reminder-1', 'account-1', 'statement_import', {
        paused_at: 700,
        pause_reason: 'backoff',
      });

      await remindersRepo.setPaused('reminder-1', true);

      expect(storedReminder('reminder-1')).toMatchObject({
        paused_at: 700,
        pause_reason: 'backoff',
      });
    });

    it.each(['user', 'backoff'])(
      'resumes a %s pause and counts the reminder from now again',
      async (pauseReason) => {
        insertReminder('reminder-1', 'account-1', 'statement_import', {
          paused_at: 700,
          pause_reason: pauseReason,
        });

        await remindersRepo.setPaused('reminder-1', false);

        expect(storedReminder('reminder-1')).toMatchObject({
          paused_at: null,
          pause_reason: null,
          active_since: NOW,
          updated_at: NOW,
        });
      },
    );

    it('leaves a reminder that is not paused alone on resume', async () => {
      insertReminder('reminder-1', 'account-1', 'statement_import');

      await remindersRepo.setPaused('reminder-1', false);

      expect(storedReminder('reminder-1').active_since).toBe(ACTIVE_SINCE);
    });
  });

  describe('remove', () => {
    it('deletes only that reminder, in one write', async () => {
      insertReminder('reminder-1', 'account-1', 'statement_import');
      insertReminder('reminder-2', 'account-1', 'add_transactions');

      await remindersRepo.remove('reminder-1');

      expect(write).toHaveBeenCalledTimes(1);
      expect(storedReminder('reminder-1')).toBeUndefined();
      expect(reminderCount()).toBe(1);
    });
  });
});
