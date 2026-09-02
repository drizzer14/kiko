import type { DB } from '@op-engineering/op-sqlite';

// client.ts opens a real op-sqlite handle at module load; stub `open`
// so importing the pure `wrapClientForDrizzle` factory under test does
// not touch the native module (mirrors the repository tests' stub).
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import { wrapClientForDrizzle } from './client';

describe('wrapClientForDrizzle', () => {
  it('unwraps executeRaw().rawRows for drizzle reads (executeRawAsync)', async () => {
    // op-sqlite 18's executeRaw resolves to an OBJECT; drizzle's read path
    // (values -> all/get) expects the bare Scalar[][] row matrix and calls
    // `.map` on it directly. The wrapper must hand drizzle `.rawRows`.
    const rawRows = [
      ['a1', 100],
      ['a2', 250],
    ];
    const executeRaw = jest.fn(async () => ({
      rawRows,
      columnNames: ['id', 'balance'],
      rowsAffected: 0,
    }));
    const client = { executeRaw } as unknown as DB;

    const wrapped = wrapClientForDrizzle(client);
    const rows = await wrapped.executeRawAsync('SELECT id, balance FROM accounts WHERE k = ?', [
      'x',
    ]);

    expect(rows).toBe(rawRows);
    expect(Array.isArray(rows)).toBe(true);
    expect(executeRaw).toHaveBeenCalledWith('SELECT id, balance FROM accounts WHERE k = ?', ['x']);
  });

  it('leaves the write-path method (executeAsync) delegating unchanged', () => {
    // Writes (insert/update/delete) and the transaction begin/commit/rollback
    // go through drizzle's run() -> client.executeAsync, which the wrapper must
    // NOT alter — its rowsAffected/insertId return shape must survive intact.
    const executeAsync = jest.fn();
    const executeRaw = jest.fn();
    const client = { executeAsync, executeRaw } as unknown as DB;

    const wrapped = wrapClientForDrizzle(client);

    expect((wrapped as unknown as { executeAsync: unknown }).executeAsync).toBe(executeAsync);
  });

  it('overrides only executeRawAsync, not the underlying executeRaw reference', () => {
    const executeRaw = jest.fn();
    const client = { executeRaw } as unknown as DB;

    const wrapped = wrapClientForDrizzle(client);

    expect(wrapped.executeRawAsync).not.toBe(executeRaw);
    expect((wrapped as unknown as { executeRaw: unknown }).executeRaw).toBe(executeRaw);
  });
});
