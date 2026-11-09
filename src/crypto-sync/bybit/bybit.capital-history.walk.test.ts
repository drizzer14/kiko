import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import {
  ACCOUNT_ID,
  CURSOR_PREFIX,
  type SentRead,
  capitalWalkOf,
  readsOf,
  served,
} from './bybit.capital-test-fixtures';
import { BybitRefusalError } from './bybit.client';
import { NOW } from './bybit.client-test-fixtures';
import { isBybitCoolingDown } from './bybit.cooldown';
import { BybitHoldingMissingError } from './bybit.walk-run';
import { BYBIT_RESTART_FLOOR_MS } from './bybit.restart-floor';
import { BybitHistoryParseError, fetchInternalDepositPage } from './bybit.history-client';
import { depositRow, internalDepositRow, withdrawalRow } from './bybit.history-test-fixtures';

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;
const SECOND_MS = 1_000;
const WINDOW_MS = 29 * DAY_MS;

const newWalk = (
  options: Partial<Parameters<typeof capitalWalkOf>[0]> = {},
  accountId = ACCOUNT_ID,
  marks: Record<string, unknown> = { cursor: CURSOR },
) =>
  capitalWalkOf({
    state: walkStateFake({ accountId, marks: { capital: marks } }),
    ...options,
  });

const depositAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(time, depositRow({ successAt: String(time), coin: 'BTC', amount: '0.5', ...overrides }));

const internalAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(
    time,
    internalDepositRow({
      createdTime: String(time / SECOND_MS),
      coin: 'BTC',
      amount: '0.25',
      ...overrides,
    }),
  );

const withdrawalAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(
    time,
    withdrawalRow({
      createTime: String(time),
      updateTime: String(time + SECOND_MS),
      coin: 'BTC',
      amount: '0.125',
      ...overrides,
    }),
  );

const startsOf = (reads: SentRead[]): number[] => reads.map((read) => read.startTime);

const loggedCodes = (warn: jest.SpyInstance): unknown[] =>
  warn.mock.calls.map(([, details]) => (details as { code?: string }).code);

