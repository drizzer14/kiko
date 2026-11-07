import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { BybitRefusalError } from './bybit.client';
import { isBybitCoolingDown } from './bybit.cooldown';
import { BybitHistoryParseError } from './bybit.history-client';
import { logWalkOf, silencedWarnings, spotAt } from './bybit.log-test-fixtures';
import { ACCOUNT_ID, CURSOR_PREFIX, readsOf, served } from './bybit.capital-test-fixtures';

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;
const SECOND_MS = 1_000;
const WINDOW_MS = 7 * DAY_MS;

type StateWorld = Parameters<typeof walkStateFake>[0];

const newWalk = (
  options: Partial<Parameters<typeof logWalkOf>[0]> = {},
  accountId = ACCOUNT_ID,
  marks: Record<string, unknown> = { cursor: CURSOR },
  world: StateWorld = {},
) =>
  logWalkOf({
    state: walkStateFake({ accountId, marks: { log: marks }, ...world }),
    ...options,
  });

type Walk = ReturnType<typeof newWalk>;

const storedDenseSpans = async (walk: Walk) =>
  (JSON.parse((await walk.readState()) ?? '{}') as { denseSpans?: unknown }).denseSpans;

/** A stored state that already holds a dense-span mark of the log series. */
const markedAt = (start: number): StateWorld => ({
  unknown: { keys: { denseSpans: { log: start } } },
});

const denseWritesOf = (walk: Walk): unknown[] =>
  (walk.deps.patchExchangeState as jest.Mock).mock.calls
    .flatMap(([, patches]) => patches as { kind: string }[])
    .filter(({ kind }) => kind === 'denseSpans');

