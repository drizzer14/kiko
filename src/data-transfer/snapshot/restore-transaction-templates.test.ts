// src/data-transfer/snapshot/restore-transaction-templates.test.ts
//
// The transaction templates travel in the backup as an optional key
// (`transactionTemplates`, migration 0056): a file exported with templates and
// restored on another device brings them back whole, a file from before the table
// restores with none, and the draft of a template is carried verbatim, whatever
// its shape, because the repo (not the restore) narrows it on read.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

type StoredTemplate = {
  id: string;
  name: string;
  draft: unknown;
  createdAt: number;
  updatedAt: number;
};

const RENT_DRAFT = { version: 1, mode: 'expense', amountMinorUnits: 12000, currency: 'UAH' };

const freshDatabase = (): DatabaseSync => {
  const target = new DatabaseSync(':memory:');

  applyAllMigrations(target);
  target.exec('PRAGMA foreign_keys = ON');

  return target;
};

const insertTemplate = (id: string, name: string, draft: string, stamp: number): void => {
  mockDatabase
    .prepare(
      `INSERT INTO transaction_templates (id, name, draft, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, name, draft, stamp, stamp + 1);
};

const templatesOf = (): StoredTemplate[] =>
  (
    mockDatabase
      .prepare(
        `SELECT id, name, draft, created_at AS createdAt, updated_at AS updatedAt
         FROM transaction_templates ORDER BY id`,
      )
      .all() as (Omit<StoredTemplate, 'draft'> & { draft: string })[]
  ).map(({ id, name, draft, createdAt, updatedAt }) => ({
    id,
    name,
    draft: JSON.parse(draft),
    createdAt,
    updatedAt,
  }));

const exportedSnapshot = async (): Promise<DataSnapshot> =>
  JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

const exportWithTwoTemplates = async (): Promise<DataSnapshot> => {
  mockDatabase = freshDatabase();
  insertTemplate('template-b', 'Оренда', JSON.stringify(RENT_DRAFT), 2000);
  insertTemplate('template-a', 'Coffee', JSON.stringify({ version: 1, mode: 'income' }), 1000);

  return exportedSnapshot();
};

describe('restoring the transaction templates', () => {
  it('reads the templates into the export, ordered by id', async () => {
    const snapshot = await exportWithTwoTemplates();

    expect(snapshot.transactionTemplates?.map((template) => template.id)).toEqual([
      'template-a',
      'template-b',
    ]);
  });

  it('keeps the ids, the names, the drafts and the times through a round trip', async () => {
    const snapshot = await exportWithTwoTemplates();
    const exported = templatesOf();

    mockDatabase = freshDatabase();
    await restoreDataSnapshot(snapshot);

    expect(templatesOf()).toEqual(exported);
    expect(templatesOf()).toHaveLength(2);
  });

  it('restores a file with no key for them, and imports it', async () => {
    const { transactionTemplates: _omitted, ...fileWithoutTemplates } =
      await exportWithTwoTemplates();

    mockDatabase = freshDatabase();
    await expect(restoreDataSnapshot(fileWithoutTemplates)).resolves.toBeDefined();

    expect(templatesOf()).toEqual([]);
  });

  it('restores a draft of a shape this build does not know, verbatim', async () => {
    const snapshot = await exportWithTwoTemplates();

    mockDatabase = freshDatabase();
    await restoreDataSnapshot({
      ...snapshot,
      transactionTemplates: [
        {
          id: 'template-future',
          name: 'Future',
          draft: { version: 9 },
          createdAt: 5000,
          updatedAt: 6000,
        },
      ],
    });

    expect(templatesOf()).toEqual([
      {
        id: 'template-future',
        name: 'Future',
        draft: { version: 9 },
        createdAt: 5000,
        updatedAt: 6000,
      },
    ]);
  });

  it('replaces the templates of the device it restores onto', async () => {
    const snapshot = await exportWithTwoTemplates();
    const exported = templatesOf();

    mockDatabase = freshDatabase();
    insertTemplate('template-stale', 'Stale', '{"version":1}', 9000);
    insertTemplate('template-a', 'Old name', '{"version":1}', 9000);

    await restoreDataSnapshot(snapshot);

    expect(templatesOf()).toEqual(exported);
  });
});
