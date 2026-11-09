import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { BybitRefusalError } from './bybit.client';
import { isBybitCoolingDown } from './bybit.cooldown';
import { silencedWarnings } from './bybit.log-test-fixtures';
import { BYBIT_RESCAN_WINDOWS_MS } from './bybit.rescan-window';
import { fundingLedgerRow } from './bybit.history-test-fixtures';
import { NOW, answerWith, envelopeOf } from './bybit.client-test-fixtures';
import { BybitHistoryParseError, fetchFundingLedgerPage } from './bybit.history-client';
import { ACCOUNT_ID, CURSOR_PREFIX, readsOf, served } from './bybit.capital-test-fixtures';
import { fundingLedgerWalkOf, ledgerAt, ledgerKeyOf } from './bybit.funding-ledger-test-fixtures';

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;
const SECOND_MS = 1_000;
const HOUR_MS = 3_600_000;
const WINDOW_MS = BYBIT_RESCAN_WINDOWS_MS.fundingLedger;

type StateWorld = Parameters<typeof walkStateFake>[0];

const newWalk = (
  options: Partial<Parameters<typeof fundingLedgerWalkOf>[0]> = {},
  accountId = ACCOUNT_ID,
  marks: Record<string, unknown> = { cursor: CURSOR },
  world: StateWorld = {},
) =>
  fundingLedgerWalkOf({
    state: walkStateFake({ accountId, marks: { fundingLedger: marks }, ...world }),
    ...options,
  });

type Walk = ReturnType<typeof newWalk>;

const storedDenseSpans = async (walk: Walk) =>
  (JSON.parse((await walk.readState()) ?? '{}') as { denseSpans?: unknown }).denseSpans;

/** A stored state that already holds a dense-span mark of the ledger series. */
const markedAt = (start: number): StateWorld => ({
  unknown: { keys: { denseSpans: { fundingLedger: start } } },
});

const denseWritesOf = (walk: Walk): unknown[] =>
  (walk.deps.patchExchangeState as jest.Mock).mock.calls
    .flatMap(([, patches]) => patches as { kind: string }[])
    .filter(({ kind }) => kind === 'denseSpans');

/**
 * A route that answers each cursor with the page the test scripted, read by the real parser, for a
 * span that holds the instant `at`, and with an empty page for any other span.
 */
const scriptedPages =
  (at: number, pages: Record<string, { list: unknown[]; nextPageCursor: string }>) =>
  (...[apiKey, secret, read, options]: Parameters<typeof fetchFundingLedgerPage>) =>
    fetchFundingLedgerPage(apiKey, secret, read, {
      ...options,
      fetchImpl: answerWith({
        body: envelopeOf(
          0,
          read.span.start <= at && at <= read.span.end
            ? pages[read.cursor ?? 'first']
            : { list: [], nextPageCursor: '' },
        ),
      }).fetchImpl,
    });

