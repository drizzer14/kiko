import { transferRow } from './bybit.history-test-fixtures';
import { createBybitHistoryRun } from './bybit.history-budget';
import { syncBybitTransferHistory } from './bybit.transfer-history';
import { ACCOUNT_ID, inMemoryWalkOf, served } from './bybit.capital-test-fixtures';

type SyncDeps = NonNullable<Parameters<typeof syncBybitTransferHistory>[1]>;

type WorldOptions = Parameters<typeof inMemoryWalkOf>[0] & {
  state: { marksOf: (walkName: 'transfer') => Record<string, unknown> };
  /** Replaces a dependency of the walk (a page reader, say). */
  overrides?: Partial<SyncDeps>;
};

/**
 * A transfer of the page's shape, served to the window that holds `time`. No page with a row was
 * read live: the fields and the words are those of the docs page's sample, and a value it does
 * not give is built. The default is a move from Funding to Unified of half a coin of BTC.
 */
export const transferAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(
    time,
    transferRow({
      transferId: 'transfer-1',
      timestamp: String(time),
      coin: 'BTC',
      amount: '0.5',
      fromAccountType: 'FUND',
      toAccountType: 'UNIFIED',
      ...overrides,
    }),
  );

/**
 * One account's transfer walk on the in-memory world: the rows it adds, the holdings it creates,
 * and the walk state it writes.
 */
export const transferWalkOf = (worldOptions: WorldOptions) => {
  const world = inMemoryWalkOf(worldOptions);
  const { clock } = world;
  const deps = { ...world.deps, ...worldOptions.overrides };

  const run = (accountId = ACCOUNT_ID) =>
    syncBybitTransferHistory(
      {
        targetAccountId: accountId,
        run: createBybitHistoryRun({ now: () => clock.now, sleep: async () => undefined }),
      },
      deps,
    );

  return {
    ...world,
    deps,
    run,
    marks: () => worldOptions.state.marksOf('transfer'),
  };
};
