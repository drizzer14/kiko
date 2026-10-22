import { IdCursorPageError, readIdCursor } from '@kiko/crypto-sync/exchange/paging';

import {
  type BudgetLane,
  type CallCost,
  COSTS,
  createBinanceHistoryRun,
} from './binance.history-budget';
import type { BinancePageWeights } from './binance.history-client';

const NOW = 1_704_326_400_000;
const LIMIT = 1_000;
const NO_WEIGHTS: BinancePageWeights = { usedUidWeight1m: undefined, usedIpWeight1m: undefined };

type Row = { id: unknown };

type Page = { rows: Row[] } & BinancePageWeights;

type Input = Parameters<typeof readIdCursor<Row, BudgetLane, CallCost, BinancePageWeights>>[0];

const freshRun = () => createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });

const pageOf = (ids: unknown[]): Page => ({ rows: ids.map((id) => ({ id })), ...NO_WEIGHTS });

/** `count` ascending ids, ten apart, from `first`. */
const idsOf = (count: number, first = 0): number[] =>
  Array.from({ length: count }, (_unused, position) => first + position * 10);

/** A server that answers each request with the next `limit` ids at or above the `fromId` asked. */
const serverOf = (ids: number[], limit: number) => {
  const requested: number[] = [];

  return {
    requested,
    fetchPage: async (fromId: number): Promise<Page> => {
      requested.push(fromId);

      return pageOf(ids.filter((id) => id >= fromId).slice(0, limit));
    },
  };
};

/** A fetch that answers each request with the next page of `pages`, whatever id it asks for. */
const pagesInOrder = (pages: Page[]) => {
  let served = 0;

  return async (): Promise<Page> => {
    const page = pages[served];

    served += 1;

    return page;
  };
};

const committingTo =
  (committed: number[], batches: number[][] = []): Input['onPage'] =>
  async ({ rows }) => {
    const ids = rows.map((row) => row.id as number);

    committed.push(...ids);
    batches.push(ids);

    return 'next';
  };

const readFrom = (
  input: Pick<Input, 'fetchPage' | 'onPage'> &
    Partial<Pick<Input, 'run' | 'lane' | 'cost' | 'keep' | 'fromId' | 'limit'>>,
) =>
  readIdCursor<Row, BudgetLane, CallCost, BinancePageWeights>({
    run: input.run ?? freshRun(),
    lane: input.lane ?? 'transfer',
    cost: input.cost ?? COSTS.transfer,
    keep: input.keep ?? 0,
    fromId: input.fromId ?? 0,
    limit: input.limit ?? LIMIT,
    fetchPage: input.fetchPage,
    idOf: (row) => row.id,
    onPage: input.onPage,
  });

