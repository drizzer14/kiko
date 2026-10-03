// src/data-transfer/snapshot/with-implicit-accounts-merged.test.ts
//
// The pure mirror of migration 0050 on plain row arrays. The migration's own
// test (`drizzle/migrations/0050-implicit-property-debt-accounts.test.ts`)
// holds the same data cases against the real SQL; the two-path test next to
// this file proves both agree on one database.
import maybe, { foldMap } from 'fnts/maybe';
import type { AccountRow, ReminderRow } from '@kiko/db';
import { IMPLICIT_ACCOUNT_STORED_NAME } from '@kiko/holdings/implicit-account';

import { withImplicitAccountsMerged } from './with-implicit-accounts-merged';

type ReminderKind = ReminderRow['kind'];

type AccountSeed = {
  id: string;
  kind: AccountRow['kind'];
  name?: string;
  sortOrder?: number;
  createdAt?: number;
  archivedAt?: number | null;
  icon?: string | null;
  color?: string | null;
};

const account = (seed: AccountSeed) => ({
  name: seed.id,
  sortOrder: 0,
  createdAt: 1,
  archivedAt: null as number | null,
  icon: 'custom-glyph' as string | null,
  color: '#112233' as string | null,
  ...seed,
});

type HoldingSeed = {
  id: string;
  accountId: string;
  sortOrder?: number;
  createdAt?: number;
  closedAt?: number | null;
};

const holding = (seed: HoldingSeed) => ({
  sortOrder: 0,
  createdAt: 1,
  closedAt: null as number | null,
  balanceMinorUnits: 100,
  ...seed,
});

type ReminderSeed = {
  id: string;
  accountId: string;
  kind: ReminderKind;
  createdAt: number;
  pausedAt?: number | null;
  lastEngagedAt?: number | null;
  lastSnoozedAt?: number | null;
};

const reminder = (seed: ReminderSeed) => ({
  pausedAt: null as number | null,
  lastEngagedAt: null as number | null,
  lastSnoozedAt: null as number | null,
  activeSince: seed.createdAt + 1,
  updatedAt: seed.createdAt + 2,
  ...seed,
});

const settingsWith = (reminderOfferDismissals: Record<string, ReminderKind[]> | null) => ({
  id: 1,
  reminderOfferDismissals,
});

const syncStateOf = (accountId: string) => ({ accountId, lastSyncAt: 5 });

type Rows = {
  accounts: ReturnType<typeof account>[];
  holdings: ReturnType<typeof holding>[];
  reminders: ReturnType<typeof reminder>[];
  settings: ReturnType<typeof settingsWith>[];
  syncState: ReturnType<typeof syncStateOf>[];
};

const rowsOf = (rows: Partial<Rows>): Rows => ({
  accounts: [],
  holdings: [],
  reminders: [],
  settings: [],
  syncState: [],
  ...rows,
});

// The kinds inside one account's list may come out in any order: the SQL's
// `json_group_array` order is not a promise, so compare them sorted.
const sortedDismissals = (rows: Rows): Record<string, string[]> | null =>
  foldMap(maybe(rows.settings[0]?.reminderOfferDismissals), (dismissals) =>
    Object.fromEntries(Object.entries(dismissals).map(([key, kinds]) => [key, [...kinds].sort()])),
  ) ?? null;

const placements = (rows: Rows) =>
  [...rows.holdings]
    .sort((left, right) => (left.id < right.id ? -1 : 1))
    .map(({ id, accountId, sortOrder }) => ({ id, accountId, sortOrder }));

const holdingIdsOf = (rows: Rows, accountId: string): string[] =>
  rows.holdings
    .filter((row) => row.accountId === accountId)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((row) => row.id);

const reminderIdsOf = (rows: Rows): string[] => rows.reminders.map((row) => row.id).sort();

const accountIdsOf = (rows: Rows): string[] => rows.accounts.map((row) => row.id).sort();

