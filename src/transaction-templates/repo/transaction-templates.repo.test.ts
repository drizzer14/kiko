// A real engine: the name check, the instr prefilter and the clear all depend on SQLite's own
// semantics (and on a write rolling back), which a fake handle would not show.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { write } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { EMPTY_DRAFT, type TemplateDraft } from '@kiko/transaction-templates/draft';

import { TemplateNameTakenError } from './template-name-taken-error';
import { toTransactionTemplate, transactionTemplatesRepo } from './transaction-templates.repo';

type StoredTemplate = {
  id: string;
  name: string;
  draft: string;
  created_at: number;
  updated_at: number;
};

const storedTemplates = (): StoredTemplate[] =>
  mockDatabase
    .prepare(
      'SELECT id, name, draft, created_at, updated_at FROM transaction_templates ORDER BY id',
    )
    .all() as StoredTemplate[];

const storedTemplate = (id: string): StoredTemplate => {
  const found = storedTemplates().find((template) => template.id === id);

  if (found === undefined) {
    throw new Error(`no stored template ${id}`);
  }

  return found;
};

const seedTemplate = (id: string, name: string, rawDraft: string, createdAt = 1000): void => {
  mockDatabase
    .prepare(
      'INSERT INTO transaction_templates (id, name, draft, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, name, rawDraft, createdAt, createdAt);
};

const draftWith = (changes: Partial<TemplateDraft>): TemplateDraft => ({
  ...EMPTY_DRAFT,
  ...changes,
});

const seedDraft = (id: string, draft: TemplateDraft, createdAt = 1000): void => {
  seedTemplate(id, `Template ${id}`, JSON.stringify(draft), createdAt);
};

const storedDraft = (id: string): unknown => JSON.parse(storedTemplate(id).draft);

const listed = async () => (await transactionTemplatesRepo.listQuery()).map(toTransactionTemplate);

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('transactionTemplatesRepo: create, list, get, update, remove', () => {
  it('creates a template and reads it back from the list', async () => {
    const draft = draftWith({ mode: 'income', description: 'Salary', category: 'salary' });

    const id = await transactionTemplatesRepo.create({ name: 'Salary', draft });
    const [template] = await listed();

    expect(template).toEqual({
      id,
      name: 'Salary',
      draft,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    });
  });

  it('lists by created_at ascending, then id', async () => {
    seedDraft('c', EMPTY_DRAFT, 3000);
    seedDraft('b', EMPTY_DRAFT, 1000);
    seedDraft('a', EMPTY_DRAFT, 3000);

    expect((await listed()).map((template) => template.id)).toEqual(['b', 'a', 'c']);
  });

  it('update changes name and draft, moves updated_at, and keeps created_at', async () => {
    seedDraft('a', EMPTY_DRAFT, 1000);
    jest.spyOn(Date, 'now').mockReturnValue(5000);
    const draft = draftWith({ description: 'Changed' });

    await transactionTemplatesRepo.update({ id: 'a', name: 'Renamed', draft });

    expect(storedTemplate('a')).toMatchObject({
      name: 'Renamed',
      created_at: 1000,
      updated_at: 5000,
    });
    expect(storedDraft('a')).toEqual(draft);
  });

  it('remove deletes only that template', async () => {
    seedDraft('a', EMPTY_DRAFT);
    seedDraft('b', EMPTY_DRAFT);

    await transactionTemplatesRepo.remove('a');

    expect(storedTemplates().map((template) => template.id)).toEqual(['b']);
  });
});

describe('transactionTemplatesRepo: the name', () => {
  it('create and update store the trimmed name', async () => {
    const id = await transactionTemplatesRepo.create({ name: '  Coffee  ', draft: EMPTY_DRAFT });

    expect(storedTemplate(id).name).toBe('Coffee');

    await transactionTemplatesRepo.update({ id, name: '  Tea ', draft: EMPTY_DRAFT });

    expect(storedTemplate(id).name).toBe('Tea');
  });

  it('create refuses a name another template holds, in any Cyrillic case and spacing', async () => {
    await transactionTemplatesRepo.create({ name: ' оренда ', draft: EMPTY_DRAFT });

    await expect(
      transactionTemplatesRepo.create({ name: 'Оренда', draft: EMPTY_DRAFT }),
    ).rejects.toBeInstanceOf(TemplateNameTakenError);

    expect(storedTemplates()).toHaveLength(1);
  });

  it('update refuses a name another template holds and changes nothing', async () => {
    seedTemplate('a', 'Оренда', JSON.stringify(EMPTY_DRAFT));
    seedTemplate('b', 'Coffee', JSON.stringify(EMPTY_DRAFT));

    await expect(
      transactionTemplatesRepo.update({
        id: 'b',
        name: ' оренда ',
        draft: draftWith({ description: 'x' }),
      }),
    ).rejects.toBeInstanceOf(TemplateNameTakenError);

    expect(storedTemplate('b')).toMatchObject({ name: 'Coffee', updated_at: 1000 });
    expect(storedDraft('b')).toEqual(EMPTY_DRAFT);
  });

  it('update to the row own name passes, even in another case', async () => {
    seedTemplate('a', 'Coffee', JSON.stringify(EMPTY_DRAFT));

    await transactionTemplatesRepo.update({ id: 'a', name: 'COFFEE', draft: EMPTY_DRAFT });

    expect(storedTemplate('a').name).toBe('COFFEE');
  });

  it('insertDatabaseTransaction runs in the caller write and rolls back with it', async () => {
    await expect(
      write(async (databaseTransaction) => {
        await transactionTemplatesRepo.insertDatabaseTransaction(databaseTransaction, {
          name: 'Rent',
          draft: EMPTY_DRAFT,
        });

        throw new Error('the transaction failed');
      }),
    ).rejects.toThrow('the transaction failed');

    expect(storedTemplates()).toEqual([]);

    const id = await write((databaseTransaction) =>
      transactionTemplatesRepo.insertDatabaseTransaction(databaseTransaction, {
        name: ' Rent ',
        draft: EMPTY_DRAFT,
      }),
    );

    expect(storedTemplate(id).name).toBe('Rent');
  });

  it('insertDatabaseTransaction refuses a taken name', async () => {
    seedTemplate('a', 'Rent', JSON.stringify(EMPTY_DRAFT));

    await expect(
      write((databaseTransaction) =>
        transactionTemplatesRepo.insertDatabaseTransaction(databaseTransaction, {
          name: 'rent',
          draft: EMPTY_DRAFT,
        }),
      ),
    ).rejects.toBeInstanceOf(TemplateNameTakenError);
  });
});

describe('transactionTemplatesRepo: a draft that cannot be read', () => {
  beforeEach(() => {
    seedTemplate('bad', 'Broken', '{"version":9}');
  });

  it('lists as the empty draft with the name kept', async () => {
    expect(await listed()).toEqual([
      { id: 'bad', name: 'Broken', draft: EMPTY_DRAFT, createdAt: 1000, updatedAt: 1000 },
    ]);
  });

  it('can still be updated and removed', async () => {
    const draft = draftWith({ description: 'Fixed' });

    await transactionTemplatesRepo.update({ id: 'bad', name: 'Fixed', draft });

    expect((await listed())[0]).toMatchObject({ name: 'Fixed', draft });

    await transactionTemplatesRepo.remove('bad');

    expect(storedTemplates()).toEqual([]);
  });

  it('is skipped by a clear and by a count', async () => {
    seedTemplate('raw', 'Raw', '{"version":9,"holdingId":"h1"}');

    await write((databaseTransaction) =>
      transactionTemplatesRepo.clearHoldingsDatabaseTransaction(databaseTransaction, ['h1']),
    );

    expect(storedTemplate('raw').draft).toBe('{"version":9,"holdingId":"h1"}');
    expect(
      await write((databaseTransaction) =>
        transactionTemplatesRepo.countReferencingHoldingsDatabaseTransaction(databaseTransaction, [
          'h1',
        ]),
      ),
    ).toBe(0);
  });
});

describe('transactionTemplatesRepo.clearHoldingsDatabaseTransaction', () => {
  const clearHoldings = (holdingIds: readonly string[]) =>
    write((databaseTransaction) =>
      transactionTemplatesRepo.clearHoldingsDatabaseTransaction(databaseTransaction, holdingIds),
    );

  it('clears the main, destination and return slots and keeps a cleared return row', async () => {
    seedDraft(
      'a',
      draftWith({
        mode: 'split',
        holdingId: 'h1',
        currency: 'UAH',
        exchange: {
          destinationHoldingId: 'h1',
          destinationCurrency: 'USD',
          valueInMinorUnits: 500,
        },
        returns: [
          { holdingId: 'h1', amountMinorUnits: 100 },
          { holdingId: 'h2', amountMinorUnits: 200 },
        ],
      }),
    );

    await clearHoldings(['h1']);

    expect(storedDraft('a')).toEqual(
      draftWith({
        mode: 'split',
        holdingId: null,
        currency: 'UAH',
        exchange: {
          destinationHoldingId: null,
          destinationCurrency: 'USD',
          valueInMinorUnits: 500,
        },
        returns: [
          { holdingId: null, amountMinorUnits: 100 },
          { holdingId: 'h2', amountMinorUnits: 200 },
        ],
      }),
    );
  });

  it('leaves updated_at as it was', async () => {
    seedDraft('a', draftWith({ holdingId: 'h1' }), 1000);
    jest.spyOn(Date, 'now').mockReturnValue(9000);

    await clearHoldings(['h1']);

    expect(storedTemplate('a')).toMatchObject({ created_at: 1000, updated_at: 1000 });
  });

  // The description is the whole id, so its JSON form holds the prefilter's needle and only the
  // exact decision can reject the row. The indented text is not what a rewrite writes, so a
  // wrongly accepted row would change bytes.
  it('leaves a template that only names the id as its description byte-equal', async () => {
    const raw = JSON.stringify(draftWith({ holdingId: 'h2', description: 'h1' }), null, 2);

    seedTemplate('a', 'Mentions', raw);

    await clearHoldings(['h1']);

    expect(storedTemplate('a')).toMatchObject({ draft: raw, updated_at: 1000 });
  });

  it('clears several ids in one call and leaves other templates alone', async () => {
    const untouched = JSON.stringify(draftWith({ holdingId: 'h3' }));

    seedDraft('a', draftWith({ holdingId: 'h1' }));
    seedDraft('b', draftWith({ holdingId: 'h2' }));
    seedTemplate('c', 'Other', untouched);

    await clearHoldings(['h1', 'h2']);

    expect((storedDraft('a') as TemplateDraft).holdingId).toBeNull();
    expect((storedDraft('b') as TemplateDraft).holdingId).toBeNull();
    expect(storedTemplate('c').draft).toBe(untouched);
  });

  it('does nothing for an empty id list', async () => {
    const raw = JSON.stringify(draftWith({ holdingId: 'h1' }));

    seedTemplate('a', 'Keep', raw);

    await clearHoldings([]);

    expect(storedTemplate('a').draft).toBe(raw);
  });

  it('handles more ids than one chunk holds', async () => {
    seedDraft('a', draftWith({ holdingId: 'h-last' }));
    const manyIds = Array.from({ length: 40000 }, (_, index) => `h-${index}`);

    await clearHoldings([...manyIds, 'h-last']);

    expect((storedDraft('a') as TemplateDraft).holdingId).toBeNull();
  });
});

describe('transactionTemplatesRepo.clearCategoryDatabaseTransaction', () => {
  const clearCategory = (key: string) =>
    write((databaseTransaction) =>
      transactionTemplatesRepo.clearCategoryDatabaseTransaction(databaseTransaction, key),
    );

  it('sets the category to null, never to the default key, and leaves updated_at', async () => {
    seedDraft('a', draftWith({ category: 'groceries', description: 'Food' }));
    seedDraft('b', draftWith({ category: 'transport' }));

    await clearCategory('groceries');

    expect(storedDraft('a')).toEqual(draftWith({ category: null, description: 'Food' }));
    expect((storedDraft('b') as TemplateDraft).category).toBe('transport');
    expect(storedTemplate('a').updated_at).toBe(1000);
  });

  // The description is the whole key, so its JSON form holds the prefilter's needle and only the
  // exact decision can reject the row. The indented text is not what a rewrite writes, so a
  // wrongly accepted row would change bytes.
  it('leaves a template that only names the key as its description byte-equal', async () => {
    const raw = JSON.stringify(
      draftWith({ category: 'transport', description: 'groceries' }),
      null,
      2,
    );

    seedTemplate('a', 'Mentions', raw);

    await clearCategory('groceries');

    expect(storedTemplate('a').draft).toBe(raw);
  });

  it('matches the key in lowercase', async () => {
    seedDraft('a', draftWith({ category: 'groceries' }));

    await clearCategory('Groceries');

    expect((storedDraft('a') as TemplateDraft).category).toBeNull();
  });
});

describe('transactionTemplatesRepo: the counts', () => {
  const countHoldings = (holdingIds: readonly string[]) =>
    write((databaseTransaction) =>
      transactionTemplatesRepo.countReferencingHoldingsDatabaseTransaction(
        databaseTransaction,
        holdingIds,
      ),
    );

  it('counts a template once when two of the holding ids sit in it', async () => {
    seedDraft(
      'a',
      draftWith({
        holdingId: 'h1',
        exchange: {
          destinationHoldingId: 'h2',
          destinationCurrency: null,
          valueInMinorUnits: null,
        },
      }),
    );

    expect(await countHoldings(['h1', 'h2'])).toBe(1);
  });

  it('counts a template once when its ids sit in two different chunks of a long id list', async () => {
    seedDraft(
      'a',
      draftWith({
        holdingId: 'h-0',
        exchange: {
          destinationHoldingId: 'h-39999',
          destinationCurrency: null,
          valueInMinorUnits: null,
        },
      }),
    );
    const manyIds = Array.from({ length: 40000 }, (_, index) => `h-${index}`);

    expect(await countHoldings(manyIds)).toBe(1);
  });

  it('counts each referencing template', async () => {
    seedDraft('a', draftWith({ holdingId: 'h1' }));
    seedDraft('b', draftWith({ returns: [{ holdingId: 'h2', amountMinorUnits: 5 }] }));
    seedDraft('c', draftWith({ holdingId: 'h3' }));

    expect(await countHoldings(['h1', 'h2'])).toBe(2);
  });

  it('counts 0 for a description-only hit', async () => {
    seedDraft('a', draftWith({ description: 'h1' }));

    expect(await countHoldings(['h1'])).toBe(0);
  });

  it('counts 0 for no ids', async () => {
    seedDraft('a', draftWith({ holdingId: 'h1' }));

    expect(await countHoldings([])).toBe(0);
  });

  it('countReferencingCategory counts templates that carry the key, not a description hit', async () => {
    seedDraft('a', draftWith({ category: 'groceries' }));
    seedDraft('b', draftWith({ category: 'groceries' }));
    seedDraft('c', draftWith({ category: 'transport', description: 'groceries' }));

    expect(await transactionTemplatesRepo.countReferencingCategory('groceries')).toBe(2);
    expect(await transactionTemplatesRepo.countReferencingCategory('Groceries')).toBe(2);
    expect(await transactionTemplatesRepo.countReferencingCategory('rent')).toBe(0);
  });
});
