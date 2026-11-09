import { syncBybitLogHistory } from './bybit.log-history';
import { spotLogRow } from './bybit.history-test-fixtures';
import { ACCOUNT_ID, historyRunAt, inMemoryWalkOf, served } from './bybit.capital-test-fixtures';

type SyncDeps = NonNullable<Parameters<typeof syncBybitLogHistory>[1]>;

type WorldOptions = Parameters<typeof inMemoryWalkOf>[0] & {
  state: { marksOf: (walkName: 'log') => Record<string, unknown> };
  /** Replaces a dependency of the walk (a page reader, say). */
  overrides?: Partial<SyncDeps>;
};

/**
 * A spot log row of the page's shape, served to the window that holds `time`. No page shows a spot
 * row: the fields and words are those of the docs page's TRADE sample, and the values it does not
 * give are built. The default is the buy leg of BTCUSDT: 0.003 BTC in, with a fee of 0.000003
 * inside the change.
 */
export const spotAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(time, spotLogRow({ id: 'log-1', transactionTime: String(time), ...overrides }));

/** The USDT leg of the same fill: 300 USDT out, with no fee on this leg. */
export const quoteLegAt = (time: number, overrides: Record<string, unknown> = {}) =>
  spotAt(time, { currency: 'USDT', qty: '-300', fee: '0', change: '-300', ...overrides });

/** An entry that is no spot trade: the page's `type` word and `category`, nothing else read. */
export const entryAt = (time: number, type: string, overrides: Record<string, unknown> = {}) =>
  spotAt(time, { type, category: 'linear', ...overrides });

/** The minor units each holding was given by the rows a walk wrote. */
export const sumsByHolding = (
  rows: readonly { holdingId: string; amountMinorUnits: number }[],
): Record<string, number> => {
  const sums = new Map<string, number>();

  rows.forEach(({ holdingId, amountMinorUnits }) => {
    sums.set(holdingId, (sums.get(holdingId) ?? 0) + amountMinorUnits);
  });

  return Object.fromEntries(sums);
};

/**
 * Silences `console.warn` in each test of the calling suite. `spy` is the warn spy of the running
 * test, and `codes` the `code` of each warning it was given.
 */
export const silencedWarnings = () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  return {
    spy: () => warn,
    codes: (): unknown[] =>
      warn.mock.calls.map(([, details]) => (details as { code?: string }).code),
  };
};

/**
 * One account's log walk on the in-memory world: the rows it adds, the holdings it creates, and
 * the walk state it writes.
 */
export const logWalkOf = (worldOptions: WorldOptions) => {
  const world = inMemoryWalkOf(worldOptions);
  const { clock } = world;
  const deps: SyncDeps = { ...world.deps, ...worldOptions.overrides };

  const run = (accountId = ACCOUNT_ID) =>
    syncBybitLogHistory({ targetAccountId: accountId, run: historyRunAt(clock) }, deps);

  return {
    ...world,
    deps,
    run,
    /** The stored state text of the account, as the walk reads it. */
    readState: () => world.deps.readExchangeState(ACCOUNT_ID),
    marks: () => worldOptions.state.marksOf('log'),
  };
};
