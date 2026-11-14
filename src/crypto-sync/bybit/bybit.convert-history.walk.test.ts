import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { BybitRefusalError } from './bybit.client';
import { setBybitCooldownUntil } from './bybit.cooldown';
import { convertAt } from './bybit.history-test-fixtures';
import { silencedWarnings } from './bybit.log-test-fixtures';
import { syncBybitConvertHistory } from './bybit.convert-history';
import { ACCOUNT_ID, historyRunAt } from './bybit.capital-test-fixtures';
import { convertWalkOf, UNKNOWN_REFUSAL_CODE } from './bybit.convert-test-fixtures';

const AT = NOW - 2 * DAY_MS;
const LATER = AT + 100 * 1_000;
const FLOOR = NOW - 729 * DAY_MS;
const SECOND_MS = 1_000;
const LANE_PAGES = 10;
const PASS_PAGES = 1_000;
const POINT_TIME = AT + 2 * SECOND_MS;

type Row = Record<string, unknown>;

const newWalk = (
  options: Partial<Parameters<typeof convertWalkOf>[0]> = {},
  marks: Record<string, unknown> = {},
  accountId = ACCOUNT_ID,
) => {
  const state = walkStateFake({ accountId, marks: { convert: marks } });

  return convertWalkOf({ state, ...options });
};

type Walk = ReturnType<typeof newWalk>;

/** Pages of settled converts, each row a second after the one before. */
const pagesOf = (count: number, rowsPerPage = 1): Row[][] =>
  Array.from({ length: count }, (_, page) =>
    Array.from({ length: rowsPerPage }, (_, row) =>
      convertAt(LATER + (page * rowsPerPage + row) * SECOND_MS),
    ),
  );

const indexesFrom = (first: number, count: number): number[] =>
  Array.from({ length: count }, (_, offset) => first + offset);

const initAt = (time: number) => convertAt(time, { exchangeStatus: 'init' });

const initsAt = (count: number, from = AT): Row[] =>
  Array.from({ length: count }, (_, index) => initAt(from + index * SECOND_MS));

const pointAt = (time: number, since = NOW) => ({
  start: time - 1,
  end: time + 1,
  kind: 'point',
  series: 'convert',
  since,
});

const fieldsWrittenBy = (walk: Walk): string[][] =>
  (walk.deps.patchExchangeState as jest.Mock).mock.calls.map(([, patches]) =>
    (patches as { field: string }[]).map(({ field }) => field).sort(),
  );

/** Ten pages of one convert each, the one on page 3 as the status says. */
const listWith = (status: string): Row[][] =>
  pagesOf(LANE_PAGES).map((page, index) =>
    index === 2 ? [convertAt(POINT_TIME, { exchangeStatus: status })] : page,
  );

const MAX_RUNS = 150;

/**
 * Runs until the cursor moves off `cursorBefore`, which only the end of a pass does, and at most
 * `MAX_RUNS` times, so a pass that never ends fails a test instead of hanging it. `whileOpen`
 * checks the marks after each run that left the pass open.
 */
const runsUntilPassEnds = async <Result>(
  walk: Walk,
  run: () => Promise<Result>,
  { cursorBefore, whileOpen }: { cursorBefore?: unknown; whileOpen?: () => void } = {},
): Promise<Result[]> => {
  const results: Result[] = [];

  while (results.length < MAX_RUNS) {
    results.push(await run());

    if (walk.marks().cursor !== cursorBefore) {
      break;
    }

    whileOpen?.();
  }

  return results;
};

