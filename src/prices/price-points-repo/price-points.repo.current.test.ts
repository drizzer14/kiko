let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { buildPriceBook, priceAt } from '../price-book';

import { pricePointsRepo } from './price-points.repo';

const TODAY = Date.UTC(2026, 8, 20);

const insertPoint = (instrument: string, day: number): void => {
  mockDatabase
    .prepare(
      `INSERT INTO price_points (instrument, day, price, currency, source)
       VALUES (?, ?, ?, 'USD', 'eodhd')`,
    )
    .run(instrument, day, String(day / DAY_MS));
};

const insertDays = (instrument: string, firstOffset: number, lastOffset: number): void => {
  for (let offset = firstOffset; offset <= lastOffset; offset += 1) {
    insertPoint(instrument, TODAY + offset * DAY_MS);
  }
};

const daysOf = async (instrument: string): Promise<number[]> =>
  (await pricePointsRepo.currentQuery(TODAY))
    .filter((row) => row.instrument === instrument)
    .map((row) => (row.day - TODAY) / DAY_MS)
    .sort((first, second) => first - second);

describe('pricePointsRepo.currentQuery', () => {
  beforeEach(() => {
    mockDatabase = new DatabaseSync(':memory:');
    applyAllMigrations(mockDatabase);
    insertDays('share:AAPL.US', -400, 0);
    insertDays('share:STALE.US', -420, -6);
    insertDays('share:LATER.US', 2, 3);
    insertDays('metal:XAU', -400, 1);
    insertDays('holding:loan-1', -100, -99);
    insertPoint('holding:loan-1', TODAY + 5 * DAY_MS);
  });

  it("keeps a share's latest point on or before the day, not its history", async () => {
    await expect(daysOf('share:AAPL.US')).resolves.toEqual([0]);
    await expect(daysOf('share:STALE.US')).resolves.toEqual([-6]);
  });

  it('keeps a point dated after the day, so a later valuation still finds it', async () => {
    await expect(daysOf('metal:XAU')).resolves.toEqual([0, 1]);
  });

  it('keeps every point of a series that starts after the day, for the earliest-point fallback', async () => {
    await expect(daysOf('share:LATER.US')).resolves.toEqual([2, 3]);
  });

  it('keeps a directly priced holding whole, since a loan reads its own corrections at past days', async () => {
    await expect(daysOf('holding:loan-1')).resolves.toEqual([-100, -99, 5]);
  });

  it('reads a few rows instead of the whole table', async () => {
    const all = await pricePointsRepo.allQuery();
    const current = await pricePointsRepo.currentQuery(TODAY);

    expect(all.length).toBeGreaterThan(1_000);
    expect(current).toHaveLength(1 + 1 + 2 + 2 + 3);
  });

  it.each([
    ['the day itself', 0],
    ['an hour into the day', 0.04],
    ['the day after', 1],
    ['a week on', 7],
    ['a month on', 30],
  ])('resolves the same price as the whole table for %s', async (_label, offset) => {
    const whole = buildPriceBook(await pricePointsRepo.allQuery());
    const current = buildPriceBook(await pricePointsRepo.currentQuery(TODAY));
    const instant = TODAY + Math.round(offset * DAY_MS);

    for (const instrument of [
      'share:AAPL.US',
      'share:STALE.US',
      'share:LATER.US',
      'metal:XAU',
      'holding:loan-1',
      'share:UNKNOWN.US',
    ]) {
      expect(priceAt(current, instrument, instant)).toEqual(priceAt(whole, instrument, instant));
    }
  });
});

describe('pricePointsRepo.metalDayRangesQuery', () => {
  beforeEach(() => {
    mockDatabase = new DatabaseSync(':memory:');
    applyAllMigrations(mockDatabase);
  });

  it('reads one row per metal series: its first and its latest day', async () => {
    insertDays('metal:XAU', -3, 2);
    insertDays('metal:XAG', 0, 1);

    const rows = await pricePointsRepo.metalDayRangesQuery();

    expect([...rows].sort((first, second) => first.firstDay - second.firstDay)).toEqual([
      { instrument: 'metal:XAU', firstDay: TODAY - 3 * DAY_MS, lastDay: TODAY + 2 * DAY_MS },
      { instrument: 'metal:XAG', firstDay: TODAY, lastDay: TODAY + DAY_MS },
    ]);
  });

  it('never reads a share or a directly priced holding', async () => {
    insertPoint('share:AAPL.US', TODAY);
    insertPoint('holding:house', TODAY);

    await expect(pricePointsRepo.metalDayRangesQuery()).resolves.toEqual([]);
  });
});
