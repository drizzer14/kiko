// The offer runs the real `useLiveQuery` on a real, fully migrated
// `node:sqlite` engine: the entry count, the dismissal JSON and the 30-day
// window are exactly what a fake handle would get wrong silently.
let mockDatabase: DatabaseSync;
const mockSubscribers = new Set<() => void>();

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return {
    database: client.database,
    // A committed write re-runs every live query, as op-sqlite's reactive
    // flush does.
    write: async (work: unknown) => {
      const result = await client.write(work);

      for (const subscriber of mockSubscribers) {
        subscriber();
      }

      return result;
    },
    rawDatabase: {
      reactiveExecute: ({ callback }: { callback: () => void }) => {
        mockSubscribers.add(callback);

        return () => mockSubscribers.delete(callback);
      },
    },
  };
});

import { DatabaseSync } from 'node:sqlite';
import { clearLiveQueryCache } from '@kiko/db';
import { remindersRepo } from '@kiko/reminders/repo';
import type { ReminderKind } from '@kiko/reminders/schedule';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { type ReminderOfferTrigger, useReminderOffer } from '.';

const NOW = new Date(2026, 8, 29, 9, 0).getTime();
const YESTERDAY = new Date(2026, 8, 28, 12, 0).getTime();
const TODAY = new Date(2026, 8, 29, 8, 0).getTime();
const DAILY = { frequency: 'daily', minuteOfDay: 1200 } as const;

let prepare: jest.SpyInstance;
let dateNow: jest.SpyInstance;

