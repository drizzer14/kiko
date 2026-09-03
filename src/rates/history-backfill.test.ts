jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import type { HistoryRateEntry } from './history-entry';
import {
  type BackfillDeps,
  type BackfillStatus,
  composeHistoryRows,
  deriveLastBackfilledDay,
  missingDays,
  runBackfill,
} from './history-backfill';

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (index: number) => Date.UTC(2026, 8, 1) + index * DAY_MS; // 2026-09-01 + n

type StoredRow = { base: string; quote: string; day: number; rate: string; source: string };

describe('missingDays', () => {
  it('spans earliest..today inclusive when nothing was backfilled yet', () => {
    expect(missingDays(day(0), null, day(2))).toEqual([day(0), day(1), day(2)]);
  });

  it('resumes from the day after the last backfilled day', () => {
    expect(missingDays(day(0), day(1), day(3))).toEqual([day(2), day(3)]);
  });

  it('is empty when the last backfilled day is already today', () => {
    expect(missingDays(day(0), day(2), day(2))).toEqual([]);
  });

  it('is empty when the last backfilled day is ahead of today', () => {
    expect(missingDays(day(0), day(5), day(2))).toEqual([]);
  });

  it('normalizes intraday inputs to their UTC day', () => {
    expect(missingDays(day(0) + 5_000, null, day(1) + 9_999)).toEqual([day(0), day(1)]);
  });
});

describe('deriveLastBackfilledDay', () => {
  it('returns the maximum stored day', () => {
    const rows = [{ day: day(0) }, { day: day(2) }, { day: day(1) }];
    expect(deriveLastBackfilledDay(rows)).toBe(day(2));
  });

  it('returns null when there is no history yet', () => {
    expect(deriveLastBackfilledDay([])).toBeNull();
  });
});

describe('composeHistoryRows', () => {
  const anchors: HistoryRateEntry[] = [
    { base: 'USD', quote: 'UAH', day: day(0), rate: 40, source: 'nbu' },
    { base: 'EUR', quote: 'UAH', day: day(0), rate: 43, source: 'nbu' },
    { base: 'BTC', quote: 'USD', day: day(0), rate: 65_000, source: 'coingecko' },
  ];

  it('composes all 12 ordered cross pairs per day', () => {
    const rows = composeHistoryRows(anchors, [day(0)]);
    expect(rows).toHaveLength(12);
  });

  it('anchors fiat pairs to UAH with an nbu source', () => {
    const rows = composeHistoryRows(anchors, [day(0)]);
    expect(rows).toContainEqual({
      base: 'USD',
      quote: 'UAH',
      day: day(0),
      rate: '40',
      source: 'nbu',
    });
    expect(rows).toContainEqual({
      base: 'EUR',
      quote: 'UAH',
      day: day(0),
      rate: '43',
      source: 'nbu',
    });
  });

  it('prices BTC through USD and tags any BTC pair as coingecko', () => {
    const rows = composeHistoryRows(anchors, [day(0)]);
    expect(rows).toContainEqual({
      base: 'BTC',
      quote: 'USD',
      day: day(0),
      rate: '65000',
      source: 'coingecko',
    });
    expect(rows).toContainEqual({
      base: 'BTC',
      quote: 'UAH',
      day: day(0),
      rate: '2600000',
      source: 'coingecko',
    });
  });

  it('stores every rate as a string, never a float', () => {
    for (const row of composeHistoryRows(anchors, [day(0)])) {
      expect(typeof row.rate).toBe('string');
    }
  });

  it('carries a prior days rate forward across a gap day', () => {
    const rows = composeHistoryRows(anchors, [day(0), day(1)]);
    const gapUsd = rows.find((r) => r.base === 'USD' && r.quote === 'UAH' && r.day === day(1));
    expect(gapUsd?.rate).toBe('40');
  });

  it('omits a day with no anchor at or before it', () => {
    const later: HistoryRateEntry[] = [
      { base: 'USD', quote: 'UAH', day: day(2), rate: 40, source: 'nbu' },
    ];
    // day(0) precedes the only anchor -> no priced pairs for it.
    expect(composeHistoryRows(later, [day(0)])).toHaveLength(0);
  });
});

