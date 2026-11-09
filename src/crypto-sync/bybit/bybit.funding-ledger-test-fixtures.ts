import type { FundingMatchRow } from '@kiko/db';

import { syncBybitFundingLedger } from './bybit.funding-ledger';
import { fundingLedgerRow } from './bybit.history-test-fixtures';
import { ACCOUNT_ID, historyRunAt, inMemoryWalkOf, served } from './bybit.capital-test-fixtures';

type SyncDeps = NonNullable<Parameters<typeof syncBybitFundingLedger>[1]>;

type WorldOptions = Parameters<typeof inMemoryWalkOf>[0] & {
  state: { marksOf: (walkName: 'fundingLedger') => Record<string, unknown> };
  /** Replaces a dependency of the walk (a page reader, say). */
  overrides?: Partial<SyncDeps>;
};

/**
 * A ledger row of the page's field words, served to the window that holds `time`. Its `createTime`
 * is that instant's second. The key defaults to the instant, so two rows of one instant take a
 * `currcCursor` of their own.
 */
export const ledgerAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(
    time,
    fundingLedgerRow({
      currcCursor: `ledger-${time}`,
      createTime: String(Math.floor(time / 1_000)),
      ...overrides,
    }),
  );

/** The key a walk of `ACCOUNT_ID` stores a ledger row under. */
export const ledgerKeyOf = (currcCursor: string, coin = 'USDT'): string =>
  `${ACCOUNT_ID}:funding:${currcCursor}:${coin}`;

/**
 * One account's Funding ledger walk on the in-memory world: the ledger records it writes, and the
 * walk state it writes. It writes no transaction row, so the world's row store stays empty.
 */
export const fundingLedgerWalkOf = (worldOptions: WorldOptions) => {
  const world = inMemoryWalkOf(worldOptions);
  const { clock } = world;
  const records = new Map<string, FundingMatchRow>();
  const addTransactions = jest.fn(async (written: FundingMatchRow[]) => {
    world.record('add');

    for (const row of written) {
      records.set(row.recordKey, row);
    }

    return written.length;
  });
  const deps: SyncDeps = { ...world.deps, addTransactions, ...worldOptions.overrides };

  const run = (accountId = ACCOUNT_ID) =>
    syncBybitFundingLedger({ targetAccountId: accountId, run: historyRunAt(clock) }, deps);

  return {
    ...world,
    deps,
    run,
    /** The stored state text of the account, as the walk reads it. */
    readState: () => world.deps.readExchangeState(ACCOUNT_ID),
    marks: () => worldOptions.state.marksOf('fundingLedger'),
    /** The holding writer of the world: the ledger walk has no holding to create. */
    ensureHoldings: world.deps.ensureHoldings,
    /** The ledger records the walk wrote, by key. */
    ledgerRecords: (): FundingMatchRow[] => [...records.values()],
    ledgerKeys: (): string[] => [...records.keys()],
  };
};
