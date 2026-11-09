// The planner of a rolling floor never gives an empty forward pass and an empty re-scan beside owed
// ground: both float with the clock of the run. The guard defends against that shape all the same
// (a clock far back), so this suite replaces the planner with one that gives it.
jest.mock('@kiko/crypto-sync/exchange/walk', () => {
  const actual = jest.requireActual('@kiko/crypto-sync/exchange/walk');

  return {
    ...actual,
    planWalkPasses: (input: unknown) => ({
      ...actual.planWalkPasses(input),
      forward: [],
      rescan: [],
    }),
  };
});

import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { depositRow, withdrawalRow } from './bybit.history-test-fixtures';
import { ACCOUNT_ID, capitalWalkOf, served } from './bybit.capital-test-fixtures';

const OWED_AT = NOW - 60 * DAY_MS;

const newWalk = (marks: Record<string, unknown>) =>
  capitalWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { capital: { cursor: NOW, ...marks } } }),
  });

describe('the capital walk with nothing to read forward or behind', () => {
  it('owed ground is read when forward and re-scan are empty', async () => {
    const walk = newWalk({
      pending: [{ start: OWED_AT, end: OWED_AT + DAY_MS, series: 'deposit' }],
    });
    walk.world.deposit = [
      served(OWED_AT + 1_000, depositRow({ coin: 'BTC', successAt: String(OWED_AT + 1_000) })),
    ];

    const result = await walk.run();

    expect(walk.reads.map((read) => [read.series, read.startTime])).toEqual([['deposit', OWED_AT]]);
    expect(result.imported).toBe(1);
    expect(walk.marks().pending).toEqual([]);
  });

  it('reads an owed point the same way, in its own series', async () => {
    const createdAt = NOW - 40 * DAY_MS;
    const walk = newWalk({
      pending: [
        { start: createdAt - 1, end: createdAt + 1, kind: 'point', series: 'withdraw', since: NOW },
      ],
    });
    walk.world.withdraw = [
      served(createdAt, withdrawalRow({ coin: 'BTC', createTime: String(createdAt) })),
    ];

    const result = await walk.run();

    expect(walk.reads.map((read) => read.series)).toEqual(['withdraw']);
    expect(result.imported).toBe(1);
    expect(walk.marks().pending).toEqual([]);
  });

  it('makes no read and reports itself incomplete when no list holds anything', async () => {
    const walk = newWalk({});

    const result = await walk.run();

    expect(walk.reads).toEqual([]);
    expect(result).toEqual({ imported: 0, complete: false });
  });
});
