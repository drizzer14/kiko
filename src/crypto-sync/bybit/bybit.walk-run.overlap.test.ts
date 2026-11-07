import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { ACCOUNT_ID } from './bybit.capital-test-fixtures';
import { logWalkOf, silencedWarnings, spotAt } from './bybit.log-test-fixtures';

const WINDOW_MS = 7 * DAY_MS;
const CATCH_UP_CURSOR = NOW - 100 * DAY_MS;

const walkOf = (marks: Record<string, unknown>, beforeWrite?: (writes: number) => void) =>
  logWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { log: marks } }),
    beforeWrite,
  });

/** The reads that start behind the cursor: the overlap day, or the re-scan that follows it. */
const readsBehind = (walk: ReturnType<typeof walkOf>, cursor: number) =>
  walk.reads.filter((read) => read.startTime < cursor);

// The overlap day behind a forward start guards a record that settles late at the cursor's edge,
// and a late record is one that the re-scan window reads: ground read long after its time holds
// none, so a catch-up run over it owes no day.
describe('the overlap day behind the forward start of a Bybit walk', () => {
  silencedWarnings();

  it('a catch-up run whose cursor was read long after its time owes no overlap day', async () => {
    const walk = walkOf({ cursor: CATCH_UP_CURSOR, cursorReadAt: NOW });

    await walk.run();

    expect(walk.reads.length).toBeGreaterThan(0);
    expect(readsBehind(walk, CATCH_UP_CURSOR)).toEqual([]);
  });

  it('a cursor read near its time owes the overlap day, after a long absence too', async () => {
    const walk = walkOf({ cursor: NOW - 3 * DAY_MS });

    await walk.run();

    expect(walk.marks().cursorReadAt).toBe(NOW);

    walk.world.log = [spotAt(NOW - 3_600_000, { id: 'late' })];
    walk.clock.now = NOW + 30 * DAY_MS;

    await walk.run();

    expect(walk.keys()).toEqual([`${ACCOUNT_ID}:log:late:TRADE:${NOW - 3_600_000}:BTC`]);
    expect(walk.marks().cursorReadAt).toBe(NOW + 30 * DAY_MS);
  });

  it('a run cut between the cursor and its clock leaves the older clock, which still owes the day', async () => {
    const marks = { cursor: NOW - 3 * DAY_MS, cursorReadAt: NOW - 3 * DAY_MS };
    let total = 0;

    await walkOf(marks, () => {
      total += 1;
    }).run();

    let seen = 0;
    const cut = walkOf(marks, () => {
      seen += 1;

      if (seen === total) {
        throw new Error('cut before the clock');
      }
    });

    await expect(cut.run()).rejects.toThrow('cut before the clock');

    expect(cut.marks()).toMatchObject({ cursor: NOW, cursorReadAt: NOW - 3 * DAY_MS });

    cut.world.log = [spotAt(NOW - 3_600_000, { id: 'late' })];
    cut.clock.now = NOW + 30 * DAY_MS;

    await cut.run();

    expect(cut.keys()).toHaveLength(1);
  });

  it('with no cursorReadAt, the overlap day is owed', async () => {
    const walk = walkOf({ cursor: CATCH_UP_CURSOR });

    await walk.run();

    expect(readsBehind(walk, CATCH_UP_CURSOR).map((read) => read.startTime)).toContain(
      CATCH_UP_CURSOR - DAY_MS,
    );
  });

  it.each([
    { label: 'one millisecond under the window', lag: WINDOW_MS - 1, isOwed: true },
    { label: 'exactly the window', lag: WINDOW_MS, isOwed: false },
  ])(
    'a cursor read $label after its time: overlap day owed is $isOwed',
    async ({ lag, isOwed }) => {
      const walk = walkOf({ cursor: CATCH_UP_CURSOR, cursorReadAt: CATCH_UP_CURSOR + lag });

      await walk.run();

      expect(readsBehind(walk, CATCH_UP_CURSOR).length > 0).toBe(isOwed);
    },
  );
});
