import { Money, toMajor } from '@kiko/currency/money';
import type { Currency } from '@kiko/currency/currency';
import type { SeriesHolding } from '@kiko/statistics/holding-value-at';
import { buildNetWorthSeries } from '@kiko/statistics/net-worth-series';

import {
  type CryptoHistory,
  fetchCryptoHistory as fetchCoinGeckoHistory,
} from '../coingecko-history';
import type { HistoryRateEntry } from '../history-entry';

import {
  type BackfillDeps,
  type BackfillStatus,
  composeHistoryRows,
  deriveLastBackfilledDay,
  missingDays,
  planBackfillRun,
  runBackfill,
} from './history-backfill';

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (index: number) => Date.UTC(2026, 8, 1) + index * DAY_MS; // 2026-09-01 + n

type StoredRow = { base: string; quote: string; day: number; rate: string; source: string };

// A CoinGecko answer where every requested coin's own request succeeded.
const answered = (entries: HistoryRateEntry[]): CryptoHistory => ({
  entries,
  failedCurrencies: [],
});

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

describe('planBackfillRun', () => {
  it('runs from the incremental resume cursor on the first run', () => {
    expect(planBackfillRun(day(0), null, day(2))).toEqual({ run: true, resumeFrom: day(2) });
  });

  it('re-runs from null (the whole span) when the span extends EARLIER mid-session', () => {
    // A prior run already covered from day(5); an older transaction drops
    // spanStart to day(0). Resuming forward from the newest stored day cannot
    // see the gap below it, so the re-run must recompute the full span.
    expect(planBackfillRun(day(0), day(5), day(9))).toEqual({ run: true, resumeFrom: null });
  });

  it('does not re-run when the span is unchanged or moves later', () => {
    expect(planBackfillRun(day(5), day(5), day(9))).toEqual({ run: false, resumeFrom: null });
    expect(planBackfillRun(day(7), day(5), day(9))).toEqual({ run: false, resumeFrom: null });
  });

  it('the earlier-extension re-run actually reaches the freshly-opened earlier days', () => {
    // Proving the fix end-to-end: with resumeFrom null, missingDays spans the
    // FULL range from the new earlier spanStart — the earlier gap the forward
    // cursor skipped is now covered.
    const { resumeFrom } = planBackfillRun(day(0), day(5), day(9));

    expect(missingDays(day(0), resumeFrom, day(2))).toEqual([day(0), day(1), day(2)]);
  });
});