// Every row of this suite is built on the field words of the page's one sample: no page with a
// real row was read live.
describe('the Funding ledger walk: windows, pages and marks', () => {
  const warned = silencedWarnings();

  it('the floor is 729 days back, and the forward windows are 7 days from there with no cursor', async () => {
    const floor = NOW - 729 * DAY_MS;
    const walk = newWalk({}, ACCOUNT_ID, {});

    const result = await walk.run();

    expect(walk.reads.map((read) => [read.startTime, read.endTime - read.startTime])).toEqual(
      Array.from({ length: 20 }, (_unused, index) => [floor + index * WINDOW_MS, WINDOW_MS]),
    );
    expect(walk.marks().cursor).toBe(floor + 20 * WINDOW_MS);
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('reads the ledger route only, at most 20 windows a run, one call for each', async () => {
    const walk = newWalk({}, ACCOUNT_ID, {});

    await walk.run();

    expect(readsOf(walk.reads, 'fundingLedger')).toHaveLength(20);
    expect(walk.reads).toHaveLength(20);
  });

  it('reports itself complete once the forward windows reach the end of time', async () => {
    const walk = newWalk();

    expect(await walk.run()).toEqual({ imported: 0, complete: true });
  });

  // The route rounds each bound out to a whole second and refuses a span past 604,800 seconds, so
  // a clock inside a second must still send no more than that, from its first window on.
  it('every span the walk sends is 604,800 seconds or less, from a clock inside a second', async () => {
    const walk = newWalk({ now: NOW + 500 }, ACCOUNT_ID, {});
    const days = [700, 500, 300, 100, 30, 1];

    walk.world.fundingLedger = days.map((age) =>
      ledgerAt(NOW - age * DAY_MS, { currcCursor: `age-${age}` }),
    );

    let runs = 0;
    let isComplete = false;

    while (runs < 20 && !isComplete) {
      runs += 1;
      isComplete = (await walk.run()).complete;
      walk.clock.now += HOUR_MS + 1;
    }

    expect(isComplete).toBe(true);
    expect(walk.ledgerKeys()).toHaveLength(days.length);
    expect(
      Math.max(...walk.reads.map((read) => read.endTime - read.startTime)),
    ).toBeLessThanOrEqual(604_800_000);
  });

  it('a span commits the same records whatever the page order', async () => {
    const orders = ['ascending', 'descending', 'scrambled'] as const;
    const written = await Promise.all(
      orders.map(async (order) => {
        const walk = newWalk({ fake: { pageSize: 2, order } });
        walk.world.fundingLedger = [0, 1, 2, 3, 4, 5, 6].map((index) =>
          ledgerAt(AT + index * SECOND_MS, { currcCursor: `r${index}` }),
        );

        await walk.run();

        return {
          calls: (walk.deps.addTransactions as jest.Mock).mock.calls,
          pages: readsOf(walk.reads, 'fundingLedger').length,
        };
      }),
    );

    expect(written[0].calls[0][0]).toHaveLength(7);
    expect(written[0].pages).toBeGreaterThan(2);
    expect(written[1].calls).toEqual(written[0].calls);
    expect(written[2].calls).toEqual(written[0].calls);
  });

  it('follows the cursor of a page', async () => {
    const walk = newWalk({ fake: { pageSize: 2 } });
    walk.world.fundingLedger = [0, 1, 2, 3, 4].map((index) =>
      ledgerAt(AT + index * SECOND_MS, { currcCursor: `r${index}` }),
    );

    await walk.run();

    expect(readsOf(walk.reads, 'fundingLedger').map((read) => read.cursor)).toEqual([
      undefined,
      `${CURSOR_PREFIX}2`,
      `${CURSOR_PREFIX}4`,
    ]);
    expect(walk.ledgerKeys()).toHaveLength(5);
  });

  describe('the span rounded out to whole seconds', () => {
    it('a row in the whole second before the span start is in its reach, so it is no drift', async () => {
      const walk = newWalk({}, ACCOUNT_ID, { cursor: CURSOR + 500 });
      walk.world.fundingLedger = [ledgerAt(CURSOR, { currcCursor: 'edge' })];

      await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('edge')]);
      expect(warned.codes()).not.toContain('bybit-page-drift');
    });

    it('a row in the whole second of the span end rounded up is in its reach, so it is no drift', async () => {
      const walk = newWalk({ now: NOW + 500 }, ACCOUNT_ID, { cursor: NOW - SECOND_MS });
      walk.world.fundingLedger = [ledgerAt(NOW + 1_200, { currcCursor: 'edge' })];

      await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('edge')]);
      expect(warned.codes()).not.toContain('bybit-page-drift');
    });

    it('the point of a row is read as the seconds around it, and finds the row', async () => {
      const createdAt = NOW - 40 * DAY_MS;
      const walk = newWalk({}, ACCOUNT_ID, {
        cursor: NOW,
        pending: [
          {
            start: createdAt - 1,
            end: createdAt + SECOND_MS,
            kind: 'point',
            series: 'fundingLedger',
            since: NOW,
          },
        ],
      });
      walk.world.fundingLedger = [ledgerAt(createdAt, { currcCursor: 'owed' })];

      await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('owed')]);
      expect(walk.marks().pending).toEqual([]);
    });
  });

  it('the rolling floor drops owed ground it passes unread, and cuts a range that reaches back past it', async () => {
    const floor = NOW - 729 * DAY_MS;
    const owed = [
      { start: NOW - 740 * DAY_MS, end: NOW - 739 * DAY_MS, series: 'fundingLedger' },
      { start: NOW - 740 * DAY_MS, end: floor + DAY_MS, series: 'fundingLedger' },
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
      walk.world.fundingLedger = [
        served(
          NOW - 9 * DAY_MS,
          fundingLedgerRow({
            currcCursor: 'drifted',
            createTime: String(Math.floor((NOW - 30 * DAY_MS) / SECOND_MS)),
          }),
        ),
        ledgerAt(AT, { currcCursor: 'next-window' }),
      ];

      const result = await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('next-window')]);
      expect(walk.marks().cursor).toBe(NOW);
      expect(walk.marks().pending).toEqual([
        { start: NOW - 10 * DAY_MS, end: NOW - 10 * DAY_MS + WINDOW_MS, series: 'fundingLedger' },
      ]);
      expect(result.complete).toBe(false);
      expect(warned.codes()).toContain('bybit-page-drift');
    });

    it('owes the span of a page that drifted in the re-scan', async () => {
      const walk = newWalk({}, ACCOUNT_ID, { cursor: NOW });
      walk.world.fundingLedger = [
        served(
          AT,
          fundingLedgerRow({
            currcCursor: 'drifted',
            createTime: String(Math.floor((NOW - 100 * DAY_MS) / SECOND_MS)),
          }),
        ),
      ];

      await walk.run();

      expect(walk.ledgerKeys()).toEqual([]);
      expect(walk.marks().pending).toEqual([
        { start: NOW - WINDOW_MS, end: NOW, series: 'fundingLedger' },
      ]);
    });
  });

  describe('a repeated cursor', () => {
    const rowOf = (id: string) =>
      fundingLedgerRow({ currcCursor: id, createTime: String(AT / SECOND_MS) });

    it('ends the span with its rows when the page that repeats it holds no new key', async () => {
      const walk = newWalk({
        overrides: {
          fetchFundingLedgerPage: scriptedPages(AT, {
            first: { list: [rowOf('a'), rowOf('b')], nextPageCursor: 'c1' },
            c1: { list: [rowOf('a'), rowOf('b')], nextPageCursor: 'c1' },
          }),
        },
      });

      const result = await walk.run();

      expect(walk.ledgerKeys().sort()).toEqual([ledgerKeyOf('a'), ledgerKeyOf('b')]);
      expect(walk.marks().pending).toEqual([]);
      expect(walk.marks().cursor).toBe(NOW);
      expect(result.complete).toBe(true);
      expect(warned.codes()).not.toContain('bybit-page-drift');
    });

    it('is a drift when the page that repeats it holds a new key: nothing of the span commits', async () => {
      const walk = newWalk({
        overrides: {
          fetchFundingLedgerPage: scriptedPages(AT, {
            first: { list: [rowOf('a')], nextPageCursor: 'c1' },
            c1: { list: [rowOf('a'), rowOf('b')], nextPageCursor: 'c1' },
          }),
        },
      });

      await walk.run();

      expect(walk.ledgerKeys()).toEqual([]);
      expect(walk.marks().pending).toEqual([expect.objectContaining({ series: 'fundingLedger' })]);
      expect(warned.codes()).toContain('bybit-page-drift');
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

    it('writes the clock of the cursor read only when the cursor moved', async () => {
      const walk = newWalk({}, ACCOUNT_ID, { cursor: NOW, cursorReadAt: NOW - 5 });

      await walk.run();

      expect(walk.marks().cursorReadAt).toBe(NOW - 5);
    });
  });

  describe('the span that one second of rows fills', () => {
    // A lane reads 20 pages, one row each here, so 25 rows in one second are over what it holds.
    const SPAN_START = NOW - 1_500;
    const sameSecond = (count: number, at: number) =>
      Array.from({ length: count }, (_unused, index) =>
        ledgerAt(at, { currcCursor: `burst-${index}` }),
      );

    const walkOfFullLane = () => {
      const walk = newWalk({ fake: { pageSize: 1 } }, ACCOUNT_ID, { cursor: SPAN_START });
      walk.world.fundingLedger = sameSecond(25, NOW - 1_400);

      return walk;
    };

    it('a span at the floor that a full lane cannot finish writes one mark, and a later run that is stuck there writes none', async () => {
      const walk = walkOfFullLane();

      await walk.run();

      expect(denseWritesOf(walk)).toEqual([]);

      await walk.run();

      expect(denseWritesOf(walk)).toEqual([
        { kind: 'denseSpans', series: 'fundingLedger', start: SPAN_START },
      ]);
      expect(await storedDenseSpans(walk)).toEqual({ fundingLedger: SPAN_START });

      await walk.run();
      await walk.run();

      expect(denseWritesOf(walk)).toHaveLength(1);
      expect(walk.marks().cursor).toBe(SPAN_START);
    });

    // The first window ends on a whole second, and the route reads that second whole, so the burst
    // sits in the whole second after it: only the second window, a second wide, reads it.
    it('a budget stop after an earlier read writes none', async () => {
      const start = NOW - WINDOW_MS - SECOND_MS;
      const walk = newWalk({ fake: { pageSize: 1 } }, ACCOUNT_ID, { cursor: start });
      walk.world.fundingLedger = [
        ...Array.from({ length: 15 }, (_unused, index) =>
          ledgerAt(start + (index + 1) * SECOND_MS, { currcCursor: `early-${index}` }),
        ),
        ...sameSecond(10, NOW + 100),
      ];

      await walk.run();

      expect(readsOf(walk.reads, 'fundingLedger')).toHaveLength(20);
      expect(walk.marks().cursor).toBe(start + WINDOW_MS);
      expect(denseWritesOf(walk)).toEqual([]);
      expect(await storedDenseSpans(walk)).toBeUndefined();
    });

    it('a span of more than a second that a full lane cannot finish splits and writes none', async () => {
      const walk = walkOfFullLane();

      await walk.run();

      expect(denseWritesOf(walk)).toEqual([]);
      expect(await storedDenseSpans(walk)).toBeUndefined();
    });

    // Ground outside the forward pass lies behind the cursor, which held the lane there, so a split
    // to the millisecond reaches a span that fits, and it never writes the mark. A read of such a
    // span stores the narrower span as its hint, which the forward pass would stop at a second.
    it('a span of a second or less that a full lane cannot finish splits outside the forward pass, and writes no mark', async () => {
      const owed = {
        start: NOW - 20 * DAY_MS,
        end: NOW - 20 * DAY_MS + 900,
        series: 'fundingLedger',
      };
      const walk = newWalk({ fake: { pageSize: 1 } }, ACCOUNT_ID, {
        cursor: NOW,
        pending: [owed],
      });
      walk.world.fundingLedger = sameSecond(25, owed.start);

      const hintWidths: number[] = [];

      for (let run = 0; run < 12; run += 1) {
        await walk.run();

        const hints = (
          walk.marks().spanHints as { pending: { start: number; end: number }[] } | undefined
        )?.pending;

        hintWidths.push(Math.min(...(hints ?? []).map(({ start, end }) => end - start)));
      }

      expect(Math.min(...hintWidths)).toBeLessThan(SECOND_MS);
      expect(denseWritesOf(walk)).toEqual([]);
      expect(await storedDenseSpans(walk)).toBeUndefined();
      expect(walk.marks().pending).toEqual([expect.objectContaining({ start: owed.start })]);
    });

    it('the commit past the span drops its mark, and a commit that ends where the mark starts leaves it', async () => {
      const stands = newWalk({}, ACCOUNT_ID, { cursor: NOW }, markedAt(NOW));
      const passed = newWalk({}, ACCOUNT_ID, { cursor: CURSOR }, markedAt(CURSOR));

      await stands.run();
      await passed.run();

      expect(await storedDenseSpans(stands)).toEqual({ fundingLedger: NOW });
      expect(denseWritesOf(stands)).toEqual([]);
      expect(denseWritesOf(passed)).toEqual([
        { kind: 'denseSpans', series: 'fundingLedger', start: null },
      ]);
      expect(await storedDenseSpans(passed)).toBeUndefined();
    });

    it('a floor that passes the span drops its mark through the commit of the first span after it, once however many spans commit', async () => {
      const walk = newWalk({}, ACCOUNT_ID, {}, markedAt(NOW - 800 * DAY_MS));

      await walk.run();

      expect(readsOf(walk.reads, 'fundingLedger').length).toBeGreaterThan(1);
      expect(denseWritesOf(walk)).toEqual([
        { kind: 'denseSpans', series: 'fundingLedger', start: null },
      ]);
      expect(await storedDenseSpans(walk)).toBeUndefined();
    });

    it('keeps the mark of the log series apart: a ledger commit leaves it', async () => {
      const walk = newWalk(
        {},
        ACCOUNT_ID,
        { cursor: CURSOR },
        { unknown: { keys: { denseSpans: { log: CURSOR, fundingLedger: CURSOR } } } },
      );

      await walk.run();

      expect(await storedDenseSpans(walk)).toEqual({ log: CURSOR });
    });
  });

  describe('a failed read', () => {
    it('stops at a rate refusal: nothing else is asked, the account cools, and the marks stay', async () => {
      const walk = newWalk(
        { fake: { refuse: { series: 'fundingLedger', retCode: 10006 } } },
        'acc-cool',
      );

      const result = await walk.run('acc-cool');

      expect(result).toEqual({ imported: 0, complete: false });
      expect(walk.reads).toHaveLength(1);
      expect(isBybitCoolingDown('acc-cool', NOW + 1)).toBe(true);
      expect(walk.marks().cursor).toBe(CURSOR);
    });

    it('rejects on a refused key, with no read after it', async () => {
      const walk = newWalk({ fake: { refuse: { series: 'fundingLedger', retCode: 10005 } } });

      await expect(walk.run()).rejects.toBeInstanceOf(BybitRefusalError);

      expect(walk.reads).toHaveLength(1);
    });

    it('rejects on a page that holds no list, and keeps the cursor', async () => {
      const walk = newWalk({ fake: { malformed: 'fundingLedger' } });

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