describe('the capital walk: windows, pages and marks', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('a span commits the same rows whatever the page order', async () => {
    const orders = ['ascending', 'descending', 'scrambled'] as const;
    const written = await Promise.all(
      orders.map(async (order) => {
        const walk = newWalk({ fake: { pageSize: 2, order } });
        walk.world.deposit = [0, 1, 2, 3, 4, 5, 6].map((index) =>
          depositAt(AT + index * SECOND_MS, { id: `d${index}` }),
        );
        walk.world.internal = [0, 1, 2].map((index) =>
          internalAt(AT + index * SECOND_MS, { id: `i${index}` }),
        );
        walk.world.withdraw = [0, 1, 2, 3].map((index) =>
          withdrawalAt(AT + index * SECOND_MS, { withdrawId: `w${index}` }),
        );

        await walk.run();

        return {
          calls: (walk.deps.addTransactions as jest.Mock).mock.calls,
          pages: readsOf(walk.reads, 'deposit').length,
        };
      }),
    );

    expect(written[0].calls[0][0]).toHaveLength(14);
    expect(written[0].pages).toBeGreaterThan(2);
    expect(written[1].calls).toEqual(written[0].calls);
    expect(written[2].calls).toEqual(written[0].calls);
  });

  it('follows the cursor of a page and stores none of them', async () => {
    const walk = newWalk({ fake: { pageSize: 2 } });
    walk.world.deposit = [0, 1, 2, 3, 4].map((index) =>
      depositAt(AT + index * SECOND_MS, { id: `d${index}` }),
    );

    await walk.run();

    const forward = readsOf(walk.reads, 'deposit').slice(0, 3);

    expect(forward.map((read) => read.cursor)).toEqual([
      undefined,
      `${CURSOR_PREFIX}2`,
      `${CURSOR_PREFIX}4`,
    ]);
    expect(walk.keys()).toHaveLength(5);
    expect(JSON.stringify((walk.deps.patchExchangeState as jest.Mock).mock.calls)).not.toContain(
      CURSOR_PREFIX,
    );
  });

  it('the floor is 729 days back, and the forward windows start there with no cursor', async () => {
    const floor = NOW - 729 * DAY_MS;
    const walk = newWalk({}, ACCOUNT_ID, {});

    const result = await walk.run();

    expect(startsOf(readsOf(walk.reads, 'deposit'))).toEqual(
      Array.from({ length: 10 }, (_, index) => floor + index * WINDOW_MS),
    );
    expect(walk.marks().cursor).toBe(floor + 10 * WINDOW_MS);
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('reads at most 10 windows of 3 series in a run, one call for each, and none after the lane is spent', async () => {
    const walk = newWalk({}, ACCOUNT_ID, {});

    await walk.run();

    expect(walk.reads).toHaveLength(30);
    expect(readsOf(walk.reads, 'internal')).toHaveLength(10);
    expect(readsOf(walk.reads, 'withdraw')).toHaveLength(10);
  });

  it('reports itself complete once the forward windows reach the end of time', async () => {
    const walk = newWalk();

    expect(await walk.run()).toEqual({ imported: 0, complete: true });
  });

  it('13 digits read as ms, 10 as the whole second, and any other time owes its span in its own series while the others go on', async () => {
    const walk = newWalk();
    walk.world.deposit = [
      depositAt(AT, { id: 'ms' }),
      served(
        AT + SECOND_MS,
        depositRow({ id: 'seconds', coin: 'BTC', successAt: String((AT + SECOND_MS) / SECOND_MS) }),
      ),
      served(
        AT + 2 * SECOND_MS,
        depositRow({ id: 'twelve', coin: 'BTC', successAt: '174272816300' }),
      ),
      served(
        AT + 3 * SECOND_MS,
        depositRow({ id: 'fourteen', coin: 'BTC', successAt: '17427281630000' }),
      ),
    ];
    walk.world.internal = [internalAt(AT + 4 * SECOND_MS)];

    await walk.run();

    expect(walk.rows().map(({ externalId, time }) => [externalId, time])).toEqual([
      ['acc-1:deposit:ms:BTC', AT],
      ['acc-1:deposit:seconds:BTC', AT + SECOND_MS],
      ['acc-1:internal:5678:BTC', AT + 4 * SECOND_MS],
    ]);
    expect(walk.marks().pending).toEqual([{ start: CURSOR, end: NOW, series: 'deposit' }]);
    expect(walk.marks().cursor).toBe(NOW);
    expect(loggedCodes(warn)).not.toContain('bybit-page-drift');
  });

  it('a deposit with no time makes no row, owes its span in the deposit series only, moves the other series and gives no page drift, and imports once a later read shows its time, and a 70011 with no time still removes its row', async () => {
    const walk = newWalk();
    walk.world.deposit = [depositAt(AT, { id: 'rolled-back' })];
    await walk.run();
    walk.clock.now = NOW + 5 * DAY_MS;
    const created = NOW + 10 * SECOND_MS;
    const withNoTime = (id: string, fields: Record<string, unknown>, offset: number) =>
      served(created + offset * SECOND_MS, depositRow({ id, coin: 'BTC', ...fields }));
    const noTimeForms = ['', '0', undefined];
    walk.world.deposit = [
      served(AT, depositRow({ id: 'rolled-back', status: 70011, successAt: '', coin: 'BTC' })),
      ...noTimeForms.flatMap((successAt, form) => [
        withNoTime(`pending-${form}`, { status: 0, successAt }, form * 3),
        withNoTime(`settled-${form}`, { status: 3, depositType: '0', successAt }, form * 3 + 1),
        withNoTime(`held-20-${form}`, { status: 3, depositType: '20', successAt }, form * 3 + 2),
      ]),
    ];
    walk.world.internal = [internalAt(created + 20 * SECOND_MS, { id: 'moves-on' })];
    warn.mockClear();

    await walk.run();

    expect(walk.keys()).toEqual(['acc-1:internal:moves-on:BTC']);
    expect(walk.deps.removeTransactions).toHaveBeenLastCalledWith([
      'acc-1:deposit:rolled-back:BTC',
    ]);
    expect(walk.marks().cursor).toBe(NOW + 5 * DAY_MS);
    expect(walk.marks().pending).toEqual([
      { start: NOW, end: NOW + 5 * DAY_MS, series: 'deposit' },
    ]);
    expect(loggedCodes(warn)).not.toContain('bybit-page-drift');

    walk.clock.now = NOW + 40 * DAY_MS;
    walk.reads.length = 0;
    await walk.run();

    const owedReads = walk.reads.filter((read) => read.startTime === NOW);
    const stillOwed = (walk.marks().pending as { start: number; series?: string }[]).filter(
      (ground) => ground.series === 'deposit' && ground.start === NOW,
    );

    expect(owedReads.map((read) => read.series)).toEqual(['deposit']);
    expect(stillOwed).toHaveLength(1);

    walk.world.deposit = [
      served(
        created,
        depositRow({ id: 'late', coin: 'BTC', status: 3, successAt: String(created) }),
      ),
    ];
    await walk.run();

    expect(walk.keys()).toContain('acc-1:deposit:late:BTC');
    expect(
      (walk.marks().pending as { series?: string }[]).filter(
        (ground) => ground.series === 'deposit',
      ),
    ).toEqual([]);
  });

  describe('a stop that is not one record', () => {
    it('owes only the series whose page drifted in the forward pass, and moves the cursor and the other series on', async () => {
      const walk = newWalk();
      walk.world.deposit = [
        served(
          AT,
          depositRow({ id: 'drifted', coin: 'BTC', successAt: String(CURSOR - 10 * DAY_MS) }),
        ),
      ];
      walk.world.internal = [internalAt(AT)];

      const result = await walk.run();

      expect(walk.keys()).toEqual(['acc-1:internal:5678:BTC']);
      expect(walk.marks().cursor).toBe(NOW);
      expect(walk.marks().pending).toEqual([{ start: CURSOR, end: NOW, series: 'deposit' }]);
      expect(result.complete).toBe(false);
      expect(loggedCodes(warn)).toContain('bybit-page-drift');
    });

    it('owes only the series whose page drifted in the re-scan, and commits the others', async () => {
      const walk = newWalk({}, ACCOUNT_ID, { cursor: NOW });
      walk.world.deposit = [
        served(
          AT,
          depositRow({ id: 'drifted', coin: 'BTC', successAt: String(NOW - 100 * DAY_MS) }),
        ),
      ];
      walk.world.internal = [internalAt(AT)];

      await walk.run();

      expect(walk.keys()).toEqual(['acc-1:internal:5678:BTC']);
      expect(walk.marks().pending).toEqual([
        { start: NOW - WINDOW_MS, end: NOW, series: 'deposit' },
      ]);
    });

    it('reads a withdrawal as no drift while either of its times is in the span, and as drift when neither is', async () => {
      const walk = newWalk();
      const created = CURSOR - 10 * DAY_MS;
      walk.world.withdraw = [
        withdrawalAt(AT, {
          withdrawId: 'updated-in',
          status: 'Pending',
          createTime: String(created),
          updateTime: String(AT),
        }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([
        { start: created - 1, end: created + 1, kind: 'point', series: 'withdraw', since: NOW },
      ]);
      expect(loggedCodes(warn)).not.toContain('bybit-page-drift');

      const drifting = newWalk({}, 'acc-drift');
      drifting.world.withdraw = [
        withdrawalAt(AT, { createTime: String(created), updateTime: String(created + DAY_MS) }),
      ];

      await drifting.run('acc-drift');

      expect(loggedCodes(warn)).toContain('bybit-page-drift');
    });

    it('rejects the run and moves no mark when a holding cannot be found for a row', async () => {
      const walk = newWalk({ overrides: { ensureHoldings: jest.fn(async () => undefined) } });
      walk.world.deposit = [depositAt(AT)];

      const run = walk.run();

      await expect(run).rejects.toThrow(BybitHoldingMissingError);
      await expect(run).rejects.toHaveProperty('code', 'capital-holding-missing');
      expect(walk.keys()).toEqual([]);
      expect(walk.marks().cursor).toBe(CURSOR);
      expect(walk.marks().pending).toBeUndefined();
    });
  });

  describe('the marks', () => {
    it('writes the restart mark when a re-scan that was begun ends, and no mark of the other coins', async () => {
      const walk = newWalk({}, ACCOUNT_ID, { cursor: CURSOR, rescan: NOW - 20 * DAY_MS });

      await walk.run();

      expect(walk.marks()).toEqual({
        cursor: NOW,
        cursorReadAt: NOW,
        rescan: BYBIT_RESTART_FLOOR_MS,
        pending: [],
      });
    });

    it('writes the cursor of the span it read and nothing of the other coins when the pass is whole', async () => {
      const walk = newWalk();

      await walk.run();

      expect(walk.marks()).toEqual({ cursor: NOW, cursorReadAt: NOW, pending: [] });
    });
  });

  describe('a failed read', () => {
    it('stops at a rate refusal: nothing else is asked, the account cools, and the marks stay', async () => {
      const walk = newWalk({ fake: { refuse: { series: 'deposit', retCode: 10006 } } }, 'acc-cool');

      const result = await walk.run('acc-cool');

      expect(result).toEqual({ imported: 0, complete: false });
      expect(walk.reads).toHaveLength(1);
      expect(isBybitCoolingDown('acc-cool', NOW + 1)).toBe(true);
      expect(isBybitCoolingDown('acc-cool', NOW + 61_000)).toBe(false);
      expect(walk.marks().cursor).toBe(CURSOR);

      await walk.run('acc-cool');

      expect(walk.reads).toHaveLength(1);
    });

    it('rejects on a refused key, with no read after it', async () => {
      const walk = newWalk({ fake: { refuse: { series: 'internal', retCode: 10005 } } });

      await expect(walk.run()).rejects.toBeInstanceOf(BybitRefusalError);

      expect(walk.reads.map((read) => read.series)).toEqual(['deposit', 'internal']);
    });

    it('rejects on a page that holds no list, and keeps the cursor', async () => {
      const walk = newWalk({ fake: { malformed: 'withdraw' } });

      await expect(walk.run()).rejects.toBeInstanceOf(BybitHistoryParseError);

      expect(walk.marks().cursor).toBe(CURSOR);
    });

    it('reads on past an owed window that cannot be parsed, then rejects with its error', async () => {
      const owed = { start: NOW - 40 * DAY_MS, end: NOW - 39 * DAY_MS, series: 'internal' };
      const walk = newWalk(
        {
          overrides: {
            fetchInternalDepositPage: jest.fn(async (apiKey, secret, read, options) => {
              if (read.span.start === owed.start) {
                throw new BybitHistoryParseError();
              }

              return fetchInternalDepositPage(apiKey, secret, read, options);
            }),
          },
        },
        ACCOUNT_ID,
        { cursor: CURSOR, pending: [owed] },
      );
      walk.world.deposit = [depositAt(AT)];

      await expect(walk.run()).rejects.toBeInstanceOf(BybitHistoryParseError);

      expect(walk.keys()).toEqual(['acc-1:deposit:1234:BTC']);
      expect(walk.marks().cursor).toBe(NOW);
    });

    it('makes no read and imports nothing without a stored key', async () => {
      const walk = newWalk({ overrides: { readCredentials: async () => undefined } });

      expect(await walk.run()).toEqual({ imported: 0, complete: true });
      expect(walk.reads).toEqual([]);
    });
  });
});
