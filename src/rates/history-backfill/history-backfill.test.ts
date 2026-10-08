import { DAY_MS } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';
import { Money, toMajor } from '@kiko/currency/money';
import type { SeriesHolding } from '@kiko/statistics/holding-value-at';
import { buildNetWorthSeries } from '@kiko/statistics/net-worth-series';
import { fiatCurrencyOptions, type Currency } from '@kiko/currency/currency';

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
  deriveLastBackfilledDayByCurrency,
  missingDays,
  planBackfillRun,
  runBackfill,
} from './history-backfill';

const day = (index: number) => Date.UTC(2026, 8, 1) + index * DAY_MS; // 2026-09-01 + n

type StoredRow = { base: string; quote: string; day: number; rate: string; source: string };
type NbuCall = { currencies: Currency[]; start: number; end: number };

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
    expect(planBackfillRun(day(0), null, day(2), false)).toEqual({
      run: true,
      resumeFrom: day(2),
    });
  });

  it('re-runs from null (the whole span) when the span extends EARLIER mid-session', () => {
    // A prior run already covered from day(5); an older transaction drops
    // spanStart to day(0). Resuming forward from the newest stored day cannot
    // see the gap below it, so the re-run must recompute the full span.
    expect(planBackfillRun(day(0), day(5), day(9), false)).toEqual({
      run: true,
      resumeFrom: null,
    });
  });

  it('does not re-run when the span is unchanged or moves later and the currency set is unchanged', () => {
    expect(planBackfillRun(day(5), day(5), day(9), false)).toEqual({
      run: false,
      resumeFrom: null,
    });
    expect(planBackfillRun(day(7), day(5), day(9), false)).toEqual({
      run: false,
      resumeFrom: null,
    });
  });

  it('the earlier-extension re-run actually reaches the freshly-opened earlier days', () => {
    // Proving the fix end-to-end: with resumeFrom null, missingDays spans the
    // FULL range from the new earlier spanStart — the earlier gap the forward
    // cursor skipped is now covered.
    const { resumeFrom } = planBackfillRun(day(0), day(5), day(9), false);

    expect(missingDays(day(0), resumeFrom, day(2))).toEqual([day(0), day(1), day(2)]);
  });

  // A new currency appears mid-session (the user adds a GBP holding while
  // Statistics is mounted) — the backfill must re-run for the changed
  // currency set, without a restart, even though the span itself did not
  // move earlier.
  it('re-runs, resuming from the incremental cursor, when the held currency set changes', () => {
    expect(planBackfillRun(day(5), day(5), day(9), true)).toEqual({
      run: true,
      resumeFrom: day(9),
    });
  });

  it('an earlier-extension still recomputes the whole span even when the currency set also changed', () => {
    expect(planBackfillRun(day(0), day(5), day(9), true)).toEqual({
      run: true,
      resumeFrom: null,
    });
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

  it('composes a GBP:UAH row, proving the compose list is not hard-coded to USD/EUR', () => {
    const gbpOnly: HistoryRateEntry[] = [
      { base: 'GBP', quote: 'UAH', day: day(0), rate: 55, source: 'nbu' },
    ];
    const rows = composeHistoryRows(gbpOnly, [day(0)]);
    expect(rows).toEqual([{ base: 'GBP', quote: 'UAH', day: day(0), rate: '55', source: 'nbu' }]);
  });

  // Parity across the whole fiat set: the compose list is derived from
  // whatever `X:UAH` entries are present, not a fixed USD/EUR pair — every
  // one of the 106 supported fiat codes must compose the same way.
  it.each(fiatCurrencyOptions.filter((currency) => currency !== 'UAH'))(
    'composes a %s:UAH row for every supported fiat currency NBU answers for',
    (currency) => {
      const anchor: HistoryRateEntry[] = [
        { base: currency, quote: 'UAH', day: day(0), rate: 12.34, source: 'nbu' },
      ];
      const rows = composeHistoryRows(anchor, [day(0)]);
      expect(rows).toContainEqual({
        base: currency,
        quote: 'UAH',
        day: day(0),
        rate: '12.34',
        source: 'nbu',
      });
    },
  );
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
    const nbuCalls: NbuCall[] = [];
    const btcCalls: number[] = [];
    const lastBackfilledDay = overrides.lastBackfilledDay ?? null;
    // Every existing test below models a world where USD/EUR/BTC have already
    // been backfilled together up to `lastBackfilledDay` — the "a newly-held
    // currency" describe block sets `lastBackfilledDayByCurrency` directly to
    // exercise the per-currency gap this default would otherwise mask.
    const lastBackfilledDayByCurrency: Partial<Record<Currency, number>> =
      foldMap(maybe(lastBackfilledDay), (backfilledDay) => ({
        USD: backfilledDay,
        EUR: backfilledDay,
        BTC: backfilledDay,
      })) ?? {};
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay,
      today: day(0),
      fetchNbuHistory: async (currencies, start, end) => {
        nbuCalls.push({ currencies, start, end });

        return { entries: nbu, failedCurrencies: [] };
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
      historyCurrencies: async () => ({
        fiatCurrencies: ['USD', 'EUR'],
        cryptoCurrencies: ['BTC'],
      }),
      lastBackfilledDayByCurrency,
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

  it('passes the missing span and the held fiat currencies to NBU, and the day count to CoinGecko', async () => {
    const { deps, nbuCalls, btcCalls } = makeDeps({
      lastBackfilledDay: day(0),
      today: day(2),
    });

    await runBackfill(deps);

    expect(nbuCalls).toEqual([{ currencies: ['USD', 'EUR'], start: day(1), end: day(2) }]);
    // day(1)..day(2) inclusive -> 2 days back plus a boundary margin.
    expect(btcCalls[0]).toBeGreaterThanOrEqual(2);
  });

  // The fiat rates NBU already returned are still persisted
  // (settled independently — a BTC failure must not discard them), but the
  // overall pass now reports `'failed'`, not `'complete'`: BTC's own fetch
  // failed and composed no row for it, so the caller must retry on the next
  // focus instead of silently stranding BTC's history.
  it('still stores NBU fiat when the CoinGecko BTC fetch fails, but reports failed so BTC retries', async () => {
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
    expect(status).toEqual({ state: 'failed', lastDay: null });
  });

  // Crypto needs the SAME-run USD:UAH anchor (`composeHistoryRows`), so a
  // rejected NBU leg blocks BTC too even though CoinGecko itself answered —
  // nothing composes, and the pass must report `'failed'`, never `'complete'`
  // with zero rows silently accepted as "done".
  it('reports failed, composing nothing, when NBU fails even though CoinGecko succeeds', async () => {
    const { deps, captured } = makeDeps({
      fetchNbuHistory: async () => {
        throw new Error('NBU request failed: 500');
      },
    });

    const status: BackfillStatus = await runBackfill(deps);

    // With no fiat anchor at all, BTC itself never reaches a UAH price either
    // (its own X:UAH row needs the same-run USD:UAH anchor), so no row is
    // emitted for BTC or anything else, and the resume cursor stays at its
    // prior value (null) rather than advancing.
    expect(status).toEqual({ state: 'failed', lastDay: null });
    expect(captured).toHaveLength(0);
  });

  // An UNATTEMPTED leg (no crypto held at all) resolves fulfilled with
  // `NO_CRYPTO_HISTORY`, so a both-legs-rejected check alone would never fire
  // for a fiat-only user whose NBU fetch failed — the pass must still report
  // `'failed'` here, not `'complete'` with no retry for the rest of the
  // session.
  it('reports failed for a fiat-only user whose NBU fetch fails, even with no crypto attempted', async () => {
    const { deps, captured } = makeDeps({
      fetchNbuHistory: async () => {
        throw new Error('NBU request failed: 500');
      },
      historyCurrencies: async () => ({ fiatCurrencies: ['USD', 'EUR'], cryptoCurrencies: [] }),
    });

    const status: BackfillStatus = await runBackfill(deps);

    expect(status).toEqual({ state: 'failed', lastDay: null });
    expect(captured).toHaveLength(0);
  });

  it('does not advance the resume cursor when nothing is persisted', async () => {
    // Both providers return no usable anchors for the missing span, so no row is
    // stored. Reporting lastDay=today would falsely mark the span done and skip
    // re-fetching it forever; the cursor must stay where it was.
    const { deps, captured } = makeDeps({
      lastBackfilledDay: day(0),
      today: day(2),
      fetchNbuHistory: async () => ({ entries: [], failedCurrencies: [] }),
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
    const nbuCalls: NbuCall[] = [];
    const { deps, captured } = makeDeps({
      fetchNbuHistory: async (currencies, start, end) => {
        nbuCalls.push({ currencies, start, end });
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
      { currencies: ['USD', 'EUR'], start: day(0), end: day(0) },
      { currencies: ['USD', 'EUR'], start: day(0), end: day(0) },
    ]);
  });
});

// A held fiat currency other than USD/EUR (GBP) proves the fiat set is
// data-driven, not the old hard-coded pair — one NBU call for exactly the
// held currency, and its rows compose GBP:UAH for every missing day.
describe('runBackfill — an arbitrary held fiat currency (GBP)', () => {
  it('fetches only GBP, composing a GBP:UAH row for every missing day, carrying forward across a weekend', async () => {
    const gbpAnchors: HistoryRateEntry[] = [
      { base: 'GBP', quote: 'UAH', day: day(0), rate: 55, source: 'nbu' },
      // NBU has no weekend quote: day(3) (the "weekend") is skipped.
      { base: 'GBP', quote: 'UAH', day: day(4), rate: 56, source: 'nbu' },
    ];
    const nbuCalls: NbuCall[] = [];
    const captured: StoredRow[][] = [];
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: null,
      today: day(4),
      fetchNbuHistory: async (currencies, start, end) => {
        nbuCalls.push({ currencies, start, end });

        return { entries: gbpAnchors, failedCurrencies: [] };
      },
      fetchCryptoHistory: async () => answered([]),
      upsertMany: async (rows: StoredRow[]) => {
        captured.push(rows);
      },
      historyCurrencies: async () => ({ fiatCurrencies: ['GBP'], cryptoCurrencies: [] }),
    };

    const status = await runBackfill(deps);

    expect(nbuCalls).toEqual([{ currencies: ['GBP'], start: day(0), end: day(4) }]);
    expect(captured).toHaveLength(1);
    const rowsByDay = new Map(captured[0].map((row) => [row.day, row.rate]));
    expect(rowsByDay.get(day(0))).toBe('55');
    // The weekend day carries the prior GBP rate forward.
    expect(rowsByDay.get(day(3))).toBe('55');
    expect(rowsByDay.get(day(4))).toBe('56');
    expect(status.state).toBe('complete');
  });
});

// One currency's HTTP failure never discards a different currency's rows,
// and the failed currency alone resumes from its own missing cursor next run.
describe('runBackfill — one held fiat currency fails while another succeeds', () => {
  it('upserts GBP while PLN fails, reporting failed, then resumes on the next run', async () => {
    const nbuCalls: NbuCall[] = [];
    const captured: StoredRow[][] = [];
    const deps = (): BackfillDeps => ({
      earliestDay: day(0),
      lastBackfilledDay: null,
      lastBackfilledDayByCurrency: { GBP: day(0) },
      today: day(0),
      fetchNbuHistory: async (currencies, start, end) => {
        nbuCalls.push({ currencies, start, end });

        return {
          entries: [{ base: 'GBP', quote: 'UAH', day: day(0), rate: 55, source: 'nbu' }],
          failedCurrencies: ['PLN'],
        };
      },
      fetchCryptoHistory: async () => answered([]),
      upsertMany: async (rows: StoredRow[]) => {
        captured.push(rows);
      },
      historyCurrencies: async () => ({ fiatCurrencies: ['GBP', 'PLN'], cryptoCurrencies: [] }),
    });

    const firstRun = await runBackfill(deps());

    expect(firstRun.state).toBe('failed');
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual([
      { base: 'GBP', quote: 'UAH', day: day(0), rate: '55', source: 'nbu' },
    ]);

    // The next run: GBP's own cursor already covers today (per-currency,
    // fed by `lastBackfilledDayByCurrency`), but PLN has no stored day at
    // all — `resolveResumeCursor` treats a currency absent from that map as
    // maximally behind, so the whole span is re-fetched for BOTH currencies
    // (NBU has no per-currency window, only a shared span).
    await runBackfill(deps());

    expect(nbuCalls[1]).toEqual({ currencies: ['GBP', 'PLN'], start: day(0), end: day(0) });
  });
});

// A fiat currency NBU does not quote (e.g. AFN) answers with an empty array
// (fulfilled, not rejected) — it must be remembered as known-empty so the
// same never-backfilled currency does not force a full-span re-fetch on
// every subsequent run for as long as Statistics stays mounted.
describe('runBackfill — a fiat currency NBU has no quote for', () => {
  it('remembers AFN as known-empty after an answered-empty run', async () => {
    const knownEmptyCurrencies = new Set<Currency>();
    const nbuCalls: NbuCall[] = [];
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: null,
      today: day(0),
      fetchNbuHistory: async (currencies, start, end) => {
        nbuCalls.push({ currencies, start, end });

        return { entries: [], failedCurrencies: [] };
      },
      fetchCryptoHistory: async () => answered([]),
      upsertMany: async () => {},
      historyCurrencies: async () => ({ fiatCurrencies: ['AFN'], cryptoCurrencies: [] }),
      knownEmptyCurrencies,
    };

    const first = await runBackfill(deps);
    const second = await runBackfill(deps);

    expect(knownEmptyCurrencies.has('AFN')).toBe(true);
    expect(first.state).toBe('complete');
    expect(second.state).toBe('complete');
    // The first run answers empty and never treats that as a failure to
    // retry; the second run must not re-send AFN to NBU at all now that it
    // is known-empty.
    expect(nbuCalls).toHaveLength(1);
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
    const nbuCalls: NbuCall[] = [];
    const captured: StoredRow[][] = [];
    // The global cursor already sits at `today` (BTC's own prior run reached
    // it), but ETH itself was never held before and has no stored row.
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: day(2),
      today: day(2),
      fetchNbuHistory: async (currencies, start, end) => {
        nbuCalls.push({ currencies, start, end });

        return { entries: nbu, failedCurrencies: [] };
      },
      fetchCryptoHistory: async () => answered(crypto),
      upsertMany: async (rows: StoredRow[]) => {
        captured.push(rows);
      },
      historyCurrencies: async () => ({
        fiatCurrencies: ['USD', 'EUR'],
        cryptoCurrencies: ['BTC', 'ETH'],
      }),
      lastBackfilledDayByCurrency: { USD: day(2), EUR: day(2), BTC: day(2) },
    };

    const status = await runBackfill(deps);

    expect(nbuCalls).toEqual([{ currencies: ['USD', 'EUR'], start: day(0), end: day(2) }]);
    expect(captured).toHaveLength(1);
    expect(captured[0].some((row) => row.base === 'ETH' || row.quote === 'ETH')).toBe(true);
    expect(status).toEqual({ state: 'complete', lastDay: day(2) });
  });

  it('still backfills fiat conversion needed for the first time after the cursor already reached today', async () => {
    // The symmetric fiat gap: the global cursor sits at `today` (from some
    // OTHER now-removed currency's earlier run), but no fiat anchor has ever
    // been stored, and a holding now needs fiat conversion for the first time.
    const nbuCalls: NbuCall[] = [];
    const captured: StoredRow[][] = [];
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: day(2),
      today: day(2),
      fetchNbuHistory: async (currencies, start, end) => {
        nbuCalls.push({ currencies, start, end });

        return { entries: nbu, failedCurrencies: [] };
      },
      fetchCryptoHistory: async () => answered([]),
      upsertMany: async (rows: StoredRow[]) => {
        captured.push(rows);
      },
      historyCurrencies: async () => ({ fiatCurrencies: ['USD', 'EUR'], cryptoCurrencies: [] }),
      lastBackfilledDayByCurrency: {},
    };

    const status = await runBackfill(deps);

    expect(nbuCalls).toEqual([{ currencies: ['USD', 'EUR'], start: day(0), end: day(2) }]);
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
    const nbuCalls: NbuCall[] = [];
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: day(2),
      today: day(2),
      fetchNbuHistory: async (currencies, start, end) => {
        nbuCalls.push({ currencies, start, end });

        return { entries: nbu, failedCurrencies: [] };
      },
      fetchCryptoHistory,
      upsertMany: async () => {},
      historyCurrencies: async () => ({
        fiatCurrencies: ['USD', 'EUR'],
        cryptoCurrencies: ['BTC', 'ETH'],
      }),
      lastBackfilledDayByCurrency: { USD: day(2), EUR: day(2), BTC: day(2) },
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

    expect(nbuCalls).toEqual([{ currencies: ['USD', 'EUR'], start: day(0), end: day(2) }]);
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

// A currency that already has SOME stored rows (not the never-held case
// above) but whose own leg keeps failing must not hide behind a DIFFERENT
// currency's success once the global cursor reaches today — end-to-end
// across two runs, re-deriving both cursors from the rows the FIRST run
// actually persisted, the same way the real Statistics screen does from
// `historyRowsQuery()`.
describe('runBackfill — a lagging currency with existing rows is not permanently gapped', () => {
  it('fetches crypto for the gap on the next run once fiat has already advanced past it', async () => {
    // Steady state before this test starts: USD/EUR/BTC all backfilled
    // together through day(0).
    const historyRows: { base: Currency; day: number }[] = [
      { base: 'USD', day: day(0) },
      { base: 'EUR', day: day(0) },
      { base: 'BTC', day: day(0) },
    ];
    const upsertMany = async (rows: StoredRow[]): Promise<void> => {
      for (const row of rows) {
        historyRows.push({ base: row.base as Currency, day: row.day });
      }
    };
    const cryptoDaysRequested: number[] = [];

    const makeRunDeps = (fetchCryptoHistory: BackfillDeps['fetchCryptoHistory']): BackfillDeps => ({
      earliestDay: day(0),
      lastBackfilledDay: deriveLastBackfilledDay(historyRows.map((row) => ({ day: row.day }))),
      lastBackfilledDayByCurrency: deriveLastBackfilledDayByCurrency(
        historyRows.map((row) => ({ base: row.base, quote: 'UAH' as Currency, day: row.day })),
      ),
      today: day(2),
      fetchNbuHistory: async (_currencies, start, end) => {
        const entries: HistoryRateEntry[] = [];

        for (let d = start; d <= end; d += DAY_MS) {
          entries.push({ base: 'USD', quote: 'UAH', day: d, rate: 40, source: 'nbu' });
          entries.push({ base: 'EUR', quote: 'UAH', day: d, rate: 43, source: 'nbu' });
        }

        return { entries, failedCurrencies: [] };
      },
      fetchCryptoHistory,
      upsertMany,
      historyCurrencies: async () => ({
        fiatCurrencies: ['USD', 'EUR'],
        cryptoCurrencies: ['BTC'],
      }),
      // Isolated from the module-level singleton, so an unrelated test's own
      // known-empty bookkeeping can never leak into this one (or vice versa).
      knownEmptyCurrencies: new Set(),
    });

    // Run 1: NBU succeeds and advances fiat all the way to today; the crypto
    // leg rejects, so BTC's own history stays stuck at day(0).
    const firstRun = await runBackfill(
      makeRunDeps(async (days) => {
        cryptoDaysRequested.push(days);
        throw new Error('CoinGecko request failed: 401');
      }),
    );

    expect(firstRun.state).toBe('failed');
    // Fiat DID persist despite the overall 'failed' outcome.
    expect(historyRows.some((row) => row.base === 'USD' && row.day === day(2))).toBe(true);
    // BTC's own history is unchanged — still stuck at day(0), the permanent
    // gap a single shared cursor would otherwise leave forever.
    const btcRowsAfterFirstRun = historyRows.filter((row) => row.base === 'BTC');
    expect(Math.max(...btcRowsAfterFirstRun.map((row) => row.day))).toBe(day(0));

    // Run 2 (the caller's own next focus/retry, re-deriving both cursors from
    // the rows run 1 actually persisted): crypto now succeeds.
    const secondRun = await runBackfill(
      makeRunDeps(async (days) => {
        cryptoDaysRequested.push(days);

        const entries: HistoryRateEntry[] = [];

        for (let d = day(0); d <= day(2); d += DAY_MS) {
          entries.push({ base: 'BTC', quote: 'USD', day: d, rate: 65_000, source: 'coingecko' });
        }

        return { entries, failedCurrencies: [] };
      }),
    );

    // The global max(day) across ALL stored rows already sits at today (from
    // fiat) — a global cursor would have computed `missingDays` as EMPTY and
    // never re-asked CoinGecko at all. The per-currency minimum instead
    // drives the window from BTC's own (still day(0)) history, so the retry
    // actually re-covers the 2-day gap.
    expect(cryptoDaysRequested[1]).toBeGreaterThanOrEqual(2);
    expect(secondRun.state).toBe('complete');
    expect(historyRows.some((row) => row.base === 'BTC' && row.day === day(2))).toBe(true);
  });
});

// `planBackfillRun` passes `resumeFrom: null` deliberately — not "nothing
// known" but "treat this span as never run" — whenever an older transaction
// extends `spanStart` EARLIER than any prior run covered, since the forward,
// per-currency resume cursor cannot see a gap that opens BELOW the newest
// stored day. That explicit null must win over the per-currency minimum
// below it, or the days between the new, earlier `earliestDay` and whatever
// day every held currency already reached are silently skipped.
describe('runBackfill — an earlier-extension re-run (an explicit null lastBackfilledDay)', () => {
  it('recomputes from earliestDay even though every held currency already has rows at today', async () => {
    const nbuCalls: NbuCall[] = [];
    const deps: BackfillDeps = {
      earliestDay: day(0),
      lastBackfilledDay: null,
      lastBackfilledDayByCurrency: { USD: day(5) },
      today: day(5),
      fetchNbuHistory: async (currencies, start, end) => {
        nbuCalls.push({ currencies, start, end });

        return {
          entries: [{ base: 'USD', quote: 'UAH', day: start, rate: 40, source: 'nbu' }],
          failedCurrencies: [],
        };
      },
      fetchCryptoHistory: async () => answered([]),
      upsertMany: async () => {},
      historyCurrencies: async () => ({ fiatCurrencies: ['USD'], cryptoCurrencies: [] }),
    };

    await runBackfill(deps);

    expect(nbuCalls).toEqual([{ currencies: ['USD'], start: day(0), end: day(5) }]);
  });
});

// kiko-architecture: app-open and refresh work is gated on data presence —
// no request or query for data the user does not have. `historyCurrencies`
// reports the fiat/crypto set worth fetching; each leg fetches only when its
// own gate says so.
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
    fetchNbuHistory: async () => ({ entries: nbu, failedCurrencies: [] }),
    fetchCryptoHistory: async () => answered(btc),
    upsertMany: async () => {},
    ...overrides,
  });

  it('fetches and writes nothing when nothing needs converting and no crypto is held (UAH-only, base UAH)', async () => {
    let nbuCalled = false;
    let cryptoCalled = false;
    const captured: StoredRow[][] = [];
    const deps = makeDeps({
      fetchNbuHistory: async () => {
        nbuCalled = true;

        return { entries: nbu, failedCurrencies: [] };
      },
      fetchCryptoHistory: async () => {
        cryptoCalled = true;

        return answered(btc);
      },
      upsertMany: async (rows: StoredRow[]) => {
        captured.push(rows);
      },
      historyCurrencies: async () => ({ fiatCurrencies: [], cryptoCurrencies: [] }),
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
      historyCurrencies: async () => ({ fiatCurrencies: ['USD'], cryptoCurrencies: [] }),
    });

    await runBackfill(deps);

    expect(cryptoCalled).toBe(false);
  });

  it('fetches only CoinGecko when no fiat conversion is needed', async () => {
    let nbuCalled = false;
    const deps = makeDeps({
      fetchNbuHistory: async () => {
        nbuCalled = true;

        return { entries: nbu, failedCurrencies: [] };
      },
      historyCurrencies: async () => ({ fiatCurrencies: [], cryptoCurrencies: ['BTC'] }),
    });

    await runBackfill(deps);

    expect(nbuCalled).toBe(false);
  });

  it('passes only the held fiat currencies to fetchNbuHistory, never the full supported set', async () => {
    let receivedCurrencies: Currency[] = [];
    const deps = makeDeps({
      fetchNbuHistory: async (currencies) => {
        receivedCurrencies = currencies;

        return { entries: nbu, failedCurrencies: [] };
      },
      historyCurrencies: async () => ({ fiatCurrencies: ['USD'], cryptoCurrencies: [] }),
    });

    await runBackfill(deps);

    expect(receivedCurrencies).toEqual(['USD']);
  });

  it('passes only the held crypto currencies to fetchCryptoHistory, never the full supported set', async () => {
    let receivedCurrencies: string[] = [];
    const deps = makeDeps({
      fetchCryptoHistory: async (_days, currencies) => {
        receivedCurrencies = currencies ?? [];

        return answered(btc);
      },
      historyCurrencies: async () => ({ fiatCurrencies: ['USD'], cryptoCurrencies: ['BTC'] }),
    });

    await runBackfill(deps);

    expect(receivedCurrencies).toEqual(['BTC']);
  });
});

// A history day with a missing leg: NBU has no Saturday/Sunday quote (a real
// weekend gap), while CoinGecko prices BTC every calendar day. Each currency's
// own X:UAH row now carries forward independently (its OWN nearest-at-or-
// before anchor), rather than a stored cross pair carrying both legs forward
// as one joint unit — `buildNetWorthSeries` must still value a BTC holding
// correctly on the gap day, and no bucket may drop a holding it could convert
// on an earlier day.
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
      closedAt: null,
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