describe('the convert walk: the pass', () => {
  const warned = silencedWarnings();

  describe('the pages of a pass', () => {
    it('reads by index to an empty page, one call each, and moves the cursor to the start of the run', async () => {
      const walk = newWalk();
      walk.serve(pagesOf(3, 2));

      const result = await walk.run();

      expect(walk.indexes).toEqual([1, 2, 3, 4]);
      expect(result).toEqual({ imported: 12, complete: true });
      expect(walk.marks()).toEqual({ cursor: NOW, pending: [], passOwed: [], pageIndex: 1 });
    });

    it('resumes at the stored index', async () => {
      const walk = newWalk({}, { pageIndex: 4 });
      walk.serve(pagesOf(5));

      await walk.run();

      expect(walk.indexes).toEqual([4, 5, 6]);
    });

    it('reads at most 10 pages a run and keeps the next page, with no cursor, until the pass ends', async () => {
      const walk = newWalk();
      walk.serve(pagesOf(25));

      const first = await walk.run();

      expect(walk.indexes).toEqual(indexesFrom(1, LANE_PAGES));
      expect(first).toEqual({ imported: 20, complete: false });
      expect(walk.marks()).toEqual({ pageIndex: 11 });

      walk.indexes.length = 0;
      await walk.run();

      expect(walk.indexes).toEqual(indexesFrom(11, LANE_PAGES));
      expect(walk.marks()).toEqual({ pageIndex: 21 });

      walk.indexes.length = 0;
      const last = await walk.run();

      expect(walk.indexes).toEqual([21, 22, 23, 24, 25, 26]);
      expect(last).toEqual({ imported: 10, complete: true });
      expect(walk.marks()).toEqual({ cursor: NOW, pending: [], passOwed: [], pageIndex: 1 });
    });

    it('writes the marks of a page in one write, with the index of the page after it', async () => {
      const walk = newWalk();
      walk.serve([[initAt(AT)], pagesOf(1)[0]]);

      await walk.run();

      expect(fieldsWrittenBy(walk)).toEqual([
        ['pageIndex', 'passOwed', 'pending'],
        ['pageIndex'],
        ['cursor', 'pageIndex', 'passOwed', 'pending'],
      ]);
    });

    it('never moves the cursor back', async () => {
      const walk = newWalk({}, { cursor: NOW + DAY_MS });
      walk.serve(pagesOf(1));

      await walk.run();

      expect(walk.marks().cursor).toBe(NOW + DAY_MS);
    });
  });

  describe('reads by index to an empty page, resumes at the stored index, and an empty page, a repeated page, an unknown refusal past page 1 and the page limit each end the pass and move the cursor', () => {
    it('a repeated page ends the pass without reading its rows again', async () => {
      const walk = newWalk({ pastEnd: 'repeat' });
      walk.serve(pagesOf(2));

      const result = await walk.run();

      expect(walk.indexes).toEqual([1, 2, 3]);
      expect(result).toEqual({ imported: 4, complete: true });
      expect(walk.marks().cursor).toBe(NOW);
    });

    it('a page that shares only some keys with the page before does not end the pass', async () => {
      const [first, second, third] = [convertAt(AT), convertAt(AT + SECOND_MS), convertAt(AT + 2)];
      const walk = newWalk();
      walk.serve([[first, second], [first, third], [convertAt(AT + 3 * SECOND_MS)]]);

      await walk.run();

      expect(walk.indexes).toEqual([1, 2, 3, 4]);
      expect(walk.rows()).toHaveLength(8);
    });

    it('two pages of rows that cannot be read are not taken for a repeat', async () => {
      const unreadable = ['not a row'] as unknown as Row[];
      const walk = newWalk();
      walk.serve([unreadable, unreadable, []]);

      await walk.run();

      expect(walk.indexes).toEqual([1, 2, 3]);
    });

    it('a refusal of the class any other at index 2 or more ends the pass and moves the cursor', async () => {
      const walk = newWalk({ pastEnd: 'refuse' });
      walk.serve(pagesOf(1));

      const result = await walk.run();

      expect(walk.indexes).toEqual([1, 2]);
      expect(result).toEqual({ imported: 2, complete: true });
      expect(walk.marks().cursor).toBe(NOW);
    });

    it('a refusal of the class any other at index 1 rejects the run and moves no mark', async () => {
      const walk = newWalk({ refuseAt: { index: 1, retCode: UNKNOWN_REFUSAL_CODE } });

      await expect(walk.run()).rejects.toMatchObject({ refusal: 'unknown' });

      expect(walk.marks()).toEqual({});
    });

    it('a refusal with a Bybit code of the class any other ends the pass at page 3 and keeps the point owed on the pages before it', async () => {
      const walk = newWalk({ refuseAt: { index: 3, retCode: UNKNOWN_REFUSAL_CODE } });
      walk.serve([[initAt(AT)], pagesOf(1)[0]]);

      const result = await walk.run();

      expect(walk.indexes).toEqual([1, 2, 3]);
      expect(result).toEqual({ imported: 2, complete: true });
      expect(walk.marks()).toEqual({
        cursor: NOW,
        pending: [pointAt(AT)],
        passOwed: [],
        pageIndex: 1,
      });
    });

    it.each<[string, number, boolean]>([
      ['the lowest Bybit code, 10000, is the end of the list', 10_000, true],
      ['a code below it, 9999, is no end of the list', 9_999, false],
    ])('%s', async (_title, retCode, endsPass) => {
      const walk = newWalk({ refuseAt: { index: 2, retCode } });
      walk.serve(pagesOf(2));

      if (endsPass) {
        await expect(walk.run()).resolves.toEqual({ imported: 2, complete: true });
        expect(walk.marks().cursor).toBe(NOW);
      } else {
        await expect(walk.run()).rejects.toMatchObject({ refusal: 'unknown', code: retCode });
        expect(walk.marks()).toEqual({ pageIndex: 2 });
      }
    });

    it.each([500, 502, 503])(
      'an HTTP %i with no Bybit code at page 3 rejects the run, keeps the point owed on the pages before it and moves no cursor',
      async (status) => {
        const walk = newWalk({ httpFailAt: { index: 3, status } });
        walk.serve([[initAt(AT)], ...pagesOf(2)]);

        await expect(walk.run()).rejects.toMatchObject({ refusal: 'unknown', code: status });

        expect(walk.indexes).toEqual([1, 2, 3]);
        expect(walk.marks()).toEqual({
          pending: [pointAt(AT)],
          passOwed: [pointAt(AT)],
          pageIndex: 3,
        });
      },
    );

    it('a later run resumes at the page an HTTP failure stopped at, and the point owed before it is not lost', async () => {
      const state = walkStateFake({ accountId: ACCOUNT_ID, marks: { convert: {} } });
      const pages = [[initAt(AT)], ...pagesOf(2)];
      const failing = convertWalkOf({ state, httpFailAt: { index: 3, status: 502 } });
      failing.serve(pages);

      await expect(failing.run()).rejects.toMatchObject({ code: 502 });

      const recovered = convertWalkOf({ state });
      recovered.serve(pages);
      await recovered.run();

      expect(recovered.indexes).toEqual([3, 4]);
      expect(recovered.marks()).toEqual({
        cursor: NOW,
        pending: [pointAt(AT)],
        passOwed: [],
        pageIndex: 1,
      });
    });

    it('an HTTP failure at page 1 rejects the run and moves no mark', async () => {
      const walk = newWalk({ httpFailAt: { index: 1, status: 502 } });

      await expect(walk.run()).rejects.toMatchObject({ refusal: 'unknown', code: 502 });

      expect(walk.marks()).toEqual({});
    });

    it('a refusal of the key at a later page still rejects the run and keeps the pass where it is', async () => {
      const walk = newWalk({ refuseAt: { index: 3, retCode: 10005 } });
      walk.serve(pagesOf(5));

      await expect(walk.run()).rejects.toBeInstanceOf(BybitRefusalError);

      expect(walk.indexes).toEqual([1, 2, 3]);
      expect(walk.marks()).toEqual({ pageIndex: 3 });
    });

    it('a rate refusal ends the run, puts the account on its cooldown and moves no mark', async () => {
      const accountId = 'acc-cooling-after-refusal';
      const walk = newWalk({ refuseAt: { index: 2, retCode: 10006 } }, {}, accountId);
      walk.serve(pagesOf(5));

      const result = await walk.run(accountId);

      expect(result).toEqual({ imported: 2, complete: false });
      expect(walk.marks()).toEqual({ pageIndex: 2 });
      expect(walk.indexes).toEqual([1, 2]);
    });

    it('the page limit ends a list that wraps to page 1, after 1,000 pages', async () => {
      const walk = newWalk({ pastEnd: 'wrap' });
      walk.serve(pagesOf(2));

      const results = await runsUntilPassEnds(walk, () => walk.run());

      expect(walk.indexes).toHaveLength(PASS_PAGES);
      expect(walk.indexes.at(-1)).toBe(PASS_PAGES);
      expect(results).toHaveLength(PASS_PAGES / LANE_PAGES);
      expect(results.at(-1)).toMatchObject({ complete: true });
      expect(walk.marks()).toEqual({ cursor: NOW, pending: [], passOwed: [], pageIndex: 1 });
    });

    it('ends the pass at page 1,000 and reads no page after it', async () => {
      const walk = newWalk({ pastEnd: 'wrap' }, { pageIndex: PASS_PAGES - 1 });
      walk.serve(pagesOf(2));

      await walk.run();

      expect(walk.indexes).toEqual([PASS_PAGES - 1, PASS_PAGES]);
      expect(walk.marks().cursor).toBe(NOW);
    });

    it('commits the rows and the points of the last page before the pass ends', async () => {
      const walk = newWalk({ pastEnd: 'wrap' }, { pageIndex: PASS_PAGES });
      walk.serve([[], [initAt(AT), convertAt(AT + SECOND_MS)]]);

      await walk.run();

      expect(walk.indexes).toEqual([PASS_PAGES]);
      expect(walk.keys()).toHaveLength(2);
      expect(walk.marks().pending).toEqual([pointAt(AT)]);
    });
  });

  describe('a run that does not read', () => {
    it('makes no read while the account cools', async () => {
      setBybitCooldownUntil('acc-cooling', NOW + 60_000);
      const walk = newWalk({}, {}, 'acc-cooling');
      walk.serve(pagesOf(1));

      const result = await walk.run('acc-cooling');

      expect(result).toEqual({ imported: 0, complete: false });
      expect(walk.indexes).toEqual([]);
    });

    it('makes no read with no key, and reports itself complete', async () => {
      const walk = newWalk({ overrides: { readCredentials: async () => undefined } });
      walk.serve(pagesOf(1));

      const result = await walk.run();

      expect(result).toEqual({ imported: 0, complete: true });
      expect(walk.indexes).toEqual([]);
    });

    it('makes no read when the lane has no call left', async () => {
      const walk = newWalk();
      const run = historyRunAt(walk.clock);
      walk.serve(pagesOf(1));

      for (let call = 0; call < LANE_PAGES; call += 1) {
        run.budget.record('convert', {});
      }

      const result = await syncBybitConvertHistory({ targetAccountId: ACCOUNT_ID, run }, walk.deps);

      expect(result).toEqual({ imported: 0, complete: false });
      expect(walk.indexes).toEqual([]);
    });
  });

  describe('the points of a pass', () => {
    it('an init on page 3 stays owed with its first time through an empty last page, in a pass over two runs, at any cut, and leaves only at the end of a pass that reads it settled', async () => {
      const walk = newWalk();
      walk.serve(listWith('init'));

      await walk.run();

      expect(walk.indexes).toEqual(indexesFrom(1, LANE_PAGES));
      expect(walk.marks()).toEqual({
        pageIndex: 11,
        passOwed: [pointAt(POINT_TIME)],
        pending: [pointAt(POINT_TIME)],
      });

      walk.clock.now = NOW + DAY_MS;
      await walk.run();

      expect(walk.indexes.at(-1)).toBe(11);
      expect(walk.marks()).toEqual({
        cursor: NOW + DAY_MS,
        pageIndex: 1,
        passOwed: [],
        pending: [pointAt(POINT_TIME)],
      });

      walk.clock.now = NOW + 2 * DAY_MS;
      walk.serve(listWith('success'));
      await walk.run();

      expect(walk.keys()).toContain(`acc-1:convert:convert-${POINT_TIME}:BTC:ETH:BTC:unified`);
      expect(walk.marks()).toEqual({
        cursor: NOW + DAY_MS,
        pageIndex: 11,
        passOwed: [],
        pending: [pointAt(POINT_TIME)],
      });

      walk.clock.now = NOW + 3 * DAY_MS;
      await walk.run();

      expect(walk.marks()).toEqual({
        cursor: NOW + 3 * DAY_MS,
        pageIndex: 1,
        passOwed: [],
        pending: [],
      });
    });

    it.each(Array.from({ length: 42 }, (_, index) => [index + 1]))(
      'a cut before write %i loses neither the point nor its first time and imports every row',
      async (cutAt) => {
        let isCut = false;
        const walk = newWalk({
          beforeWrite: (writeNumber) => {
            if (writeNumber === cutAt && !isCut) {
              isCut = true;

              throw new Error('cut');
            }
          },
        });
        const attempt = () =>
          walk.run().catch((error: Error) => {
            if (error.message !== 'cut') {
              throw error;
            }

            return walk.run();
          });

        walk.serve(listWith('init'));

        await runsUntilPassEnds(walk, attempt);

        expect(walk.marks().pending).toEqual([pointAt(POINT_TIME)]);
        expect(walk.keys()).toHaveLength(18);

        walk.clock.now = NOW + DAY_MS;
        walk.serve(listWith('success'));

        await runsUntilPassEnds(walk, attempt, {
          cursorBefore: walk.marks().cursor,
          whileOpen: () => expect(walk.marks().pending).toEqual([pointAt(POINT_TIME)]),
        });

        expect(walk.marks().pending).toEqual([]);
        expect(walk.keys()).toHaveLength(20);
      },
    );

    it('keeps the first time of a point that a later pass reads again, still waiting', async () => {
      const walk = newWalk();
      walk.serve(listWith('init'));

      await walk.run();
      walk.clock.now = NOW + DAY_MS;
      await walk.run();
      walk.clock.now = NOW + 2 * DAY_MS;
      await walk.run();
      walk.clock.now = NOW + 3 * DAY_MS;
      await walk.run();

      expect(walk.marks().pending).toEqual([pointAt(POINT_TIME, NOW)]);
    });

    it('keeps the time a stored point was first owed when the pass that resumes reads it again', async () => {
      const stored = pointAt(POINT_TIME, NOW - 5 * DAY_MS);
      const walk = newWalk({}, { pageIndex: 3, passOwed: [stored], pending: [stored] });
      walk.serve(listWith('init'));

      await walk.run();

      expect(walk.indexes.slice(0, 2)).toEqual([3, 4]);
      expect(walk.marks().pending).toEqual([stored]);
    });
  });

  describe('the bound of owed points', () => {
    it('over twelve points in a pass become one range with the earliest time', async () => {
      const walk = newWalk();
      walk.serve([initsAt(13), ...pagesOf(LANE_PAGES - 1)]);

      await walk.run();

      const range = { start: AT - 1, end: AT + 12 * SECOND_MS + 1, series: 'convert' };

      expect(walk.marks()).toEqual({ pageIndex: 11, passOwed: [range], pending: [range] });
    });

    it('twelve points in a pass stay twelve points', async () => {
      const walk = newWalk();
      walk.serve([initsAt(12), ...pagesOf(LANE_PAGES - 1)]);

      await walk.run();

      const { passOwed, pending } = walk.marks() as { passOwed: unknown[]; pending: unknown[] };

      expect(passOwed).toEqual(initsAt(12).map((_, index) => pointAt(AT + index * SECOND_MS)));
      expect(pending).toEqual(passOwed);
    });

    it('counts the points of every page of a pass', async () => {
      const walk = newWalk();
      walk.serve([initsAt(7), initsAt(6, AT + 20 * SECOND_MS)]);

      await walk.run();

      expect(walk.marks().pending).toEqual([
        { start: AT - 1, end: AT + 25 * SECOND_MS + 1, series: 'convert' },
      ]);
    });

    it('holds a pass that waits on every convert to one range, however many pages it reads', async () => {
      const walk = newWalk();
      const times = Array.from({ length: 30 }, (_, page) => AT + page * SECOND_MS);
      walk.serve(times.map((time) => [initAt(time)]));

      await runsUntilPassEnds(walk, () => walk.run(), {
        whileOpen: () => expect((walk.marks().pending as unknown[]).length).toBeLessThanOrEqual(13),
      });

      const pending = walk.marks().pending as { start: number; end: number }[];

      expect(pending.filter((ground) => !('kind' in ground))).toEqual([
        { start: AT - 1, end: AT + 25 * SECOND_MS + 1, series: 'convert' },
      ]);
      expect(
        times.every((time) => pending.some((ground) => ground.start <= time && time <= ground.end)),
      ).toBe(true);
    });

    it('merges the ranges of a pass that read over two runs into one', async () => {
      const walk = newWalk({ overrides: { ensureHoldings: async () => undefined } });
      walk.serve(pagesOf(11));

      await walk.run();

      expect(walk.marks().pending).toEqual([{ start: FLOOR, end: NOW, series: 'convert' }]);

      walk.clock.now = NOW + DAY_MS;
      await walk.run();

      expect(walk.marks().pending).toEqual([
        { start: FLOOR, end: NOW + DAY_MS, series: 'convert' },
      ]);
    });
  });

  describe('a list of owed ground that cannot be read', () => {
    it('repairs it to the whole ground before the cursor, and the end of the pass replaces it', async () => {
      const cursor = NOW - DAY_MS;
      const walk = newWalk({}, { cursor, pending: 'not a list' });
      walk.serve(pagesOf(11));

      await walk.run();

      expect(walk.marks().pending).toEqual([{ start: FLOOR, end: cursor }]);
      expect(warned.codes()).toContain('pending-malformed');

      await walk.run();

      expect(walk.marks().pending).toEqual([]);
    });
  });
});