describe('readIdCursor', () => {
  it('reads every page from the id asked, hands each row over once ascending, and leaves the cursor after the last id', async () => {
    const ids = idsOf(2_500);
    const server = serverOf(ids, LIMIT);
    const committed: number[] = [];

    const result = await readFrom({ ...server, onPage: committingTo(committed) });

    expect(result).toEqual({ nextFromId: ids[2_499] + 1, calls: 3, end: 'short-page' });
    expect(committed).toEqual(ids);
    expect(server.requested).toEqual([0, ids[999] + 1, ids[1_999] + 1]);
  });

  it('starts from the id it is given, not from the first id', async () => {
    const ids = idsOf(30);
    const server = serverOf(ids, LIMIT);
    const committed: number[] = [];

    const result = await readFrom({ ...server, fromId: 155, onPage: committingTo(committed) });

    expect(server.requested).toEqual([155]);
    expect(committed).toEqual(ids.filter((id) => id >= 155));
    expect(result.nextFromId).toBe(ids[29] + 1);
  });

  it.each([0, 57])('keeps the cursor at %d when the first page is empty', async (fromId) => {
    const server = serverOf([], LIMIT);
    const committed: number[] = [];

    const result = await readFrom({ ...server, fromId, onPage: committingTo(committed) });

    expect(result).toEqual({ nextFromId: fromId, calls: 1, end: 'short-page' });
    expect(committed).toEqual([]);
  });

  it('asks once more after a page of exactly the limit, and ends on the empty page', async () => {
    const ids = idsOf(LIMIT);
    const server = serverOf(ids, LIMIT);
    const committed: number[] = [];

    const result = await readFrom({ ...server, onPage: committingTo(committed) });

    expect(result).toEqual({ nextFromId: ids[LIMIT - 1] + 1, calls: 2, end: 'short-page' });
    expect(server.requested).toEqual([0, ids[LIMIT - 1] + 1]);
    expect(committed).toEqual(ids);
  });

  it('ends on the budget without a request when the lane refuses the first page', async () => {
    const run = freshRun();
    const server = serverOf(idsOf(5), LIMIT);

    run.budget.record('dust', NO_WEIGHTS);

    const result = await readFrom({
      ...server,
      run,
      lane: 'dust',
      cost: COSTS.dust,
      fromId: 40,
      onPage: committingTo([]),
    });

    expect(result).toEqual({ nextFromId: 40, calls: 0, end: 'budget' });
    expect(server.requested).toEqual([]);
  });

  it('ends on the budget, without a request, when the lane refuses the second page', async () => {
    const ids = idsOf(2_500);
    const server = serverOf(ids, LIMIT);
    const committed: number[] = [];

    const result = await readFrom({
      ...server,
      lane: 'dust',
      cost: COSTS.dust,
      onPage: committingTo(committed),
    });

    expect(result).toEqual({ nextFromId: ids[999] + 1, calls: 1, end: 'budget' });
    expect(server.requested).toEqual([0]);
    expect(committed).toEqual(ids.slice(0, LIMIT));
  });

  it('leaves the calls it was asked to keep to the caller', async () => {
    const server = serverOf(idsOf(2_500), LIMIT);
    const transferCallCap = 80;

    const result = await readFrom({
      ...server,
      keep: transferCallCap - 1,
      onPage: committingTo([]),
    });

    expect(result).toEqual({ nextFromId: 9_991, calls: 1, end: 'budget' });
    expect(server.requested).toEqual([0]);
  });

  it('stops at the id the caller answers with and asks for nothing more', async () => {
    const ids = idsOf(2_500);
    const server = serverOf(ids, LIMIT);
    const stopAt = ids[500];

    const result = await readFrom({
      ...server,
      onPage: async () => ({ stopAt }),
    });

    expect(result).toEqual({ nextFromId: stopAt, calls: 1, end: 'stopped' });
    expect(server.requested).toEqual([0]);
  });

  it('hands each page over with the id after its last row', async () => {
    const ids = idsOf(1_200);
    const server = serverOf(ids, LIMIT);
    const nextFromIds: number[] = [];

    await readFrom({
      ...server,
      onPage: async ({ nextFromId }) => {
        nextFromIds.push(nextFromId);

        return 'next';
      },
    });

    expect(nextFromIds).toEqual([ids[999] + 1, ids[1_199] + 1]);
  });

  describe('a page it cannot trust', () => {
    const FIRST_PAGE = idsOf(LIMIT);
    const AFTER_FIRST = FIRST_PAGE[LIMIT - 1] + 1;

    it.each([
      ['an id that is not a number', ['7'], 'not-safe-integer'],
      ['an id with a fraction', [1.5], 'not-safe-integer'],
      ['an id past the safe integers', [2 ** 53], 'not-safe-integer'],
      ['an id that is not finite', [Number.NaN], 'not-safe-integer'],
      ['no safe id after its last id', [Number.MAX_SAFE_INTEGER], 'not-safe-integer'],
      ['an id below the id asked', [AFTER_FIRST - 1], 'below-from-id'],
      ['an id that is not ascending', [AFTER_FIRST + 5, AFTER_FIRST + 4], 'not-ascending'],
      ['an id that repeats', [AFTER_FIRST + 5, AFTER_FIRST + 5], 'not-ascending'],
    ])('refuses a second page with %s, and never hands it over', async (_title, ids, code) => {
      const committed: number[][] = [];

      const failure = readFrom({
        fetchPage: pagesInOrder([pageOf(FIRST_PAGE), pageOf(ids)]),
        onPage: committingTo([], committed),
      });

      await expect(failure).rejects.toThrow(IdCursorPageError);
      await expect(failure).rejects.toHaveProperty('code', code);
      expect(committed).toEqual([FIRST_PAGE]);
    });

    it('refuses a second page that starts over from the first id', async () => {
      const committed: number[][] = [];

      const failure = readFrom({
        fetchPage: pagesInOrder([pageOf(FIRST_PAGE), pageOf(FIRST_PAGE)]),
        onPage: committingTo([], committed),
      });

      await expect(failure).rejects.toThrow(IdCursorPageError);
      await expect(failure).rejects.toHaveProperty('code', 'below-from-id');
      expect(committed).toEqual([FIRST_PAGE]);
    });

    it('refuses a page with more rows than the limit', async () => {
      const committed: number[][] = [];

      const failure = readFrom({
        limit: 2,
        fetchPage: pagesInOrder([pageOf([1, 2, 3])]),
        onPage: committingTo([], committed),
      });

      await expect(failure).rejects.toThrow(IdCursorPageError);
      await expect(failure).rejects.toHaveProperty('code', 'over-limit');
      expect(committed).toEqual([]);
    });

    it('refuses a first page below the id asked', async () => {
      const failure = readFrom({
        fromId: 10,
        fetchPage: pagesInOrder([pageOf([9])]),
        onPage: committingTo([]),
      });

      await expect(failure).rejects.toThrow(IdCursorPageError);
      await expect(failure).rejects.toHaveProperty('code', 'below-from-id');
    });

    it('names the code and no id in its message', async () => {
      const failure = readFrom({
        fetchPage: pagesInOrder([pageOf([123_456_789, 123_456_788])]),
        onPage: committingTo([]),
      });

      await expect(failure).rejects.toThrow('id-cursor-page: not-ascending');
    });

    it('still counts the call of the refused page against the lane', async () => {
      const recorded: string[] = [];
      const run = freshRun();

      const failure = readFrom({
        run: {
          gate: run.gate,
          budget: {
            canAfford: run.budget.canAfford,
            record: (lane) => {
              recorded.push(lane);
            },
          },
        },
        fetchPage: pagesInOrder([pageOf([2, 1])]),
        onPage: committingTo([]),
      });

      await expect(failure).rejects.toThrow(IdCursorPageError);
      expect(recorded).toEqual(['transfer']);
    });
  });

  it('lets a failed request propagate, with the first page already handed over', async () => {
    const ids = idsOf(LIMIT);
    const committed: number[][] = [];
    const failed = new Error('network down');
    const firstPage = pagesInOrder([pageOf(ids)]);
    let requests = 0;

    const failure = readFrom({
      fetchPage: async () => {
        requests += 1;

        if (requests === 2) {
          throw failed;
        }

        return firstPage();
      },
      onPage: committingTo([], committed),
    });

    await expect(failure).rejects.toBe(failed);
    expect(committed).toEqual([ids]);
  });

  it('asks the lane, waits for the gate, requests, then records the page, for every page', async () => {
    const ids = idsOf(1_200);
    const server = serverOf(ids, LIMIT);
    const events: string[] = [];

    await readFrom({
      run: {
        gate: {
          wait: async () => {
            events.push('wait');
          },
        },
        budget: {
          canAfford: (lane, cost, keep) => {
            events.push(`afford ${lane} ${JSON.stringify(cost)} ${keep}`);

            return true;
          },
          record: (lane, page) => {
            events.push(`record ${lane} ${page.usedIpWeight1m}`);
          },
        },
      },
      lane: 'earn',
      cost: COSTS.earn,
      keep: 2,
      fetchPage: async (fromId) => {
        events.push(`fetch ${fromId}`);

        return { ...(await server.fetchPage(fromId)), usedIpWeight1m: 7 };
      },
      onPage: async ({ nextFromId }) => {
        events.push(`page ${nextFromId}`);

        return 'next';
      },
    });

    expect(events).toEqual([
      'afford earn {"ip":150} 2',
      'wait',
      'fetch 0',
      'record earn 7',
      `page ${ids[999] + 1}`,
      'afford earn {"ip":150} 2',
      'wait',
      `fetch ${ids[999] + 1}`,
      'record earn 7',
      `page ${ids[1_199] + 1}`,
    ]);
  });
});

