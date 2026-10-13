// A deleted holding or category stays in a template as an empty field. The clearing runs in the
// SAME write as the delete, so only a real engine shows both that the draft is rewritten and that
// a delete that fails takes the rewrite back with it.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

const mockClearToken = jest.fn();
jest.mock('@kiko/monobank/token', () => ({
  clearToken: (accountId: string) => mockClearToken(accountId),
}));

const mockClearCredentials = jest.fn();
jest.mock('@kiko/crypto-sync/binance', () => ({
  clearCredentials: (accountId: string) => mockClearCredentials(accountId),
}));

import { DatabaseSync } from 'node:sqlite';
import { accountsRepo } from '@kiko/accounts';
import { categoriesRepo } from '@kiko/categories/repo';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { deleteCascadeFixture } from '@kiko/test-support/delete-cascade-fixture';
import { EMPTY_DRAFT, type TemplateDraft } from '@kiko/transaction-templates/draft';

const { seedFixture } = deleteCascadeFixture(() => mockDatabase);

const seedDraft = (id: string, draft: TemplateDraft): void => {
  mockDatabase
    .prepare(
      'INSERT INTO transaction_templates (id, name, draft, created_at, updated_at) VALUES (?, ?, ?, 1000, 1000)',
    )
    .run(id, `Template ${id}`, JSON.stringify(draft));
};

const storedDraftText = (id: string): string =>
  (
    mockDatabase.prepare('SELECT draft FROM transaction_templates WHERE id = ?').get(id) as {
      draft: string;
    }
  ).draft;

const storedDraft = (id: string): unknown => JSON.parse(storedDraftText(id));

const storedUpdatedAt = (id: string): number =>
  (
    mockDatabase.prepare('SELECT updated_at FROM transaction_templates WHERE id = ?').get(id) as {
      updated_at: number;
    }
  ).updated_at;

// Every slot a holding can sit in: the page holding, the exchange destination and a return row.
// The second return row names a holding of a synced account, which no test here deletes.
const naming = (holdingId: string | null, category: string | null = null): TemplateDraft => ({
  ...EMPTY_DRAFT,
  mode: 'exchange',
  holdingId,
  category,
  exchange: { destinationHoldingId: holdingId, destinationCurrency: 'USD', valueInMinorUnits: 100 },
  returns: [
    { holdingId, amountMinorUnits: 500 },
    { holdingId: 'bank', amountMinorUnits: 300 },
  ],
});

// A failing final delete: the trigger aborts after the clearing step has already run.
const failDeletesFrom = (table: string): void => {
  mockDatabase.exec(
    `CREATE TRIGGER fail_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'delete failed'); END`,
  );
};

beforeEach(() => {
  mockClearToken.mockReset();
  mockClearCredentials.mockReset();
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  seedFixture();
});

describe('deleting a holding clears it in the templates', () => {
  it('empties that holding in every slot, keeps a cleared return row, and leaves the rest', async () => {
    seedDraft('named', naming('uah', 'groceries'));
    seedDraft('other', naming('usd'));
    const otherBefore = storedDraftText('other');

    await transactionsRepo.removeHolding('uah');

    expect(storedDraft('named')).toEqual(naming(null, 'groceries'));
    expect(storedDraftText('other')).toBe(otherBefore);
  });

  it('does not touch a template that only names the id in its description, nor updated_at', async () => {
    seedDraft('text', { ...EMPTY_DRAFT, description: 'uah' });
    seedDraft('named', naming('uah'));
    const textBefore = storedDraftText('text');

    await transactionsRepo.removeHolding('uah');

    expect(storedDraftText('text')).toBe(textBefore);
    expect(storedUpdatedAt('named')).toBe(1000);
  });

  it('rolls the template rewrite back when the holding delete fails', async () => {
    seedDraft('named', naming('uah'));
    const before = storedDraftText('named');
    failDeletesFrom('holdings');

    await expect(transactionsRepo.removeHolding('uah')).rejects.toThrow();

    expect(storedDraftText('named')).toBe(before);
  });
});

describe('deleting an account clears every holding of it in the templates', () => {
  it('empties each holding of the account and leaves a holding of another account', async () => {
    seedDraft('first', naming('uah'));
    seedDraft('second', naming('second'));
    seedDraft('elsewhere', naming('bank'));
    const elsewhereBefore = storedDraftText('elsewhere');

    await accountsRepo.remove('account');

    expect(storedDraft('first')).toEqual(naming(null));
    expect(storedDraft('second')).toEqual(naming(null));
    expect(storedDraftText('elsewhere')).toBe(elsewhereBefore);
  });

  it('rolls the template rewrite back when the account delete fails', async () => {
    seedDraft('first', naming('uah'));
    const before = storedDraftText('first');
    failDeletesFrom('accounts');

    await expect(accountsRepo.remove('account')).rejects.toThrow();

    expect(storedDraftText('first')).toBe(before);
  });
});

describe('deleting a category clears it in the templates', () => {
  const insertGroceriesRow = (): void => {
    mockDatabase
      .prepare(
        "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, category) VALUES ('row', 'uah', -100, 1, 'manual', 'groceries')",
      )
      .run();
  };

  const rowCategory = (): string =>
    (
      mockDatabase.prepare("SELECT category FROM transactions WHERE id = 'row'").get() as {
        category: string;
      }
    ).category;

  it('sets the category to null, never the default, and still moves the transactions', async () => {
    seedDraft('groceries', { ...EMPTY_DRAFT, holdingId: 'uah', category: 'groceries' });
    seedDraft('transport', { ...EMPTY_DRAFT, category: 'transport' });
    insertGroceriesRow();
    const transportBefore = storedDraftText('transport');

    await categoriesRepo.delete('groceries');

    expect(storedDraft('groceries')).toEqual({ ...EMPTY_DRAFT, holdingId: 'uah', category: null });
    expect(storedDraftText('transport')).toBe(transportBefore);
    expect(rowCategory()).toBe('other');
  });

  it('rolls the template rewrite back when the category delete fails', async () => {
    seedDraft('groceries', { ...EMPTY_DRAFT, category: 'groceries' });
    const before = storedDraftText('groceries');
    failDeletesFrom('categories');

    await expect(categoriesRepo.delete('groceries')).rejects.toThrow();

    expect(storedDraftText('groceries')).toBe(before);
  });
});

describe('the delete plan counts the templates a holdings delete changes', () => {
  it('counts one template that names two of the holdings once', async () => {
    seedDraft('both', {
      ...naming('uah'),
      exchange: { destinationHoldingId: 'usd', destinationCurrency: 'USD', valueInMinorUnits: 100 },
    });
    seedDraft('unrelated', naming('deposit'));

    expect((await transactionsRepo.removeHoldingsPlan(['uah', 'usd'])).templatesChanged).toBe(1);
  });

  it('counts a template that names the id only in its description as none', async () => {
    seedDraft('text', { ...EMPTY_DRAFT, description: 'uah' });

    expect((await transactionsRepo.removeHoldingsPlan(['uah'])).templatesChanged).toBe(0);
  });

  it('counts none when no template exists', async () => {
    expect((await transactionsRepo.removeHoldingsPlan(['uah'])).templatesChanged).toBe(0);
  });
});
