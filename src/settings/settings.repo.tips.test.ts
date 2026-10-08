// The dismissed-tips list is one JSON blob, so dismissTip reads then writes it.
// The read-modify-write and its transaction are SQL behaviours, so only a real
// engine shows them.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { settingsRepo } from './settings.repo';

const storedDismissedTips = (): string =>
  (
    mockDatabase.prepare('SELECT dismissed_tips FROM settings WHERE id = 1').get() as {
      dismissed_tips: string;
    }
  ).dismissed_tips;

const storeDismissedTips = (rawList: string): void => {
  mockDatabase.prepare('UPDATE settings SET dismissed_tips = ? WHERE id = 1').run(rawList);
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('INSERT INTO settings (id) VALUES (1)');
});

describe('settingsRepo.dismissTip', () => {
  it('stores the dismissed tip id', async () => {
    await settingsRepo.dismissTip('settings.categories');

    expect(storedDismissedTips()).toBe('["settings.categories"]');
  });

  it('stores a tip once however often it is dismissed', async () => {
    await settingsRepo.dismissTip('settings.categories');
    await settingsRepo.dismissTip('settings.categories');

    expect(storedDismissedTips()).toBe('["settings.categories"]');
  });

  it('stores two different tips in the order they were dismissed', async () => {
    await settingsRepo.dismissTip('settings.categories');
    await settingsRepo.dismissTip('transaction.applyToAll');

    expect(storedDismissedTips()).toBe('["settings.categories","transaction.applyToAll"]');
  });

  it('keeps an id this build does not know', async () => {
    storeDismissedTips('["future.tip"]');

    await settingsRepo.dismissTip('settings.categories');

    expect(storedDismissedTips()).toBe('["future.tip","settings.categories"]');
  });
});

describe('settingsRepo.resetTips', () => {
  it('clears every dismissed tip, an id this build does not know included', async () => {
    storeDismissedTips('["future.tip","settings.categories"]');

    await settingsRepo.resetTips();

    expect(storedDismissedTips()).toBe('[]');
  });

  it('leaves an empty list empty', async () => {
    await settingsRepo.resetTips();

    expect(storedDismissedTips()).toBe('[]');
  });
});