// Three property accounts and two debt accounts, with holdings (one closed),
// reminders on several of them, a dismissal map, and a stray sync_state row on
// a merged-away account. The same data 0050's own test seeds.
//
// property: kept = `property-oldest` (created_at 50). Section order by
// sort_order: property-oldest (0), property-middle (1), property-newest (2).
// debt: kept = `debt-oldest` (created_at 10); `debt-newest` (sort_order 0)
// sits before it in the section.
const mergeScenario = (): Rows =>
  rowsOf({
    accounts: [
      account({ id: 'property-newest', kind: 'property', sortOrder: 2, createdAt: 100 }),
      account({ id: 'property-oldest', kind: 'property', sortOrder: 0, createdAt: 50 }),
      account({ id: 'property-middle', kind: 'property', sortOrder: 1, createdAt: 200 }),
      account({ id: 'debt-oldest', kind: 'debt', sortOrder: 1, createdAt: 10 }),
      account({ id: 'debt-newest', kind: 'debt', sortOrder: 0, createdAt: 20 }),
      account({ id: 'bank', kind: 'bank', sortOrder: 0, createdAt: 5 }),
    ],
    holdings: [
      holding({ id: 'bank-card', accountId: 'bank' }),
      holding({ id: 'newest-a', accountId: 'property-newest', sortOrder: 0, createdAt: 5 }),
      holding({
        id: 'newest-closed',
        accountId: 'property-newest',
        sortOrder: 1,
        createdAt: 6,
        closedAt: 99,
      }),
      holding({ id: 'oldest-a', accountId: 'property-oldest', sortOrder: 1, createdAt: 7 }),
      holding({ id: 'oldest-b', accountId: 'property-oldest', sortOrder: 0, createdAt: 8 }),
      holding({ id: 'middle-a', accountId: 'property-middle', sortOrder: 0, createdAt: 1 }),
      holding({ id: 'debt-oldest-a', accountId: 'debt-oldest', sortOrder: 0 }),
      holding({ id: 'debt-newest-a', accountId: 'debt-newest', sortOrder: 0, createdAt: 9 }),
      holding({ id: 'debt-newest-b', accountId: 'debt-newest', sortOrder: 1, createdAt: 3 }),
    ],
    reminders: [
      reminder({
        id: 'newest-import',
        accountId: 'property-newest',
        kind: 'statement_import',
        createdAt: 30,
      }),
      reminder({
        id: 'newest-add',
        accountId: 'property-newest',
        kind: 'add_transactions',
        createdAt: 31,
      }),
      reminder({
        id: 'oldest-import',
        accountId: 'property-oldest',
        kind: 'statement_import',
        createdAt: 40,
      }),
      reminder({
        id: 'middle-import',
        accountId: 'property-middle',
        kind: 'statement_import',
        createdAt: 20,
        pausedAt: 777,
        lastEngagedAt: 555,
        lastSnoozedAt: 666,
      }),
      reminder({
        id: 'middle-add',
        accountId: 'property-middle',
        kind: 'add_transactions',
        createdAt: 90,
      }),
      reminder({
        id: 'debt-newest-import',
        accountId: 'debt-newest',
        kind: 'statement_import',
        createdAt: 15,
        pausedAt: 888,
      }),
      reminder({ id: 'bank-import', accountId: 'bank', kind: 'statement_import', createdAt: 1 }),
    ],
    settings: [
      settingsWith({
        'property-newest': ['statement_import'],
        'property-middle': ['add_transactions'],
        'property-oldest': ['statement_import'],
        'debt-newest': ['add_transactions'],
        'debt-oldest': [],
        bank: ['statement_import'],
      }),
    ],
    syncState: [
      syncStateOf('bank'),
      syncStateOf('property-newest'),
      syncStateOf('property-middle'),
      syncStateOf('property-oldest'),
    ],
  });