describe('runBackfill', () => {
  const nbu: HistoryRateEntry[] = [
    { base: 'USD', quote: 'UAH', day: day(0), rate: 40, source: 'nbu' },
    { base: 'EUR', quote: 'UAH', day: day(0), rate: 43, source: 'nbu' },
  ];
  const btc: HistoryRateEntry[] = [
    { base: 'BTC', quote: 'USD', day: day(0), rate: 65_000, source: 'coingecko' },
  ];

  const makeDeps = (overrides: Partial<BackfillDeps> = {}) => {
    const captured: StoredRow[][] = [];
    const nbuCalls: [number, number][] = [];
    const btcCalls: number[] = [];
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: null,
      today: day(0),
      fetchNbuHistory: async (start, end) => {
        nbuCalls.push([start, end]);
        return nbu;
      },
      fetchBTCHistory: async (days) => {
        btcCalls.push(days);
        return btc;
      },
      upsertMany: async (rows: StoredRow[]) => {
        captured.push(rows);
      },
      ...overrides,
    };
    return { deps, captured, nbuCalls, btcCalls };
  };

  it('fetches, composes and upserts the missing days once, reporting complete', async () => {
    const { deps, captured } = makeDeps();

    const status: BackfillStatus = await runBackfill(deps);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toHaveLength(12);
    expect(status).toEqual({ state: 'complete', lastDay: day(0) });
  });

  it('passes the missing span to NBU and the day count to CoinGecko', async () => {
    const { deps, nbuCalls, btcCalls } = makeDeps({
      lastBackfilledDay: day(0),
      today: day(2),
    });

    await runBackfill(deps);

    expect(nbuCalls).toEqual([[day(1), day(2)]]);
    // day(1)..day(2) inclusive -> 2 days back plus a boundary margin.
    expect(btcCalls[0]).toBeGreaterThanOrEqual(2);
  });

  it('still stores NBU fiat when the CoinGecko BTC fetch fails', async () => {
    // CoinGecko's free tier can 401 a multi-year request; because the fetches are
    // settled independently, a BTC failure must not discard the fiat rates NBU
    // already returned. The composed rows carry the fiat cross pairs; BTC pairs
    // are simply absent for that pass.
    const { deps, captured } = makeDeps({
      fetchBTCHistory: async () => {
        throw new Error('CoinGecko request failed: 401');
      },
    });

    const status: BackfillStatus = await runBackfill(deps);

    expect(captured).toHaveLength(1);
    const stored = captured[0];
    expect(stored.length).toBeGreaterThan(0);
    // USD/EUR/UAH fiat pairs are present; no pair references BTC.
    expect(stored.some((row) => row.base === 'USD' && row.quote === 'UAH')).toBe(true);
    expect(stored.every((row) => row.base !== 'BTC' && row.quote !== 'BTC')).toBe(true);
    expect(status).toEqual({ state: 'complete', lastDay: day(0) });
  });

  it('still composes when only the BTC fetch succeeds and NBU fails', async () => {
    const { deps, captured } = makeDeps({
      fetchNbuHistory: async () => {
        throw new Error('NBU request failed: 500');
      },
    });

    const status: BackfillStatus = await runBackfill(deps);

    // Only BTC:USD anchors survive, so no fully-priced fiat cross pair composes;
    // the pass still reports complete rather than throwing.
    // With just BTC:USD priced, no cross pair among {BTC,USD,EUR,UAH} is emitted
    // (USD alone is not enough to price a UAH-anchored pair), so nothing is stored,
    // and the resume cursor stays at its prior value (null) rather than advancing.
    expect(status).toEqual({ state: 'complete', lastDay: null });
    expect(captured).toHaveLength(0);
  });

  it('does not advance the resume cursor when nothing is persisted', async () => {
    // Both providers return no usable anchors for the missing span, so no row is
    // stored. Reporting lastDay=today would falsely mark the span done and skip
    // re-fetching it forever; the cursor must stay where it was.
    const { deps, captured } = makeDeps({
      lastBackfilledDay: day(0),
      today: day(2),
      fetchNbuHistory: async () => [],
      fetchBTCHistory: async () => [],
    });

    const status: BackfillStatus = await runBackfill(deps);

    expect(captured).toHaveLength(0);
    expect(status).toEqual({ state: 'complete', lastDay: day(0) });
  });

  it('does no work and reports complete when there are no missing days', async () => {
    const { deps, captured, nbuCalls, btcCalls } = makeDeps({
      lastBackfilledDay: day(0),
      today: day(0),
    });

    const status: BackfillStatus = await runBackfill(deps);

    expect(captured).toHaveLength(0);
    expect(nbuCalls).toHaveLength(0);
    expect(btcCalls).toHaveLength(0);
    expect(status).toEqual({ state: 'complete', lastDay: day(0) });
  });
});