// Every row of this suite is built on the field words of the docs page's TRADE sample: no page with
// a spot row was read live.
describe('the log walk: windows, pages and marks', () => {
  const warned = silencedWarnings();

  it('the floor is 729 days back, and the forward windows are 7 days from there with no cursor', async () => {
    const floor = NOW - 729 * DAY_MS;
    const walk = newWalk({}, ACCOUNT_ID, {});

    const result = await walk.run();

    expect(walk.reads.map((read) => [read.startTime, read.endTime - read.startTime])).toEqual(
      Array.from({ length: 20 }, (_, index) => [floor + index * WINDOW_MS, WINDOW_MS]),
    );
    expect(walk.marks().cursor).toBe(floor + 20 * WINDOW_MS);
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('reads the log route only, at most 20 windows a run, one call for each', async () => {
    const walk = newWalk({}, ACCOUNT_ID, {});

    await walk.run();

    expect(readsOf(walk.reads, 'log')).toHaveLength(20);
    expect(walk.reads).toHaveLength(20);
  });

  it('reports itself complete once the forward windows reach the end of time', async () => {
    const walk = newWalk();

    expect(await walk.run()).toEqual({ imported: 0, complete: true });
  });

  it('a span commits the same rows whatever the page order', async () => {
    const orders = ['ascending', 'descending', 'scrambled'] as const;
    const written = await Promise.all(
      orders.map(async (order) => {
        const walk = newWalk({ fake: { pageSize: 2, order } });
        walk.world.log = [
          ...[0, 1, 2, 3, 4, 5, 6].map((index) =>
            spotAt(AT + index * SECOND_MS, { id: `t${index}` }),
          ),
          spotAt(AT + 3 * SECOND_MS, { id: 'tie-b' }),
          spotAt(AT + 3 * SECOND_MS, { id: 'tie-a' }),
        ];

        await walk.run();

        return {
          calls: (walk.deps.addTransactions as jest.Mock).mock.calls,
          pages: readsOf(walk.reads, 'log').length,
        };
      }),
    );

    expect(written[0].calls[0][0]).toHaveLength(9);
    expect(written[0].pages).toBeGreaterThan(2);
    expect(written[1].calls).toEqual(written[0].calls);
    expect(written[2].calls).toEqual(written[0].calls);
  });

  it('follows the cursor of a page and stores none of them', async () => {
    const walk = newWalk({ fake: { pageSize: 2 } });
    walk.world.log = [0, 1, 2, 3, 4].map((index) =>
      spotAt(AT + index * SECOND_MS, { id: `t${index}` }),
    );

    await walk.run();

    expect(readsOf(walk.reads, 'log').map((read) => read.cursor)).toEqual([
      undefined,
      `${CURSOR_PREFIX}2`,
      `${CURSOR_PREFIX}4`,
    ]);
    expect(walk.keys()).toHaveLength(5);
    expect(JSON.stringify((walk.deps.patchExchangeState as jest.Mock).mock.calls)).not.toContain(
      CURSOR_PREFIX,
    );
  });

  it('a row of the whole second before the span start is in its reach, so it is no drift', async () => {
    const walk = newWalk({ fake: { secondLevelStart: true } }, ACCOUNT_ID, {
      cursor: CURSOR + 500,
    });
    walk.world.log = [spotAt(CURSOR, { id: 'edge' })];

    await walk.run();

    expect(walk.keys()).toHaveLength(1);
    expect(warned.codes()).not.toContain('bybit-page-drift');
  });

  it('the rolling floor drops owed ground it passes unread, points too, and cuts a range that reaches back past it', async () => {
    const floor = NOW - 729 * DAY_MS;
    const owed = [
      { start: NOW - 740 * DAY_MS, end: NOW - 739 * DAY_MS, series: 'log' },
      {
        start: NOW - 735 * DAY_MS - 1,
        end: NOW - 735 * DAY_MS + 1,
        kind: 'point',
        series: 'log',
        since: NOW - 740 * DAY_MS,
      },
      { start: NOW - 740 * DAY_MS, end: floor + DAY_MS, series: 'log' },
    ];
    const walk = newWalk({}, ACCOUNT_ID, { cursor: NOW, pending: owed });

    await walk.run();

    expect(walk.reads.filter((read) => read.startTime < NOW - WINDOW_MS)).toEqual([
      expect.objectContaining({ startTime: floor, endTime: floor + DAY_MS }),
    ]);
  });

  describe('a stop that is not one record', () => {
    it('owes the span of a page that drifted in the forward pass, imports the next window, and moves the cursor on', async () => {
      const walk = newWalk({}, ACCOUNT_ID, { cursor: NOW - 10 * DAY_MS });
      walk.world.log = [
        served(
          NOW - 9 * DAY_MS,
          spotAt(NOW - 9 * DAY_MS, {
            id: 'drifted',
            transactionTime: String(NOW - 30 * DAY_MS),
          }).row,
        ),
        spotAt(AT, { id: 'next-window' }),
      ];

      const result = await walk.run();

      expect(walk.keys()).toEqual([`acc-1:log:next-window:TRADE:${AT}:BTC`]);
      expect(walk.marks().cursor).toBe(NOW);
      expect(walk.marks().pending).toEqual([
        { start: NOW - 10 * DAY_MS, end: NOW - 3 * DAY_MS, series: 'log' },
      ]);
      expect(result.complete).toBe(false);
      expect(warned.codes()).toContain('bybit-page-drift');
    });

    it('owes the span of a page that drifted in the re-scan', async () => {
      const walk = newWalk({}, ACCOUNT_ID, { cursor: NOW });
      walk.world.log = [spotAt(AT, { id: 'drifted', transactionTime: String(NOW - 100 * DAY_MS) })];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([{ start: NOW - WINDOW_MS, end: NOW, series: 'log' }]);
    });
  });

  describe('the marks', () => {
    it('writes the restart mark when a re-scan that was begun ends, and no mark of the other walks', async () => {
      const walk = newWalk({}, ACCOUNT_ID, { cursor: CURSOR, rescan: NOW - 20 * DAY_MS });

      await walk.run();

      expect(walk.marks()).toEqual({
        cursor: NOW,
        cursorReadAt: NOW,
        rescan: Date.UTC(2017, 0, 1),
        pending: [],
      });
    });

    it('writes the cursor of the span it read and nothing else when the pass is whole', async () => {
      const walk = newWalk();

      await walk.run();

      expect(walk.marks()).toEqual({ cursor: NOW, cursorReadAt: NOW, pending: [] });
    });
  });

  describe('a burst of rows in one window', () => {
    // 1,200 rows over the 3 days of the forward window: the lane's 1,000 rows never hold it.
    const burstOf = (walk: Walk) => {
      walk.world.log = Array.from({ length: 1_200 }, (_unused, index) =>
        spotAt(CURSOR + index * 216_000, { id: `row-${index}` }),
      );
    };

    it('a run that commits half a window starts the next at the span it left, never at the whole window', async () => {
      const walk = newWalk();
      burstOf(walk);
      await walk.run();
      await walk.run();
      walk.reads.length = 0;

      expect(walk.marks().cursor).toBe(CURSOR + 1.5 * DAY_MS);

      await walk.run();

      expect(walk.reads[0]).toEqual(
        expect.objectContaining({
          startTime: CURSOR + 1.5 * DAY_MS,
          endTime: CURSOR + 2.25 * DAY_MS,
        }),
      );
    });
  });

  describe('the span that one second of rows fills', () => {
    const SPAN_START = NOW - 1_500;
    const sameInstant = (count: number, at: number) =>
      Array.from({ length: count }, (_unused, index) => spotAt(at, { id: `burst-${index}` }));

    const walkOfFullLane = () => {
      const walk = newWalk({ fake: { pageSize: 1 } }, ACCOUNT_ID, { cursor: SPAN_START });
      walk.world.log = sameInstant(25, NOW - 1_400);

      return walk;
    };

    it('a span at the floor that a full lane cannot finish writes one mark, and a later run that is stuck there writes none', async () => {
      const walk = walkOfFullLane();

      await walk.run();

      expect(denseWritesOf(walk)).toEqual([]);

      await walk.run();

      expect(denseWritesOf(walk)).toEqual([
        { kind: 'denseSpans', series: 'log', start: SPAN_START },
      ]);
      expect(await storedDenseSpans(walk)).toEqual({ log: SPAN_START });

      await walk.run();
      await walk.run();

      expect(denseWritesOf(walk)).toHaveLength(1);
      expect(walk.marks().cursor).toBe(SPAN_START);
    });

    it('a budget stop after an earlier read writes none', async () => {
      const start = NOW - WINDOW_MS - 500;
      const walk = newWalk({ fake: { pageSize: 1 } }, ACCOUNT_ID, { cursor: start });
      walk.world.log = [
        ...Array.from({ length: 15 }, (_unused, index) =>
          spotAt(start + (index + 1) * SECOND_MS, { id: `early-${index}` }),
        ),
        ...sameInstant(10, NOW - 300),
      ];

      await walk.run();

      expect(readsOf(walk.reads, 'log')).toHaveLength(20);
      expect(walk.marks().cursor).toBe(start + WINDOW_MS);
      expect(denseWritesOf(walk)).toEqual([]);
    });

    it('a span of more than a second that a full lane cannot finish splits and writes none', async () => {
      const walk = walkOfFullLane();

      await walk.run();

      expect(denseWritesOf(walk)).toEqual([]);
      expect(await storedDenseSpans(walk)).toBeUndefined();
    });

    // Ground outside the forward pass lies behind the cursor, which held the lane there, so a split
    // to the millisecond reaches a span that fits, and it never writes the mark. The floor case is
    // over a lane's rows inside one millisecond: the range stays owed and no mark shows.
    it('a span of a second or less that a full lane cannot finish splits outside the forward pass, and writes no mark', async () => {
      const owed = { start: NOW - 20 * DAY_MS, end: NOW - 20 * DAY_MS + 900, series: 'log' };
      const walk = newWalk({ fake: { pageSize: 1 } }, ACCOUNT_ID, { cursor: NOW, pending: [owed] });
      walk.world.log = sameInstant(25, owed.start);

      const widthOfOwedRead = async (): Promise<number> => {
        walk.reads.length = 0;
        await walk.run();

        return Math.min(
          ...readsOf(walk.reads, 'log')
            .filter(({ startTime }) => startTime >= owed.start - SECOND_MS && startTime < owed.end)
            .map(({ startTime, endTime }) => endTime - startTime),
        );
      };
      const widths: number[] = [];

      for (let run = 0; run < 12; run += 1) {
        widths.push(await widthOfOwedRead());
      }

      expect(widths).toEqual([900, 450, 225, 112, 56, 28, 14, 7, 3, 1, 1, 1]);
      expect(denseWritesOf(walk)).toEqual([]);
      expect(await storedDenseSpans(walk)).toBeUndefined();
      expect(walk.marks().pending).toEqual([expect.objectContaining({ start: owed.start })]);
    });

    it('the commit past the span drops its mark, and a commit that ends where the mark starts leaves it', async () => {
      const stands = newWalk({}, ACCOUNT_ID, { cursor: NOW }, markedAt(NOW));
      const passed = newWalk({}, ACCOUNT_ID, { cursor: CURSOR }, markedAt(CURSOR));

      await stands.run();
      await passed.run();

      expect(await storedDenseSpans(stands)).toEqual({ log: NOW });
      expect(denseWritesOf(stands)).toEqual([]);
      expect(denseWritesOf(passed)).toEqual([{ kind: 'denseSpans', series: 'log', start: null }]);
      expect(await storedDenseSpans(passed)).toBeUndefined();
    });

    it('a floor that passes the span drops its mark through the commit of the first span after it, once however many spans commit', async () => {
      const walk = newWalk({}, ACCOUNT_ID, {}, markedAt(NOW - 800 * DAY_MS));

      await walk.run();

      expect(readsOf(walk.reads, 'log').length).toBeGreaterThan(1);
      expect(denseWritesOf(walk)).toEqual([{ kind: 'denseSpans', series: 'log', start: null }]);
      expect(await storedDenseSpans(walk)).toBeUndefined();
    });
  });

  describe('a failed read', () => {
    it('stops at a rate refusal: nothing else is asked, the account cools, and the marks stay', async () => {
      const walk = newWalk({ fake: { refuse: { series: 'log', retCode: 10006 } } }, 'acc-cool');

      const result = await walk.run('acc-cool');

      expect(result).toEqual({ imported: 0, complete: false });
      expect(walk.reads).toHaveLength(1);
      expect(isBybitCoolingDown('acc-cool', NOW + 1)).toBe(true);
      expect(walk.marks().cursor).toBe(CURSOR);
    });

    it('rejects on a refused key, with no read after it', async () => {
      const walk = newWalk({ fake: { refuse: { series: 'log', retCode: 10005 } } });

      await expect(walk.run()).rejects.toBeInstanceOf(BybitRefusalError);

      expect(walk.reads).toHaveLength(1);
    });

    it('rejects on a page that holds no list, and keeps the cursor', async () => {
      const walk = newWalk({ fake: { malformed: 'log' } });

      await expect(walk.run()).rejects.toBeInstanceOf(BybitHistoryParseError);

      expect(walk.marks().cursor).toBe(CURSOR);
    });

    it('makes no read and imports nothing without a stored key', async () => {
      const walk = newWalk({ overrides: { readCredentials: async () => undefined } });

      expect(await walk.run()).toEqual({ imported: 0, complete: true });
      expect(walk.reads).toEqual([]);
    });
  });
});