describe('withImplicitAccountsMerged', () => {
  it('returns every array as given when there is no property or debt account', () => {
    const rows = rowsOf({
      accounts: [account({ id: 'bank', kind: 'bank' })],
      holdings: [holding({ id: 'bank-card', accountId: 'bank' })],
      reminders: [
        reminder({ id: 'bank-import', accountId: 'bank', kind: 'statement_import', createdAt: 3 }),
      ],
      settings: [settingsWith({ bank: ['statement_import'] })],
      syncState: [syncStateOf('bank')],
    });

    const result = withImplicitAccountsMerged(rows);

    expect(result.accounts).toBe(rows.accounts);
    expect(result.holdings).toBe(rows.holdings);
    expect(result.reminders).toBe(rows.reminders);
    expect(result.settings).toBe(rows.settings);
    expect(result.syncState).toBe(rows.syncState);
  });

  it('returns every array as given when each live implicit account already carries the sentinel name and no icon or color', () => {
    const rows = rowsOf({
      accounts: [
        account({
          id: 'only-property',
          kind: 'property',
          name: IMPLICIT_ACCOUNT_STORED_NAME.property,
          icon: null,
          color: null,
        }),
        account({
          id: 'only-debt',
          kind: 'debt',
          name: IMPLICIT_ACCOUNT_STORED_NAME.debt,
          icon: null,
          color: null,
        }),
        account({ id: 'archived-debt', kind: 'debt', archivedAt: 5 }),
      ],
      holdings: [holding({ id: 'flat', accountId: 'only-property', sortOrder: 4 })],
      settings: [settingsWith({ 'only-property': ['statement_import'] })],
    });

    const result = withImplicitAccountsMerged(rows);

    expect(result.accounts).toBe(rows.accounts);
    expect(result.holdings).toBe(rows.holdings);
    expect(result.reminders).toBe(rows.reminders);
    expect(result.settings).toBe(rows.settings);
    expect(result.syncState).toBe(rows.syncState);
  });

  it('leaves the holdings, reminders and dismissals of a lone account of each kind in place, and gives it the sentinel name with no icon or color', () => {
    const rows = rowsOf({
      accounts: [
        account({ id: 'only-property', kind: 'property', name: 'My flat' }),
        account({ id: 'only-debt', kind: 'debt', name: 'Mortgage' }),
      ],
      holdings: [
        holding({ id: 'flat', accountId: 'only-property', sortOrder: 4 }),
        holding({ id: 'mortgage', accountId: 'only-debt', sortOrder: 7 }),
      ],
      reminders: [
        reminder({
          id: 'flat-import',
          accountId: 'only-property',
          kind: 'statement_import',
          createdAt: 3,
        }),
      ],
      settings: [settingsWith({ 'only-property': ['statement_import'], 'only-debt': [] })],
    });

    const result = withImplicitAccountsMerged(rows);

    expect(result.holdings).toBe(rows.holdings);
    expect(result.reminders).toBe(rows.reminders);
    expect(result.settings).toBe(rows.settings);
    expect(result.accounts).toEqual([
      {
        ...rows.accounts[0],
        name: IMPLICIT_ACCOUNT_STORED_NAME.property,
        icon: null,
        color: null,
      },
      { ...rows.accounts[1], name: IMPLICIT_ACCOUNT_STORED_NAME.debt, icon: null, color: null },
    ]);
  });

  describe('merging several live accounts of one kind into the oldest', () => {
    it('keeps the oldest account of each kind and deletes the others', () => {
      expect(accountIdsOf(withImplicitAccountsMerged(mergeScenario()))).toEqual([
        'bank',
        'debt-oldest',
        'property-oldest',
      ]);
    });

    it('gives the kept accounts the sentinel name and no icon or color, and leaves the bank alone', () => {
      const rows = mergeScenario();
      const result = withImplicitAccountsMerged(rows);

      expect(result.accounts.find((row) => row.id === 'property-oldest')).toMatchObject({
        name: 'Properties',
        icon: null,
        color: null,
      });
      expect(result.accounts.find((row) => row.id === 'debt-oldest')).toMatchObject({
        name: 'Loans',
        icon: null,
        color: null,
      });
      expect(result.accounts.find((row) => row.id === 'bank')).toBe(
        rows.accounts.find((row) => row.id === 'bank'),
      );
    });

    it('moves every holding, closed ones included, to the kept account in the old visible order', () => {
      expect(placements(withImplicitAccountsMerged(mergeScenario()))).toEqual([
        { id: 'bank-card', accountId: 'bank', sortOrder: 0 },
        { id: 'debt-newest-a', accountId: 'debt-oldest', sortOrder: 0 },
        { id: 'debt-newest-b', accountId: 'debt-oldest', sortOrder: 1 },
        { id: 'debt-oldest-a', accountId: 'debt-oldest', sortOrder: 2 },
        { id: 'middle-a', accountId: 'property-oldest', sortOrder: 2 },
        { id: 'newest-a', accountId: 'property-oldest', sortOrder: 3 },
        { id: 'newest-closed', accountId: 'property-oldest', sortOrder: 4 },
        { id: 'oldest-a', accountId: 'property-oldest', sortOrder: 1 },
        { id: 'oldest-b', accountId: 'property-oldest', sortOrder: 0 },
      ]);
    });

    it('keeps, per reminder kind, only the earliest-created reminder, re-pointed with its state unchanged', () => {
      const rows = mergeScenario();
      const result = withImplicitAccountsMerged(rows);
      const seeded = (id: string) => rows.reminders.find((row) => row.id === id);
      const merged = (id: string) => result.reminders.find((row) => row.id === id);

      expect(reminderIdsOf(result)).toEqual([
        'bank-import',
        'debt-newest-import',
        'middle-import',
        'newest-add',
      ]);
      expect(merged('middle-import')).toEqual({
        ...seeded('middle-import'),
        accountId: 'property-oldest',
      });
      expect(merged('newest-add')).toEqual({
        ...seeded('newest-add'),
        accountId: 'property-oldest',
      });
      expect(merged('debt-newest-import')).toEqual({
        ...seeded('debt-newest-import'),
        accountId: 'debt-oldest',
      });
      expect(merged('bank-import')).toBe(seeded('bank-import'));
    });

    it('unions the dismissed kinds onto the kept account and removes the deleted accounts keys', () => {
      expect(sortedDismissals(withImplicitAccountsMerged(mergeScenario()))).toEqual({
        'property-oldest': ['add_transactions', 'statement_import'],
        'debt-oldest': ['add_transactions'],
        bank: ['statement_import'],
      });
    });

    it('deletes the sync_state rows of the merged-away accounts and keeps the others', () => {
      expect(withImplicitAccountsMerged(mergeScenario()).syncState).toEqual([
        syncStateOf('bank'),
        syncStateOf('property-oldest'),
      ]);
    });

    it('keeps every holding and every holding field but its account and position', () => {
      const rows = mergeScenario();
      const result = withImplicitAccountsMerged(rows);
      const withoutPlacement = (row: Rows['holdings'][number]) => ({
        ...row,
        accountId: '',
        sortOrder: 0,
      });

      expect(result.holdings.map(withoutPlacement)).toEqual(rows.holdings.map(withoutPlacement));
    });

    it('does not mutate its input', () => {
      const rows = mergeScenario();
      const copy = JSON.parse(JSON.stringify(rows)) as Rows;

      withImplicitAccountsMerged(rows);

      expect(rows).toEqual(copy);
    });

    it('leaves a NULL dismissal map NULL', () => {
      const rows = rowsOf({
        accounts: [
          account({ id: 'first', kind: 'property', createdAt: 1 }),
          account({ id: 'second', kind: 'property', createdAt: 2 }),
        ],
        settings: [settingsWith(null)],
      });

      expect(sortedDismissals(withImplicitAccountsMerged(rows))).toBeNull();
    });

    it('leaves a settings row with no dismissal key at all as it is', () => {
      const rows = rowsOf({
        accounts: [
          account({ id: 'first', kind: 'property', createdAt: 1 }),
          account({ id: 'second', kind: 'property', createdAt: 2 }),
        ],
      });
      const legacySettings = [{ id: 1 }] as unknown as Rows['settings'];

      const result = withImplicitAccountsMerged({ ...rows, settings: legacySettings });

      expect(result.settings).toEqual([{ id: 1 }]);
    });

    it('drops an account whose only dismissals were an empty list, but keeps the map an object', () => {
      const rows = rowsOf({
        accounts: [
          account({ id: 'first', kind: 'property', createdAt: 1 }),
          account({ id: 'second', kind: 'property', createdAt: 2 }),
        ],
        settings: [settingsWith({ first: [], second: [] })],
      });

      expect(sortedDismissals(withImplicitAccountsMerged(rows))).toEqual({});
    });
  });

  describe('which account is kept on a created_at tie', () => {
    it('breaks the tie by sort_order', () => {
      const rows = rowsOf({
        accounts: [
          account({ id: 'a', kind: 'property', createdAt: 10, sortOrder: 1 }),
          account({ id: 'b', kind: 'property', createdAt: 10, sortOrder: 0 }),
        ],
        holdings: [holding({ id: 'held-by-a', accountId: 'a' })],
      });
      const result = withImplicitAccountsMerged(rows);

      expect(accountIdsOf(result)).toEqual(['b']);
      expect(placements(result)).toEqual([{ id: 'held-by-a', accountId: 'b', sortOrder: 0 }]);
    });

    it('breaks a created_at and sort_order tie by id', () => {
      const rows = rowsOf({
        accounts: [
          account({ id: 'z', kind: 'debt', createdAt: 10, sortOrder: 0 }),
          account({ id: 'a', kind: 'debt', createdAt: 10, sortOrder: 0 }),
        ],
      });

      expect(accountIdsOf(withImplicitAccountsMerged(rows))).toEqual(['a']);
    });

    it('orders tied holdings, and the holdings of tied accounts, by id', () => {
      const rows = rowsOf({
        accounts: [
          account({ id: 'z', kind: 'property', createdAt: 10, sortOrder: 0 }),
          account({ id: 'a', kind: 'property', createdAt: 10, sortOrder: 0 }),
        ],
        holdings: [
          holding({ id: 'h-z-2', accountId: 'z', sortOrder: 0, createdAt: 4 }),
          holding({ id: 'h-z-1', accountId: 'z', sortOrder: 0, createdAt: 4 }),
          holding({ id: 'h-a-1', accountId: 'a', sortOrder: 5, createdAt: 9 }),
        ],
      });

      expect(holdingIdsOf(withImplicitAccountsMerged(rows), 'a')).toEqual([
        'h-a-1',
        'h-z-1',
        'h-z-2',
      ]);
    });

    it('keeps the earliest reminder by id when two share created_at', () => {
      const rows = rowsOf({
        accounts: [
          account({ id: 'first', kind: 'property', createdAt: 1 }),
          account({ id: 'second', kind: 'property', createdAt: 2 }),
        ],
        reminders: [
          reminder({ id: 'r-b', accountId: 'first', kind: 'statement_import', createdAt: 7 }),
          reminder({ id: 'r-a', accountId: 'second', kind: 'statement_import', createdAt: 7 }),
        ],
      });
      const result = withImplicitAccountsMerged(rows);

      expect(reminderIdsOf(result)).toEqual(['r-a']);
      expect(result.reminders[0]).toMatchObject({ accountId: 'first' });
    });

    // `localeCompare` puts 'a' and 'c' before 'B'; SQLite's BINARY collation, and
    // so the migration, puts 'B' (66) before 'a' (97) and 'c' (99).
    it('compares ids by UTF-16 code unit, as SQLite BINARY collation does, never by locale', () => {
      const rows = rowsOf({
        accounts: [
          account({ id: 'c', kind: 'property', createdAt: 10, sortOrder: 0 }),
          account({ id: 'a', kind: 'property', createdAt: 10, sortOrder: 0 }),
          account({ id: 'B', kind: 'property', createdAt: 10, sortOrder: 0 }),
        ],
        holdings: [
          holding({ id: 'h-c', accountId: 'c' }),
          holding({ id: 'h-a', accountId: 'a' }),
          holding({ id: 'h-B', accountId: 'B' }),
          holding({ id: 'h-b', accountId: 'B' }),
        ],
        reminders: [
          reminder({ id: 'r-a', accountId: 'a', kind: 'statement_import', createdAt: 7 }),
          reminder({ id: 'r-B', accountId: 'c', kind: 'statement_import', createdAt: 7 }),
        ],
      });
      const result = withImplicitAccountsMerged(rows);

      expect(accountIdsOf(result)).toEqual(['B']);
      expect(holdingIdsOf(result, 'B')).toEqual(['h-B', 'h-b', 'h-a', 'h-c']);
      expect(reminderIdsOf(result)).toEqual(['r-B']);
    });
  });

  describe('an archived property or debt account', () => {
    it('is untouched by the merge and by the sentinel rename, next to live accounts', () => {
      const rows = rowsOf({
        accounts: [
          account({
            id: 'archived',
            kind: 'property',
            name: 'Old flat',
            createdAt: 1,
            archivedAt: 500,
          }),
          account({ id: 'live-first', kind: 'property', createdAt: 20 }),
          account({ id: 'live-second', kind: 'property', createdAt: 30 }),
        ],
        holdings: [
          holding({ id: 'archived-held', accountId: 'archived', sortOrder: 9 }),
          holding({ id: 'live-held', accountId: 'live-second', sortOrder: 3 }),
        ],
        reminders: [
          reminder({
            id: 'archived-import',
            accountId: 'archived',
            kind: 'statement_import',
            createdAt: 2,
          }),
          reminder({
            id: 'live-import',
            accountId: 'live-second',
            kind: 'statement_import',
            createdAt: 3,
          }),
        ],
        settings: [
          settingsWith({ archived: ['statement_import'], 'live-second': ['add_transactions'] }),
        ],
      });
      const result = withImplicitAccountsMerged(rows);

      expect(result.accounts.find((row) => row.id === 'archived')).toBe(rows.accounts[0]);
      expect(result.reminders.find((row) => row.id === 'archived-import')).toBe(rows.reminders[0]);
      expect(placements(result)).toEqual([
        { id: 'archived-held', accountId: 'archived', sortOrder: 9 },
        { id: 'live-held', accountId: 'live-first', sortOrder: 0 },
      ]);
      expect(accountIdsOf(result)).toEqual(['archived', 'live-first']);
      expect(sortedDismissals(result)).toEqual({
        archived: ['statement_import'],
        'live-first': ['add_transactions'],
      });
    });

    it('is never the kept account, however early it was created', () => {
      const rows = rowsOf({
        accounts: [
          account({ id: 'archived-debt', kind: 'debt', createdAt: 1, archivedAt: 5 }),
          account({ id: 'live-debt', kind: 'debt', createdAt: 9 }),
        ],
      });
      const result = withImplicitAccountsMerged(rows);

      expect(accountIdsOf(result)).toEqual(['archived-debt', 'live-debt']);
      expect(result.accounts.find((row) => row.id === 'live-debt')).toMatchObject({
        name: 'Loans',
        icon: null,
        color: null,
      });
      expect(result.accounts.find((row) => row.id === 'archived-debt')).toBe(rows.accounts[0]);
    });
  });

  it('is idempotent: merging an already merged set changes nothing', () => {
    const once = withImplicitAccountsMerged(mergeScenario());
    const twice = withImplicitAccountsMerged(once);

    expect(twice.accounts).toBe(once.accounts);
    expect(twice.holdings).toBe(once.holdings);
    expect(twice.reminders).toBe(once.reminders);
    expect(twice.settings).toBe(once.settings);
    expect(twice.syncState).toBe(once.syncState);
  });
});
