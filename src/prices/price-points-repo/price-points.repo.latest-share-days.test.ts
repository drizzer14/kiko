let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { pricePointsRepo } from './price-points.repo';

const DAY_MS = 86_400_000;
const MONDAY = Date.UTC(2026, 8, 28);

const insertPoint = (instrument: string, day: number): void => {
  mockDatabase
    .prepare(
      `INSERT INTO price_points (instrument, day, price, currency, source)
       VALUES (?, ?, '1', 'USD', 'eodhd')`,
    )
    .run(instrument, day);
};

describe('pricePointsRepo.latestShareDaysQuery', () => {
  beforeEach(() => {
    mockDatabase = new DatabaseSync(':memory:');
    applyAllMigrations(mockDatabase);
  });

  it('reads one row per share series: its latest day', async () => {
    insertPoint('share:AAPL.US', MONDAY);
    insertPoint('share:AAPL.US', MONDAY + 2 * DAY_MS);
    insertPoint('share:AAPL.US', MONDAY + DAY_MS);
    insertPoint('share:VOD.LSE', MONDAY);

    const rows = await pricePointsRepo.latestShareDaysQuery();

    expect([...rows].sort((first, second) => first.day - second.day)).toEqual([
      { instrument: 'share:VOD.LSE', day: MONDAY },
      { instrument: 'share:AAPL.US', day: MONDAY + 2 * DAY_MS },
    ]);
  });

  it('never reads a metal or a directly priced holding', async () => {
    insertPoint('metal:gold', MONDAY);
    insertPoint('holding:house', MONDAY);

    await expect(pricePointsRepo.latestShareDaysQuery()).resolves.toEqual([]);
  });
});
