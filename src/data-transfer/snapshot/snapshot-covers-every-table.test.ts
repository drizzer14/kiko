// src/data-transfer/snapshot/snapshot-covers-every-table.test.ts
//
// Backup completeness: every Drizzle table exported from
// `db/schema.ts` must be represented in the backup snapshot that
// `readDataSnapshot`/`restoreDataSnapshot` round-trip. Both sides are derived
// at RUNTIME, not hand-copied lists — the schema side by asking Drizzle's own
// `is(x, SQLiteTable)` predicate which of the module's exports are tables, the
// snapshot side by calling the real `readDataSnapshot()` (against a mocked db
// client) and reading the keys of what it actually returns — so a table added
// to `schema.ts` or the snapshot object's field list changing under it fails
// this test without either list being touched by hand.
jest.mock('@kiko/db/client', () => ({
  database: {
    select: () => ({
      from: () => ({
        orderBy: () => Promise.resolve([]),
      }),
    }),
  },
}));

import { is } from 'drizzle-orm';
import { schema } from '@kiko/db';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';

import { readDataSnapshot } from './read-snapshot';

// Tables deliberately absent from the backup snapshot, each with a concrete,
// verified reason. Empty today: every table `schema.ts` exports is currently
// covered by `readDataSnapshot`/`restoreDataSnapshot` (verified by this test).
// If a future table belongs here, name it and give its real reason — do not
// add an entry just to silence a genuine gap.
const EXCLUDED_FROM_SNAPSHOT: readonly string[] = [];

const schemaTableExportNames = (): string[] =>
  Object.entries(schema)
    .filter(([, value]) => is(value, SQLiteTable))
    .map(([exportName]) => exportName)
    .sort();

describe('backup snapshot covers every schema table', () => {
  it('has one DataSnapshot field per sqliteTable export in db/schema.ts, minus documented exclusions', async () => {
    const snapshot = await readDataSnapshot();
    const snapshotFieldNames = Object.keys(snapshot).sort();

    const expectedTableNames = schemaTableExportNames().filter(
      (name) => !EXCLUDED_FROM_SNAPSHOT.includes(name),
    );

    expect(snapshotFieldNames).toEqual(expectedTableNames);
  });

  it('has at least one sqliteTable export to check against (guards a vacuous pass)', () => {
    expect(schemaTableExportNames().length).toBeGreaterThan(0);
  });
});
