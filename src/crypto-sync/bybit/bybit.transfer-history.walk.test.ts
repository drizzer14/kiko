import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { BybitRefusalError } from './bybit.client';
import { isBybitCoolingDown } from './bybit.cooldown';
import { BybitHistoryParseError } from './bybit.history-client';
import { transferAt, transferWalkOf } from './bybit.transfer-test-fixtures';
import { ACCOUNT_ID, CURSOR_PREFIX, readsOf, served } from './bybit.capital-test-fixtures';

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;
const SECOND_MS = 1_000;
const WINDOW_MS = 7 * DAY_MS;

const newWalk = (
  options: Partial<Parameters<typeof transferWalkOf>[0]> = {},
  accountId = ACCOUNT_ID,
  marks: Record<string, unknown> = { cursor: CURSOR },
) =>
  transferWalkOf({
    state: walkStateFake({ accountId, marks: { transfer: marks } }),
    ...options,
  });

const loggedCodes = (warn: jest.SpyInstance): unknown[] =>
  warn.mock.calls.map(([, details]) => (details as { code?: string }).code);

// Every row of this suite is built from the docs page's sample: no page with a row was read live.
describe('the transfer walk: windows, pages and marks', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

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

  it('reads at most 20 windows in a run, one call for each, and none after the lane is spent', async () => {
    const walk = newWalk({}, ACCOUNT_ID, {});

    await walk.run();

    expect(readsOf(walk.reads, 'transfer')).toHaveLength(20);
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
        walk.world.transfer = [
          ...[0, 1, 2, 3, 4, 5, 6].map((index) =>
            transferAt(AT + index * SECOND_MS, { transferId: `t${index}` }),
          ),
          transferAt(AT + 3 * SECOND_MS, { transferId: 'tie-b' }),
          transferAt(AT + 3 * SECOND_MS, { transferId: 'tie-a' }),
        ];

        await walk.run();

        return {
          calls: (walk.deps.addTransactions as jest.Mock).mock.calls,
          pages: readsOf(walk.reads, 'transfer').length,
        };
      }),
    );

    expect(written[0].calls[0][0]).toHaveLength(18);
    expect(written[0].pages).toBeGreaterThan(2);
    expect(written[1].calls).toEqual(written[0].calls);
    expect(written[2].calls).toEqual(written[0].calls);
  });

  it('follows the cursor of a page and stores none of them', async () => {
    const walk = newWalk({ fake: { pageSize: 2 } });
    walk.world.transfer = [0, 1, 2, 3, 4].map((index) =>
      transferAt(AT + index * SECOND_MS, { transferId: `t${index}` }),
    );

    await walk.run();

    expect(readsOf(walk.reads, 'transfer').map((read) => read.cursor)).toEqual([
      undefined,
      `${CURSOR_PREFIX}2`,
      `${CURSOR_PREFIX}4`,
    ]);
    expect(walk.keys()).toHaveLength(10);
    expect(JSON.stringify((walk.deps.patchExchangeState as jest.Mock).mock.calls)).not.toContain(
      CURSOR_PREFIX,
    );
  });

  it('13 digits read as ms, 10 as the whole second, and any other time owes its span in the transfer series while the neighbours import', async () => {
    const walk = newWalk();
    walk.world.transfer = [
      transferAt(AT, { transferId: 'ms' }),
      transferAt(AT + SECOND_MS, {
        transferId: 'seconds',
        timestamp: String((AT + SECOND_MS) / SECOND_MS),
      }),
      transferAt(AT + 2 * SECOND_MS, { transferId: 'twelve', timestamp: '174272816300' }),
      transferAt(AT + 3 * SECOND_MS, { transferId: 'fourteen', timestamp: '17427281630000' }),
    ];

    await walk.run();

    expect(
      walk
        .rows()
        .filter((row) => row.amountMinorUnits > 0)
        .map(({ externalId, time }) => [externalId, time]),
    ).toEqual([
      ['acc-1:xfer:ms:BTC:BTC:unified', AT],
      ['acc-1:xfer:seconds:BTC:BTC:unified', AT + SECOND_MS],
    ]);
    expect(walk.marks().pending).toEqual([{ start: CURSOR, end: NOW, series: 'transfer' }]);
    expect(walk.marks().cursor).toBe(NOW);
    expect(loggedCodes(warn)).not.toContain('bybit-page-drift');
  });

  it('a settled transfer with no time makes no row, owes its span in the transfer series, moves the cursor on, and imports once a later read shows its time', async () => {
    const walk = newWalk();
    const noTimeForms = ['', '0', undefined];
    walk.world.transfer = noTimeForms.map((timestamp, form) =>
      transferAt(AT + form * SECOND_MS, { transferId: `no-time-${form}`, timestamp }),
    );

    await walk.run();

    expect(walk.keys()).toEqual([]);
    expect(walk.marks().cursor).toBe(NOW);
    expect(walk.marks().pending).toEqual([{ start: CURSOR, end: NOW, series: 'transfer' }]);
    expect(loggedCodes(warn)).not.toContain('bybit-page-drift');

    walk.world.transfer = noTimeForms.map((_, form) =>
      transferAt(AT + form * SECOND_MS, { transferId: `no-time-${form}` }),
    );
    walk.clock.now = NOW + DAY_MS;
    await walk.run();

    expect(walk.keys()).toHaveLength(6);
    expect(walk.marks().pending).toEqual([]);
  });

  it('a pending transfer with no time owes its span in the transfer series, and no page drift', async () => {
    const walk = newWalk();
    walk.world.transfer = [transferAt(AT, { status: 'PENDING', timestamp: '' })];

    await walk.run();

    expect(walk.keys()).toEqual([]);
    expect(walk.marks().pending).toEqual([{ start: CURSOR, end: NOW, series: 'transfer' }]);
    expect(loggedCodes(warn)).toEqual(['transfer-not-settled']);
  });

  it('the rolling floor drops owed ground it passes unread, points too, and cuts a range that reaches back past it', async () => {
    const floor = NOW - 729 * DAY_MS;
    const owed = [
      { start: NOW - 740 * DAY_MS, end: NOW - 739 * DAY_MS, series: 'transfer' },
      {
        start: NOW - 735 * DAY_MS - 1,
        end: NOW - 735 * DAY_MS + 1,
        kind: 'point',
        series: 'transfer',
        since: NOW - 740 * DAY_MS,
      },
      { start: NOW - 740 * DAY_MS, end: floor + DAY_MS, series: 'transfer' },
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
      walk.world.transfer = [
        served(
          NOW - 9 * DAY_MS,
          transferAt(NOW - 9 * DAY_MS, {
            transferId: 'drifted',
            timestamp: String(NOW - 30 * DAY_MS),
          }).row,
        ),
        transferAt(AT, { transferId: 'next-window' }),
      ];

      const result = await walk.run();

      expect(walk.keys()).toEqual([
        'acc-1:xfer:next-window:BTC:BTC:fund',
        'acc-1:xfer:next-window:BTC:BTC:unified',
      ]);
      expect(walk.marks().cursor).toBe(NOW);
      expect(walk.marks().pending).toEqual([
        { start: NOW - 10 * DAY_MS, end: NOW - 3 * DAY_MS, series: 'transfer' },
      ]);
      expect(result.complete).toBe(false);
      expect(loggedCodes(warn)).toContain('bybit-page-drift');
    });

    it('owes the span of a page that drifted in the re-scan', async () => {
      const walk = newWalk({}, ACCOUNT_ID, { cursor: NOW });
      walk.world.transfer = [
        transferAt(AT, { transferId: 'drifted', timestamp: String(NOW - 100 * DAY_MS) }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([
        { start: NOW - WINDOW_MS, end: NOW, series: 'transfer' },
      ]);
    });

    it('holds the cursor when a holding cannot be found for a leg', async () => {
      const walk = newWalk({ overrides: { ensureHoldings: jest.fn(async () => undefined) } });
      walk.world.transfer = [transferAt(AT)];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().cursor).toBe(CURSOR);
      expect(loggedCodes(warn)).toContain('transfer-holding-missing');
    });
  });

  describe('the marks', () => {
    it('writes the restart mark when a re-scan that was begun ends, and no mark of the other coins', async () => {
      const walk = newWalk({}, ACCOUNT_ID, { cursor: CURSOR, rescan: NOW - 20 * DAY_MS });

      await walk.run();

      expect(walk.marks()).toEqual({
        cursor: NOW,
        rescan: Date.UTC(2017, 0, 1),
        pending: [],
      });
    });

    it('writes the cursor of the span it read and nothing else when the pass is whole', async () => {
      const walk = newWalk();

      await walk.run();

      expect(walk.marks()).toEqual({ cursor: NOW, pending: [] });
    });
  });

  describe('a failed read', () => {
    it('stops at a rate refusal: nothing else is asked, the account cools, and the marks stay', async () => {
      const walk = newWalk(
        { fake: { refuse: { series: 'transfer', retCode: 10006 } } },
        'acc-cool',
      );

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
      const walk = newWalk({ fake: { refuse: { series: 'transfer', retCode: 10005 } } });

      await expect(walk.run()).rejects.toBeInstanceOf(BybitRefusalError);

      expect(walk.reads).toHaveLength(1);
    });

    it('rejects on a page that holds no list, and keeps the cursor', async () => {
      const walk = newWalk({ fake: { malformed: 'transfer' } });

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
