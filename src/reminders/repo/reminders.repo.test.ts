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
  paused_at: number | null;
  pause_reason: string | null;
  last_engaged_at: number | null;
  last_snoozed_at: number | null;
};

const openDatabase = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.exec('PRAGMA foreign_keys = ON');

  return database;
};

const insertAccount = (
  id: string,
  options: { institution?: string | null; archivedAt?: number | null } = {},
): void => {
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution, archived_at) VALUES (?, 'Account', 'bank', ?, ?)",
    )
    .run(id, options.institution ?? null, options.archivedAt ?? null);
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
  columns: Partial<Omit<StoredReminder, 'id'>> = {},
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
      'SELECT id, paused_at, pause_reason, last_engaged_at, last_snoozed_at FROM reminders WHERE id = ?',
    )
    .get(id) as StoredReminder;

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