describe('composeHistoryRows', () => {
  const anchors: HistoryRateEntry[] = [
    { base: 'USD', quote: 'UAH', day: day(0), rate: 40, source: 'nbu' },
    { base: 'EUR', quote: 'UAH', day: day(0), rate: 43, source: 'nbu' },
    { base: 'BTC', quote: 'USD', day: day(0), rate: 65_000, source: 'coingecko' },
  ];

  it('composes one X:UAH row per priced currency per day, never a cross pair', () => {
    const rows = composeHistoryRows(anchors, [day(0)]);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.quote === 'UAH')).toBe(true);
    expect(rows.every((row) => row.base !== 'UAH')).toBe(true);
  });

  it('composes 5 rows/day for USD/EUR/BTC/ETH/USDT when every anchor is priced', () => {
    const fivePriced: HistoryRateEntry[] = [
      { base: 'USD', quote: 'UAH', day: day(0), rate: 40, source: 'nbu' },
      { base: 'EUR', quote: 'UAH', day: day(0), rate: 43, source: 'nbu' },
      { base: 'BTC', quote: 'USD', day: day(0), rate: 65_000, source: 'coingecko' },
      { base: 'ETH', quote: 'USD', day: day(0), rate: 3_200, source: 'coingecko' },
      { base: 'USDT', quote: 'USD', day: day(0), rate: 1.0002, source: 'coingecko' },
    ];
    const rows = composeHistoryRows(fivePriced, [day(0)]);
    expect(rows).toHaveLength(5);
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

  it('prices BTC through USD and stores only its BTC:UAH row, tagged coingecko', () => {
    const rows = composeHistoryRows(anchors, [day(0)]);
    expect(rows).toContainEqual({
      base: 'BTC',
      quote: 'UAH',
      day: day(0),
      rate: '2600000',
      source: 'coingecko',
    });
    expect(rows.some((row) => row.base === 'BTC' && row.quote === 'USD')).toBe(false);
  });

  it('prices ETH through USD and composes a convertible ETH:UAH history row', () => {
    const withEth: HistoryRateEntry[] = [
      { base: 'USD', quote: 'UAH', day: day(0), rate: 40, source: 'nbu' },
      { base: 'ETH', quote: 'USD', day: day(0), rate: 3_200, source: 'coingecko' },
    ];
    const rows = composeHistoryRows(withEth, [day(0)]);
    expect(rows).toContainEqual({
      base: 'ETH',
      quote: 'UAH',
      day: day(0),
      rate: '128000',
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
      fetchCryptoHistory: async (days) => {
        btcCalls.push(days);

        return answered(btc);
      },
      upsertMany: async (rows: StoredRow[]) => {
        captured.push(rows);
      },
      // The data-presence gate (kiko-architecture): every existing test below
      // exercises a run that DOES need both legs, so the default reports both
      // as needed; the "data-presence gate" describe block overrides this to
      // exercise the skip paths.
      openCurrencies: async () => ({ needsFiat: true, cryptoCurrencies: ['BTC'] }),
      // Every existing test below models a world where USD/EUR/BTC have
      // already been backfilled together up to `lastBackfilledDay` — the
      // "a newly-held currency" describe block overrides this to exercise the
      // per-currency gap the default here would otherwise mask.
      presentCurrencies: ['USD', 'EUR', 'BTC'],
      ...overrides,
    };

    return { deps, captured, nbuCalls, btcCalls };
  };

  it('fetches, composes and upserts the missing days once, reporting complete', async () => {
    const { deps, captured } = makeDeps();

    const status: BackfillStatus = await runBackfill(deps);

    expect(captured).toHaveLength(1);
    // USD, EUR, BTC — one X:UAH row per priced currency, never a cross pair.
    expect(captured[0]).toHaveLength(3);
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
      fetchCryptoHistory: async () => {
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

    // Only BTC:USD anchors survive; the pass still reports complete rather
    // than throwing. With no fiat anchor at all, BTC itself never reaches a
    // UAH price either (its own X:UAH row needs the same-run USD:UAH anchor),
    // so no row is emitted for BTC or anything else, and the resume cursor
    // stays at its prior value (null) rather than advancing.
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
      fetchCryptoHistory: async () => answered([]),
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

  it('reports failed, never complete, when both providers reject the same span', async () => {
    const nbuCalls: [number, number][] = [];
    const { deps, captured } = makeDeps({
      fetchNbuHistory: async (start, end) => {
        nbuCalls.push([start, end]);
        throw new Error('NBU request failed: 500');
      },
      fetchCryptoHistory: async () => {
        throw new Error('CoinGecko request failed: 401');
      },
    });

    const status: BackfillStatus = await runBackfill(deps);

    expect(captured).toHaveLength(0);
    expect(status).toEqual({ state: 'failed', lastDay: null });

    // Nothing was persisted, so the caller's own resume point
    // (`deriveLastBackfilledDay`) is unchanged — a resumed pass (the same
    // `deps`, mirroring the screen's own retry) re-fetches the IDENTICAL span
    // rather than a shifted one.
    await runBackfill(deps);
    expect(nbuCalls).toEqual([
      [day(0), day(0)],
      [day(0), day(0)],
    ]);
  });
});

// A regression on the global resume cursor: it is one max(day) across ALL
// stored pairs, so once it reaches `today` (from whatever was held before), a
// currency that becomes newly held afterward — a coin nobody held during that
// earlier run, or the first foreign holding for a base-currency-only user —
// has NO stored row of its own at all, yet the day-based gate alone would
// still report the whole run "nothing missing" and skip it forever.
describe('runBackfill — a newly-held currency with no stored history yet', () => {
  const nbu: HistoryRateEntry[] = [
    { base: 'USD', quote: 'UAH', day: day(0), rate: 40, source: 'nbu' },
    { base: 'EUR', quote: 'UAH', day: day(0), rate: 43, source: 'nbu' },
  ];
  const crypto: HistoryRateEntry[] = [
    { base: 'BTC', quote: 'USD', day: day(0), rate: 65_000, source: 'coingecko' },
    { base: 'ETH', quote: 'USD', day: day(0), rate: 3_500, source: 'coingecko' },
  ];

  it('still backfills a coin held now but absent from the already-fully-backfilled history', async () => {
    const nbuCalls: [number, number][] = [];
    const captured: StoredRow[][] = [];
    // The global cursor already sits at `today` (BTC's own prior run reached
    // it), but ETH itself was never held before and has no stored row.
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: day(2),
      today: day(2),
      fetchNbuHistory: async (start, end) => {
        nbuCalls.push([start, end]);

        return nbu;
      },
      fetchCryptoHistory: async () => answered(crypto),
      upsertMany: async (rows: StoredRow[]) => {
        captured.push(rows);
      },
      openCurrencies: async () => ({ needsFiat: true, cryptoCurrencies: ['BTC', 'ETH'] }),
      presentCurrencies: ['USD', 'EUR', 'BTC'],
    };

    const status = await runBackfill(deps);

    expect(nbuCalls).toEqual([[day(0), day(2)]]);
    expect(captured).toHaveLength(1);
    expect(captured[0].some((row) => row.base === 'ETH' || row.quote === 'ETH')).toBe(true);
    expect(status).toEqual({ state: 'complete', lastDay: day(2) });
  });

  it('still backfills fiat conversion needed for the first time after the cursor already reached today', async () => {
    // The symmetric fiat gap: the global cursor sits at `today` (from some
    // OTHER now-removed currency's earlier run), but no fiat anchor has ever
    // been stored, and a holding now needs fiat conversion for the first time.
    const nbuCalls: [number, number][] = [];
    const captured: StoredRow[][] = [];
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: day(2),
      today: day(2),
      fetchNbuHistory: async (start, end) => {
        nbuCalls.push([start, end]);

        return nbu;
      },
      fetchCryptoHistory: async () => answered([]),
      upsertMany: async (rows: StoredRow[]) => {
        captured.push(rows);
      },
      openCurrencies: async () => ({ needsFiat: true, cryptoCurrencies: [] }),
      presentCurrencies: [],
    };

    const status = await runBackfill(deps);

    expect(nbuCalls).toEqual([[day(0), day(2)]]);
    expect(captured).toHaveLength(1);
    expect(status).toEqual({ state: 'complete', lastDay: day(2) });
  });

  // Per app run, a newly-held currency the provider answered EMPTY for is
  // remembered, so the fully-backfilled cursor is not reset to the whole span
  // on every Statistics focus for a coin that can never gain rows.
  const unreturnedCoinDeps = (
    knownEmptyCurrencies: Set<Currency>,
    fetchCryptoHistory: BackfillDeps['fetchCryptoHistory'],
  ) => {
    const nbuCalls: [number, number][] = [];
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: day(2),
      today: day(2),
      fetchNbuHistory: async (start, end) => {
        nbuCalls.push([start, end]);

        return nbu;
      },
      fetchCryptoHistory,
      upsertMany: async () => {},
      openCurrencies: async () => ({ needsFiat: true, cryptoCurrencies: ['BTC', 'ETH'] }),
      presentCurrencies: ['USD', 'EUR', 'BTC'],
      knownEmptyCurrencies,
    };

    return { deps, nbuCalls };
  };

  it('does not re-fetch the whole span on every run for a held coin the provider never returns', async () => {
    const knownEmptyCurrencies = new Set<Currency>();
    const cryptoCalls: number[] = [];
    const { deps, nbuCalls } = unreturnedCoinDeps(knownEmptyCurrencies, async (days) => {
      cryptoCalls.push(days);

      return answered(crypto.filter((entry) => entry.base === 'BTC'));
    });

    await runBackfill(deps);
    const second = await runBackfill(deps);

    expect(nbuCalls).toEqual([[day(0), day(2)]]);
    expect(cryptoCalls).toEqual([3]);
    expect(second).toEqual({ state: 'complete', lastDay: day(2) });
  });

  it('still retries the whole span when the provider leg for the new coin rejected', async () => {
    const knownEmptyCurrencies = new Set<Currency>();
    const cryptoCalls: number[] = [];
    const { deps } = unreturnedCoinDeps(knownEmptyCurrencies, async (days) => {
      cryptoCalls.push(days);
      throw new Error('401');
    });

    await runBackfill(deps);
    await runBackfill(deps);

    expect(cryptoCalls).toEqual([3, 3]);
  });

  // CoinGecko settles per coin: BTC's 200 fulfils the whole crypto leg even
  // when ETH's own request is rate-limited. ETH never answered, so it must be
  // retried on the next run — never remembered as a coin with no history.
  it('retries a newly-held coin whose OWN request failed while another coin succeeded', async () => {
    const knownEmptyCurrencies = new Set<Currency>();
    const requestedCoins: string[] = [];
    const bitcoinOkEthereumRateLimited = (async (url: string) => {
      const coin = /coins\/([a-z]+)\/market_chart/.exec(url)?.[1] ?? '';
      requestedCoins.push(coin);
      const ok = coin === 'bitcoin';

      return { ok, status: ok ? 200 : 429, json: async () => ({ prices: [[day(0), 65_000]] }) };
    }) as unknown as typeof fetch;
    const { deps } = unreturnedCoinDeps(knownEmptyCurrencies, (days, currencies) =>
      fetchCoinGeckoHistory(days, bitcoinOkEthereumRateLimited, currencies),
    );

    await runBackfill(deps);
    await runBackfill(deps);

    expect(knownEmptyCurrencies.has('ETH')).toBe(false);
    expect(requestedCoins.filter((coin) => coin === 'ethereum')).toHaveLength(2);
  });
});

// kiko-architecture: app-open and refresh work is gated on data presence —
// no request or query for data the user does not have. `openCurrencies`
// (shared with `refreshRates`) reports whether any active holding's
// currency differs from the base (needsFiat) and which crypto currencies
// are held; each leg fetches only when its own gate says so.
describe('runBackfill — the data-presence gate', () => {
  const nbu: HistoryRateEntry[] = [
    { base: 'USD', quote: 'UAH', day: day(0), rate: 40, source: 'nbu' },
  ];
  const btc: HistoryRateEntry[] = [
    { base: 'BTC', quote: 'USD', day: day(0), rate: 65_000, source: 'coingecko' },
  ];

  const makeDeps = (overrides: Partial<BackfillDeps> = {}): BackfillDeps => ({
    earliestDay: day(0),
    lastBackfilledDay: null,
    today: day(0),
    fetchNbuHistory: async () => nbu,
    fetchCryptoHistory: async () => answered(btc),
    upsertMany: async () => {},
    ...overrides,
  });

  it('fetches and writes nothing when nothing needs converting and no crypto is held', async () => {
    let nbuCalled = false;
    let cryptoCalled = false;
    const captured: StoredRow[][] = [];
    const deps = makeDeps({
      fetchNbuHistory: async () => {
        nbuCalled = true;

        return nbu;
      },
      fetchCryptoHistory: async () => {
        cryptoCalled = true;

        return answered(btc);
      },
      upsertMany: async (rows: StoredRow[]) => {
        captured.push(rows);
      },
      openCurrencies: async () => ({ needsFiat: false, cryptoCurrencies: [] }),
    });

    const status = await runBackfill(deps);

    expect(nbuCalled).toBe(false);
    expect(cryptoCalled).toBe(false);
    expect(captured).toHaveLength(0);
    expect(status).toEqual({ state: 'complete', lastDay: null });
  });

  it('fetches only NBU when nothing crypto is held', async () => {
    let cryptoCalled = false;
    const deps = makeDeps({
      fetchCryptoHistory: async () => {
        cryptoCalled = true;

        return answered(btc);
      },
      openCurrencies: async () => ({ needsFiat: true, cryptoCurrencies: [] }),
    });

    await runBackfill(deps);

    expect(cryptoCalled).toBe(false);
  });

  it('fetches only CoinGecko when every held currency already matches the base', async () => {
    let nbuCalled = false;
    const deps = makeDeps({
      fetchNbuHistory: async () => {
        nbuCalled = true;

        return nbu;
      },
      openCurrencies: async () => ({ needsFiat: false, cryptoCurrencies: ['BTC'] }),
    });

    await runBackfill(deps);

    expect(nbuCalled).toBe(false);
  });

  it('passes only the held crypto currencies to fetchCryptoHistory, never the full supported set', async () => {
    let receivedCurrencies: string[] = [];
    const deps = makeDeps({
      fetchCryptoHistory: async (_days, currencies) => {
        receivedCurrencies = currencies ?? [];

        return answered(btc);
      },
      openCurrencies: async () => ({ needsFiat: true, cryptoCurrencies: ['BTC'] }),
    });

    await runBackfill(deps);

    expect(receivedCurrencies).toEqual(['BTC']);
  });
});

// A history day with a missing leg: NBU has no Saturday/Sunday quote (a real
// weekend gap), while CoinGecko prices BTC every calendar day. Each currency's
// own X:UAH row now carries forward independently (its OWN nearest-at-or-
// before anchor), rather than a stored cross pair carrying forward as one
// joint unit — `buildNetWorthSeries` must still value a BTC holding correctly
// on the gap day, and no bucket may drop a holding it could convert on an
// earlier day.
describe('composeHistoryRows -> buildNetWorthSeries — a history day with a missing leg', () => {
  const usdAtDay = (index: number): number => 40 + index * 0.5;
  const btcUsdAtDay = (index: number): number => 60_000 + index * 100;
  const GAP_SPAN_DAYS = 7; // day indices 0..6

  it('values a BTC holding on the gap day from its OWN carried anchor, not a stale joint pair', () => {
    const nbuAnchors: HistoryRateEntry[] = [];

    for (let index = 0; index < GAP_SPAN_DAYS - 1; index += 1) {
      // NBU has no quote for day 6 (the weekend gap) — every earlier day does.
      nbuAnchors.push({
        base: 'USD',
        quote: 'UAH',
        day: day(index),
        rate: usdAtDay(index),
        source: 'nbu',
      });
    }
    const cryptoAnchors: HistoryRateEntry[] = Array.from({ length: GAP_SPAN_DAYS }, (_, index) => ({
      base: 'BTC' as const,
      quote: 'USD' as const,
      day: day(index),
      rate: btcUsdAtDay(index),
      source: 'coingecko' as const,
    }));

    const days = Array.from({ length: GAP_SPAN_DAYS }, (_, index) => day(index));
    const historyRows = composeHistoryRows([...nbuAnchors, ...cryptoAnchors], days);

    const btcWallet: SeriesHolding = {
      id: 'btc-wallet',
      currency: 'BTC',
      type: 'crypto_asset',
      balanceMinorUnits: 100_000_000, // 1 BTC
      metadata: null,
    };

    const series = buildNetWorthSeries({
      holdings: [btcWallet],
      transactionsByHolding: new Map(),
      historyRows,
      baseCurrency: 'UAH',
      range: { from: day(0), to: day(GAP_SPAN_DAYS - 1) },
    });

    // Day 6's USD:UAH leg carries forward from day 5 (NBU's last quote before
    // the gap); BTC:UAH day 6 is CoinGecko's own day-6 price times that SAME
    // carried USD:UAH — computed here from the raw fixture facts, never read
    // back from a row the production code wrote.
    const gapDayUahPerBtc = btcUsdAtDay(GAP_SPAN_DAYS - 1) * usdAtDay(GAP_SPAN_DAYS - 2);
    const expectedGapDayAmount = toMajor(
      Money.fromMajor('UAH', 1 * gapDayUahPerBtc).minorUnits,
      'UAH',
    );

    expect(series.points).toHaveLength(GAP_SPAN_DAYS);
    const gapDayPoint = series.points.at(-1);
    expect(gapDayPoint?.t).toBe(day(GAP_SPAN_DAYS - 1));
    expect(gapDayPoint?.amount).toBe(expectedGapDayAmount);
    // No bucket drops the BTC holding — every day's amount converts, none is
    // the empty-sum fallback of 0.
    expect(series.points.every((point) => point.amount > 0)).toBe(true);
  });
});