/** A seeded generator (Lehmer), so a failing run replays. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state = (state * 48_271) % 2_147_483_647;

    return state / 2_147_483_647;
  };
};

const SEEDS = Array.from({ length: 100 }, (_unused, position) => 1 + position * 13);

describe('readIdCursor over random ids', () => {
  it.each(SEEDS)(
    'hands every id over once ascending, whatever the page size, and ends after the last (seed %d)',
    async (seed) => {
      const random = seededRandom(seed);
      const limit = 1 + Math.floor(random() * 20);
      const count = Math.floor(random() * 300);
      const fromId = Math.floor(random() * 50);
      const ids = Array.from({ length: count }).reduce<number[]>(
        (all) => [...all, (all.at(-1) ?? fromId - 1) + 1 + Math.floor(random() * 9)],
        [],
      );
      const server = serverOf(ids, limit);
      const batches: number[][] = [];
      const committed: number[] = [];

      const result = await readFrom({
        ...server,
        lane: 'capitalDeposit',
        cost: COSTS.deposit,
        limit,
        fromId,
        onPage: committingTo(committed, batches),
      });

      expect(committed).toEqual(ids);
      expect(result).toEqual({
        nextFromId: count === 0 ? fromId : ids[count - 1] + 1,
        calls: Math.floor(count / limit) + 1,
        end: 'short-page',
      });
      expect(batches.every((batch) => batch.length <= limit)).toBe(true);
    },
  );
});
