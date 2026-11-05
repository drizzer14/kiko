// The choices are the user's own, so a restore takes them from the file, not from this device.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { settingsRepo } from '@kiko/settings';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { EXPORT_VERSION } from '../crypto/envelope';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

const openDatabase = (text: string | null): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  database.prepare('INSERT INTO settings (id, recurring_merchant_choices) VALUES (1, ?)').run(text);

  return database;
};

const exportedSnapshot = async (): Promise<DataSnapshot> =>
  JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

const storedText = (): string | null =>
  (
    mockDatabase.prepare('SELECT recurring_merchant_choices FROM settings WHERE id = 1').get() as {
      recurring_merchant_choices: string | null;
    }
  ).recurring_merchant_choices;

const storedChoices = (): [string, unknown][] => [
  ...settingsRepo.recurringMerchantChoicesOf(JSON.parse(storedText() ?? 'null')),
];

const exportWith = async (text: string | null): Promise<DataSnapshot> => {
  mockDatabase = openDatabase(text);

  return exportedSnapshot();
};

const restoreOnto = async (backup: DataSnapshot, liveText: string | null): Promise<void> => {
  mockDatabase = openDatabase(liveText);
  await restoreDataSnapshot(backup, EXPORT_VERSION);
};

const withoutKey = (backup: DataSnapshot): DataSnapshot => {
  for (const row of backup.settings as Record<string, unknown>[]) {
    delete row.recurringMerchantChoices;
  }

  return backup;
};

const withValue = (backup: DataSnapshot, value: unknown): DataSnapshot => {
  for (const row of backup.settings as Record<string, unknown>[]) {
    row.recurringMerchantChoices = value;
  }

  return backup;
};

const LIVE_TEXT = JSON.stringify({ 'live key': { name: 'Live', hidden: true } });
const NETFLIX_TEXT = JSON.stringify({ netflix: { name: 'Netflix', hidden: true } });

describe('restoring the recurring merchant choices', () => {
  it('keeps the list through a round trip', async () => {
    const backup = await exportWith(
      JSON.stringify({
        netflix: { name: 'Netflix', hidden: true },
        spotify: { name: 'Spotify', hidden: true },
      }),
    );

    await restoreOnto(backup, null);

    expect(storedChoices()).toEqual([
      ['netflix', { name: 'Netflix', hidden: true }],
      ['spotify', { name: 'Spotify', hidden: true }],
    ]);
  });

  it('restores with none from a file with no key', async () => {
    const backup = withoutKey(await exportWith(NETFLIX_TEXT));

    await restoreOnto(backup, null);

    expect(storedText()).toBeNull();
    expect(storedChoices()).toEqual([]);
  });

  it('replaces the live list with the file list', async () => {
    const backup = await exportWith(NETFLIX_TEXT);

    await restoreOnto(backup, LIVE_TEXT);

    expect(storedChoices()).toEqual([['netflix', { name: 'Netflix', hidden: true }]]);
  });

  it('replaces a live list with none from a file with no key', async () => {
    const backup = withoutKey(await exportWith(NETFLIX_TEXT));

    await restoreOnto(backup, LIVE_TEXT);

    expect(storedChoices()).toEqual([]);
  });

  it('restores a malformed value and reads it as nothing hidden', async () => {
    const backup = withValue(await exportWith(null), ['not', 'an', 'object']);

    await restoreOnto(backup, LIVE_TEXT);

    expect(storedText()).not.toBeNull();
    expect(storedChoices()).toEqual([]);
  });

  it('drops a bad entry alone and keeps the good one beside it', async () => {
    const backup = withValue(await exportWith(null), {
      netflix: { name: 'Netflix', hidden: true },
      broken: { name: 7, hidden: true },
      unhidden: { name: 'Gym', hidden: false },
    });

    await restoreOnto(backup, null);

    expect(storedChoices()).toEqual([['netflix', { name: 'Netflix', hidden: true }]]);
  });

  it('keeps a __proto__ key through a round trip', async () => {
    const backup = await exportWith(
      '{"__proto__":{"name":"Proto","hidden":true},"plain":{"name":"Plain","hidden":true}}',
    );

    await restoreOnto(backup, null);

    expect(storedChoices()).toEqual([
      ['__proto__', { name: 'Proto', hidden: true }],
      ['plain', { name: 'Plain', hidden: true }],
    ]);
  });
});