const run = (statement: string, ...parameters: (string | number | null)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const addAccount = (accountId: string, institution: string | null = null): void => {
  run(
    "INSERT INTO accounts (id, name, kind, institution) VALUES (?, 'Name', 'bank', ?)",
    accountId,
    institution,
  );
  run(
    "INSERT INTO holdings (id, account_id, name, type, currency) VALUES (?, ?, 'Main', 'card', 'UAH')",
    `${accountId}-holding`,
    accountId,
  );
};

let entryCount = 0;

const addEntry = (accountId: string, source: string, createdAt: number): void => {
  entryCount += 1;
  run(
    'INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id, created_at) VALUES (?, ?, -500, ?, ?, ?, ?)',
    `entry-${entryCount}`,
    `${accountId}-holding`,
    createdAt,
    source,
    `external-${entryCount}`,
    createdAt,
  );
};

const addReminder = (accountId: string, kind: ReminderKind): void => {
  run(
    'INSERT INTO reminders (id, account_id, kind, schedule, active_since) VALUES (?, ?, ?, ?, ?)',
    `${accountId}-${kind}`,
    accountId,
    kind,
    JSON.stringify(DAILY),
    NOW,
  );
};

const dismissals = (): unknown =>
  JSON.parse(
    (
      mockDatabase.prepare('SELECT reminder_offer_dismissals FROM settings').get() as {
        reminder_offer_dismissals: string;
      }
    ).reminder_offer_dismissals,
  );

const readManualEntries = (): boolean =>
  prepare.mock.calls.some(([statement]) => /count\(distinct/.test(statement));

const renderOffer = async (accountId: string, trigger: ReminderOfferTrigger) => {
  const kindsSeen: (ReminderKind | undefined)[] = [];
  const onAccept = jest.fn();
  const view = await renderHook(() => {
    const offer = useReminderOffer(accountId, trigger, onAccept);

    kindsSeen.push(offer?.kind);

    return offer;
  });

  // The trigger's own read starts only once the account, reminder and
  // settings reads have settled, so wait until a tick passes with no render.
  const settle = async (): Promise<void> => {
    let renders: number;

    do {
      renders = kindsSeen.length;
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    } while (kindsSeen.length !== renders);
  };

  await settle();

  return { ...view, kindsSeen, onAccept, settle };
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  run('INSERT INTO settings (id) VALUES (1)');
  prepare = jest.spyOn(mockDatabase, 'prepare');
  dateNow = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockSubscribers.clear();
  clearLiveQueryCache();
});

afterEach(() => {
  dateNow.mockRestore();
});

describe('useReminderOffer — manual activity', () => {
  beforeEach(() => {
    addAccount('cash');
  });

  it('offers an add-transactions reminder after the second manual entry', async () => {
    addEntry('cash', 'manual', YESTERDAY);
    addEntry('cash', 'manual', TODAY);

    const { result } = await renderOffer('cash', 'manualActivity');

    expect(result.current?.kind).toBe('add_transactions');
    expect(readManualEntries()).toBe(true);
  });

  it('offers nothing after one manual entry', async () => {
    addEntry('cash', 'manual', TODAY);

    const { kindsSeen } = await renderOffer('cash', 'manualActivity');

    expect(kindsSeen).not.toContain('add_transactions');
  });

  it('counts the two legs of a transfer as one entry', async () => {
    addEntry('cash', 'manual', TODAY);
    addEntry('cash', 'manual', TODAY);

    const { kindsSeen } = await renderOffer('cash', 'manualActivity');

    expect(kindsSeen).not.toContain('add_transactions');
  });

  it('leaves out imported entries', async () => {
    addEntry('cash', 'manual', TODAY);
    addEntry('cash', 'import', YESTERDAY);

    const { kindsSeen } = await renderOffer('cash', 'manualActivity');

    expect(kindsSeen).not.toContain('add_transactions');
  });

  it('counts an entry from the start of the day 30 days ago', async () => {
    addEntry('cash', 'manual', new Date(2026, 7, 30, 0, 0).getTime());
    addEntry('cash', 'manual', TODAY);

    const { result } = await renderOffer('cash', 'manualActivity');

    expect(result.current?.kind).toBe('add_transactions');
  });

  it('leaves out an entry from 31 days ago', async () => {
    addEntry('cash', 'manual', new Date(2026, 7, 29, 23, 59).getTime());
    addEntry('cash', 'manual', TODAY);

    const { kindsSeen } = await renderOffer('cash', 'manualActivity');

    expect(kindsSeen).not.toContain('add_transactions');
  });

  it('counts 30 calendar days back across the October clock change', async () => {
    dateNow.mockReturnValue(new Date(2026, 10, 10, 9, 0).getTime());
    addEntry('cash', 'manual', new Date(2026, 9, 11, 0, 30).getTime());
    addEntry('cash', 'manual', new Date(2026, 10, 10, 8, 0).getTime());

    const { result } = await renderOffer('cash', 'manualActivity');

    expect(result.current?.kind).toBe('add_transactions');
  });

  it('offers nothing, not even for a frame, once the account has an add-transactions reminder', async () => {
    addEntry('cash', 'manual', YESTERDAY);
    addEntry('cash', 'manual', TODAY);
    addReminder('cash', 'add_transactions');

    const { kindsSeen } = await renderOffer('cash', 'manualActivity');

    expect(kindsSeen).not.toContain('add_transactions');
    expect(readManualEntries()).toBe(false);
  });

  it('still offers it when the account has only an import reminder', async () => {
    addEntry('cash', 'manual', YESTERDAY);
    addEntry('cash', 'manual', TODAY);
    addReminder('cash', 'statement_import');

    const { result } = await renderOffer('cash', 'manualActivity');

    expect(result.current?.kind).toBe('add_transactions');
  });

  it('withdraws the offer once the reminder is saved', async () => {
    addEntry('cash', 'manual', YESTERDAY);
    addEntry('cash', 'manual', TODAY);

    const { result } = await renderOffer('cash', 'manualActivity');

    await act(async () => {
      await remindersRepo.create({ accountId: 'cash', kind: 'add_transactions', schedule: DAILY });
    });

    await waitFor(() => expect(result.current).toBeUndefined());
  });

  it('never reads the manual entries of a synced account', async () => {
    addAccount('card', 'monobank');
    addEntry('card', 'manual', YESTERDAY);
    addEntry('card', 'manual', TODAY);

    const { kindsSeen } = await renderOffer('card', 'manualActivity');

    expect(kindsSeen).not.toContain('add_transactions');
    expect(readManualEntries()).toBe(false);
  });

  it('offers nothing for an account that no longer exists', async () => {
    const { kindsSeen } = await renderOffer('deleted', 'manualActivity');

    expect(kindsSeen).toEqual(expect.arrayContaining([undefined]));
    expect(kindsSeen).not.toContain('add_transactions');
  });
});

describe('useReminderOffer — after an import', () => {
  it('offers an import reminder on an account with an import, a synced one included', async () => {
    addAccount('card', 'monobank');
    addEntry('card', 'import', TODAY);

    const { result } = await renderOffer('card', 'afterImport');

    expect(result.current?.kind).toBe('statement_import');
    expect(readManualEntries()).toBe(false);
  });

  it('offers nothing while the account has no import', async () => {
    addAccount('cash');
    addEntry('cash', 'manual', YESTERDAY);
    addEntry('cash', 'manual', TODAY);

    const { kindsSeen } = await renderOffer('cash', 'afterImport');

    expect(kindsSeen).not.toContain('statement_import');
  });

  it('offers nothing, not even for a frame, once the account has an import reminder', async () => {
    addAccount('cash');
    addEntry('cash', 'import', TODAY);
    addReminder('cash', 'statement_import');

    const { kindsSeen } = await renderOffer('cash', 'afterImport');

    expect(kindsSeen).not.toContain('statement_import');
  });
});

describe('useReminderOffer — accept and dismiss', () => {
  beforeEach(() => {
    addAccount('cash');
    addAccount('wallet');
    addEntry('cash', 'import', YESTERDAY);

    for (const accountId of ['cash', 'wallet']) {
      addEntry(accountId, 'manual', YESTERDAY);
      addEntry(accountId, 'manual', TODAY);
    }
  });

  it('hands the account and kind to the form opener on accept', async () => {
    const { result, onAccept } = await renderOffer('cash', 'manualActivity');

    result.current?.accept();

    expect(onAccept).toHaveBeenCalledWith({ accountId: 'cash', kind: 'add_transactions' });
  });

  it('hides a dismissed offer for good, on that account and kind only', async () => {
    const { result, unmount } = await renderOffer('cash', 'manualActivity');

    await act(async () => {
      await result.current?.dismiss();
    });

    await waitFor(() => expect(result.current).toBeUndefined());
    expect(dismissals()).toEqual({ cash: ['add_transactions'] });

    await unmount();

    const remounted = await renderOffer('cash', 'manualActivity');
    const otherAccount = await renderOffer('wallet', 'manualActivity');
    const otherKind = await renderOffer('cash', 'afterImport');

    expect(remounted.kindsSeen).not.toContain('add_transactions');
    expect(otherAccount.result.current?.kind).toBe('add_transactions');
    expect(otherKind.result.current?.kind).toBe('statement_import');
  });
});
