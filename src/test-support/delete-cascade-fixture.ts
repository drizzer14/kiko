/**
 * The rows a real-SQLite test of a delete that cascades (a holding, an account)
 * starts from: a UAH card of 1000.00, an empty USD card, an empty cash holding
 * and a second UAH card (the change returns of a split), a term deposit holding
 * its opening contribution, a live-synced Monobank card, and a card of an
 * account that was disconnected. `resolveDatabase` is called per use, so a test
 * can open a fresh engine before each case.
 */
import maybe, { foldMap } from 'fnts/maybe';
import type { DatabaseSync } from 'node:sqlite';

export const OPENED = Date.UTC(2026, 8, 1, 9);
export const MOVED = Date.UTC(2026, 9, 1, 9);

const DEPOSIT_METADATA = {
  contributions: [{ amountMinorUnits: 500_000, date: OPENED }],
  annualRatePct: 10,
  termMonths: 12,
  recapitalization: true,
  compounding: 'monthly',
};

const NAMES: Record<string, string> = {
  uah: 'Hryvnia card',
  usd: 'Dollar card',
  cash: 'Cash',
  second: 'Second card',
  deposit: 'Deposit',
  bank: 'Monobank card',
  detached: 'Disconnected card',
};

type SqlParameter = string | number | null;

type RowSeed = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time?: number;
  source?: string;
  exchangeCounterpartHoldingId?: string;
  exchangePairId?: string;
  changeGroupId?: string;
};

type DeleteCascadeState = {
  balances: Record<string, number>;
  rows: string[];
  contributions: { amountMinorUnits: number; date: number }[];
};

export const deleteCascadeFixture = (resolveDatabase: () => DatabaseSync) => {
  const run = (statement: string, ...parameters: SqlParameter[]): void => {
    resolveDatabase()
      .prepare(statement)
      .run(...parameters);
  };

  const insertHolding = (
    id: string,
    type: string,
    currency: string,
    balanceMinorUnits: number,
    options: { accountId?: string; metadata?: unknown } = {},
  ): void => {
    run(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      options.accountId ?? 'account',
      NAMES[id] ?? id,
      type,
      currency,
      balanceMinorUnits,
      foldMap(maybe(options.metadata), (metadata) => JSON.stringify(metadata)) ?? null,
    );
  };

  const seedFixture = (): void => {
    run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
    run("INSERT INTO accounts (id, name, kind) VALUES ('other', 'Other bank', 'bank')");
    run("INSERT INTO accounts (id, name, kind) VALUES ('detached', 'Old bank', 'bank')");
    run(
      "INSERT INTO accounts (id, name, kind, institution) VALUES ('synced', 'Monobank', 'bank', 'monobank')",
    );
    insertHolding('uah', 'card', 'UAH', 100_000);
    insertHolding('usd', 'card', 'USD', 0);
    insertHolding('cash', 'cash', 'UAH', 0);
    insertHolding('second', 'card', 'UAH', 0);
    insertHolding('deposit', 'term_deposit', 'UAH', 0, { metadata: DEPOSIT_METADATA });
    insertHolding('bank', 'card', 'UAH', 0, {
      accountId: 'synced',
      metadata: { monobankId: 'card-bank' },
    });
    insertHolding('detached', 'card', 'UAH', 0, {
      accountId: 'detached',
      metadata: { monobankId: 'card-detached' },
    });
  };

  const insertRow = (row: RowSeed): void => {
    run(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id, exchange_counterpart_holding_id, exchange_pair_id, change_group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.holdingId,
      row.amountMinorUnits,
      row.time ?? MOVED,
      row.source ?? 'manual',
      row.source === undefined || row.source === 'manual' ? null : row.id,
      row.exchangeCounterpartHoldingId ?? null,
      row.exchangePairId ?? null,
      row.changeGroupId ?? null,
    );
  };

  const setBalance = (holdingId: string, balanceMinorUnits: number): void => {
    run('UPDATE holdings SET balance_minor_units = ? WHERE id = ?', balanceMinorUnits, holdingId);
  };

  const setContributions = (contributions: unknown[]): void => {
    run(
      "UPDATE holdings SET metadata = json_set(metadata, '$.contributions', json(?)) WHERE id = 'deposit'",
      JSON.stringify(contributions),
    );
  };

  const balancesOf = (): Record<string, number> =>
    Object.fromEntries(
      (
        resolveDatabase()
          .prepare('SELECT id, balance_minor_units AS value FROM holdings')
          .all() as {
          id: string;
          value: number;
        }[]
      ).map((holding) => [holding.id, holding.value]),
    );

  const rowIds = (): string[] =>
    (
      resolveDatabase().prepare('SELECT id FROM transactions ORDER BY id').all() as {
        id: string;
      }[]
    ).map((row) => row.id);

  const contributionsOf = (holdingId: string): DeleteCascadeState['contributions'] =>
    JSON.parse(
      (
        resolveDatabase().prepare('SELECT metadata FROM holdings WHERE id = ?').get(holdingId) as {
          metadata: string;
        }
      ).metadata,
    ).contributions;

  const stateOf = (): DeleteCascadeState => ({
    balances: balancesOf(),
    rows: rowIds(),
    contributions: contributionsOf('deposit'),
  });

  // The state a test started from, minus the holdings it deleted: their rows go
  // with them, so only the balances of the rest are compared.
  const withoutHoldings = (
    state: DeleteCascadeState,
    ...holdingIds: string[]
  ): DeleteCascadeState => ({
    ...state,
    balances: Object.fromEntries(
      Object.entries(state.balances).filter(([holdingId]) => !holdingIds.includes(holdingId)),
    ),
  });

  const idOfRowOn = (holdingId: string): string =>
    (
      resolveDatabase()
        .prepare("SELECT id FROM transactions WHERE holding_id = ? AND source = 'manual'")
        .get(holdingId) as { id: string }
    ).id;

  return {
    run,
    insertHolding,
    seedFixture,
    insertRow,
    setBalance,
    setContributions,
    balancesOf,
    rowIds,
    contributionsOf,
    stateOf,
    withoutHoldings,
    idOfRowOn,
  };
};
