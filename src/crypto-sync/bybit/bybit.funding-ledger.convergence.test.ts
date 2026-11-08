import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { ACCOUNT_ID } from './bybit.capital-test-fixtures';
import { fundingLedgerWalkOf, ledgerAt } from './bybit.funding-ledger-test-fixtures';

// The walk is the real one, through the real `planWalkPasses` and `runWalkPlan`, over a fake route
// that serves 5 rows a page, so a lane of 20 pages holds 100 rows. Every row is built from the
// field words of the page's one sample: no page with a real row was read live.
const SECOND_MS = 1_000;
const HOUR_MS = 3_600_000;
const GAPS = [0, HOUR_MS, DAY_MS];
const PAGE_SIZE = 5;
const LANE_ROWS = 20 * PAGE_SIZE;
const MAX_RUNS = 200;

const newWalk = (cursor: number) =>
  fundingLedgerWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { fundingLedger: { cursor } } }),
    fake: { pageSize: PAGE_SIZE },
  });

type Walk = ReturnType<typeof newWalk>;

/** `count` rows at one instant, each on its own key, so a burst is the lane's rows in a second. */
const burstAt = (count: number, at: number, name = 'burst') =>
  Array.from({ length: count }, (_unused, index) =>
    ledgerAt(at, { currcCursor: `${name}-${index}` }),
  );

/** Runs one after another, the clock moving by `gap` between them, until one is complete. */
const settle = async (walk: Walk, gap: number) => {
  let runs = 0;
  let isFinished = false;

  while (runs < MAX_RUNS && !isFinished) {
    runs += 1;
    isFinished = (await walk.run()).complete;

    if (!isFinished) {
      walk.clock.now += gap;
    }
  }

  return { runs, isFinished };
};

const denseMarkOf = async (walk: Walk) =>
  (JSON.parse((await walk.readState()) ?? '{}') as { denseSpans?: { fundingLedger?: number } })
    .denseSpans?.fundingLedger;

const denseWritesOf = (walk: Walk): number =>
  (walk.deps.patchExchangeState as jest.Mock).mock.calls
    .flatMap(([, patches]) => patches as { kind: string }[])
    .filter(({ kind }) => kind === 'denseSpans').length;

describe.each(GAPS)('the Funding ledger walk over bursts, at a clock gap of %i ms', (gap) => {
  // The edge between two forward spans lies in the second of the burst, and the route reads whole
  // seconds, so both spans read the burst: a row read twice is harmless by its key, and the burst
  // that a lane holds is stored whole. The reads outside the forward pass lie behind the cursor,
  // which read this ground whole, so a split to a millisecond ends them (CALL 123's law).
  it('a burst that a forward span edge splits ends its owed ground with every row stored, and no mark', async () => {
    const edge = NOW - 3 * DAY_MS;
    const walk = newWalk(NOW - 10 * DAY_MS);

    walk.world.fundingLedger = burstAt(90, edge + 300);

    const outcome = await settle(walk, gap);

    expect(outcome.isFinished).toBe(true);
    expect(walk.ledgerKeys()).toHaveLength(90);
    expect(walk.marks().pending).toEqual([]);
    expect(await denseMarkOf(walk)).toBeUndefined();
  }, 120_000);

  it('the same burst 3 days old and fresh, in the middle of a window, ends its owed ground too', async () => {
    const walk = newWalk(NOW - 10 * DAY_MS);

    walk.world.fundingLedger = [
      ...burstAt(60, NOW - 3 * DAY_MS - 400, 'old'),
      ...burstAt(60, NOW - 2 * SECOND_MS - 400, 'fresh'),
    ];

    const outcome = await settle(walk, gap);

    expect(outcome.isFinished).toBe(true);
    expect(walk.ledgerKeys()).toHaveLength(120);
    expect(await denseMarkOf(walk)).toBeUndefined();
  }, 120_000);

  it('a burst over the lane in one second stops with its mark, written once, and spends its lane on every run', async () => {
    const walk = newWalk(NOW - 10 * DAY_MS);

    walk.world.fundingLedger = burstAt(LANE_ROWS + 20, NOW - 5 * DAY_MS + 300);

    const outcome = await settle(walk, gap);
    const mark = await denseMarkOf(walk);

    expect(outcome.isFinished).toBe(false);
    expect(mark).toBeGreaterThanOrEqual(NOW - 10 * DAY_MS);
    expect(mark).toBeLessThanOrEqual(NOW - 5 * DAY_MS + 300);
    expect(denseWritesOf(walk)).toBe(1);
    expect(walk.ledgerKeys().length).toBeLessThan(LANE_ROWS + 20);
  }, 120_000);

  it('a burst in two seconds that no span can split apart holds the lane the same way, with its mark', async () => {
    const walk = newWalk(NOW - 10 * DAY_MS);
    const second = NOW - 5 * DAY_MS;

    walk.world.fundingLedger = [
      ...burstAt(70, second + 100, 'first'),
      ...burstAt(70, second + SECOND_MS + 100, 'second'),
    ];

    const outcome = await settle(walk, gap);

    expect(outcome.isFinished).toBe(false);
    expect(await denseMarkOf(walk)).toBeDefined();
    expect(denseWritesOf(walk)).toBe(1);
  }, 120_000);

  it('an even history of 40 rows is read whole and ends', async () => {
    const walk = newWalk(NOW - 30 * DAY_MS);

    walk.world.fundingLedger = Array.from({ length: 40 }, (_unused, index) =>
      ledgerAt(NOW - 29 * DAY_MS + index * 17 * HOUR_MS, { currcCursor: `even-${index}` }),
    );

    const outcome = await settle(walk, gap);

    expect(outcome.isFinished).toBe(true);
    expect(walk.ledgerKeys()).toHaveLength(40);
    expect(await denseMarkOf(walk)).toBeUndefined();
  }, 120_000);
});
