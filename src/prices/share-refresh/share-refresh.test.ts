import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';

import {
  EodhdAuthError,
  EodhdQuotaError,
  EodhdNetworkError,
  EodhdNotInPlanError,
  EodhdRateLimitError,
  EodhdUnavailableError,
  type SymbolMatch,
} from '../eodhd';
import { settle, type QuoteQuota } from '../quote-quota';

import type { ShareRefreshResult } from './share-refresh-write';
import { refreshSharePrices, type ShareRefreshDeps } from './share-refresh';

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY = 'fake-eodhd-key-0000';
// A Thursday: the last weekday before it is Wednesday, September 30.
const THURSDAY = Date.UTC(2026, 9, 1);
const NOW = THURSDAY + 9 * 60 * 60 * 1000;
const WEDNESDAY = THURSDAY - DAY_MS;
const TUESDAY = THURSDAY - 2 * DAY_MS;

type ShareOptions = {
  id: string;
  symbol?: string;
  currency?: Currency;
  quoteCurrency?: string;
  // A ticker typed by hand: the form cannot know the listing's price unit.
  handTyped?: boolean;
  quoteSource?: 'eodhd' | 'manual';
  lotDays?: number[];
};

type ShareHolding = { id: string; currency: Currency; metadata: unknown };
type EodClose = { day: number; close: string };
type StoredPoint = { instrument: string; day: number; price: string; currency: string };

const share = ({
  id,
  symbol = 'AAPL.US',
  currency = 'USD',
  quoteCurrency = currency,
  handTyped = false,
  quoteSource = 'eodhd',
  lotDays = [Date.UTC(2026, 5, 1)],
}: ShareOptions): ShareHolding => ({
  id,
  currency,
  metadata: {
    quoteSource,
    symbol,
    ...(handTyped ? {} : { quoteCurrency }),
    lots: lotDays.map((day) => ({ day, quantityDelta: '1', costMinorUnits: 100 })),
  },
});

const point = (symbol: string, day: number): StoredPoint => ({
  instrument: `share:${symbol}`,
  day,
  price: '1',
  currency: 'USD',
});

type World = {
  holdings: ShareHolding[];
  points: StoredPoint[];
  quota: QuoteQuota | null;
  key: string | undefined;
  eod: Record<string, EodClose[] | Error>;
  search: Record<string, SymbolMatch[] | Error>;
  events: string[];
  saved: ShareRefreshResult[];
};

const makeWorld = (overrides: Partial<World> = {}): World => ({
  holdings: [share({ id: 'apple' })],
  points: [],
  quota: null,
  key: KEY,
  eod: {},
  search: {},
  events: [],
  saved: [],
  ...overrides,
});

const text = (day: number): string => new Date(day).toISOString().slice(0, 10);

const answer = async <Value>(found: Value | Error | undefined, fallback: Value): Promise<Value> => {
  if (found instanceof Error) {
    throw found;
  }

  return found ?? fallback;
};

const withSavedUnit = (holding: ShareHolding, result: ShareRefreshResult): ShareHolding =>
  foldMap(
    maybe(result.units.find((unit) => unit.holdingId === holding.id)),
    (unit): ShareHolding => ({
      ...holding,
      metadata: { ...(holding.metadata as object), quoteCurrency: unit.quoteCurrency },
    }),
  ) ?? holding;

const depsFor = (world: World): ShareRefreshDeps => ({
  now: () => NOW,
  listShares: async () => world.holdings,
  readKey: async () => {
    world.events.push('read key');

    return world.key;
  },
  loadQuota: async () => world.quota,
  updateQuota: async (build) => {
    world.quota = build(world.quota);
    world.events.push(`reserve ${world.quota?.calls}`);
  },
  loadLatestPoints: async () => world.points,
  fetchEod: async (symbol, fromDay, toDay, key) => {
    world.events.push(
      `eod ${symbol} ${text(fromDay)} ${text(toDay)}`.concat(key === KEY ? '' : '!'),
    );

    return answer(world.eod[symbol], []);
  },
  searchSymbols: async (query, key, _fetchImpl, exchange) => {
    world.events.push(`search ${query} ${exchange}`.concat(key === KEY ? '' : '!'));

    return answer(world.search[query], []);
  },
  save: async (result) => {
    world.events.push('save');
    world.saved.push(result);
    world.points.push(...result.rows);
    world.holdings = world.holdings.map((holding) => withSavedUnit(holding, result));
    world.quota = settle(world.quota, result.settlement);
  },
});

const calls = (world: World): string[] =>
  world.events.filter((event) => event.startsWith('eod') || event.startsWith('search'));

describe('refreshSharePrices', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('data-presence gate', () => {
    it('reads no key and calls nothing when no share is held', async () => {
      const world = makeWorld({ holdings: [] });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('noShares');
      expect(world.events).toEqual([]);
    });

    it('never refreshes a share priced by hand', async () => {
      const world = makeWorld({ holdings: [share({ id: 'manual', quoteSource: 'manual' })] });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('noShares');
      expect(world.events).toEqual([]);
    });

    it('calls nothing without a saved key', async () => {
      const world = makeWorld({ key: undefined });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('noKey');
      expect(world.events).toEqual(['read key']);
    });
  });

  describe('first refresh of a symbol', () => {
    it('fetches from the earliest lot through today and stores the closes in the holding currency', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'apple', lotDays: [Date.UTC(2026, 6, 1), Date.UTC(2026, 5, 15)] })],
        eod: { 'AAPL.US': [{ day: WEDNESDAY, close: '325.13' }] },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');

      expect(calls(world)).toEqual(['eod AAPL.US 2026-06-15 2026-10-01']);
      expect(world.saved).toEqual([
        {
          rows: [
            {
              instrument: 'share:AAPL.US',
              day: WEDNESDAY,
              price: '325.13',
              currency: 'USD',
              source: 'eodhd',
            },
          ],
          units: [],
          settlement: { day: THURSDAY, reserved: 1, spent: 1, unanswered: [], usedUp: false },
        },
      ]);
      expect(world.quota).toEqual({
        day: THURSDAY,
        calls: 1,
        dailyLimit: 20,
        symbols: ['AAPL.US'],
      });
    });

    it('asks for at most one year of history, all the free plan has', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'apple', lotDays: [Date.UTC(2020, 0, 1)] })],
      });

      await refreshSharePrices(depsFor(world));

      expect(calls(world)).toEqual([`eod AAPL.US ${text(THURSDAY - 365 * DAY_MS)} 2026-10-01`]);
    });

    it('makes one call for two holdings of the same symbol, from the earlier lot', async () => {
      const world = makeWorld({
        holdings: [
          share({ id: 'first', lotDays: [Date.UTC(2026, 7, 1)] }),
          share({ id: 'second', lotDays: [Date.UTC(2026, 6, 1)] }),
        ],
      });

      await refreshSharePrices(depsFor(world));

      expect(calls(world)).toEqual(['eod AAPL.US 2026-07-01 2026-10-01']);
    });

    it('calls nothing for a share whose first lot is still to come', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'apple', lotDays: [THURSDAY + 3 * DAY_MS] })],
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');
      expect(world.events).toEqual(['read key']);
    });

    it('passes the saved key to every call', async () => {
      const world = makeWorld();

      await refreshSharePrices(depsFor(world));

      expect(calls(world).some((call) => call.endsWith('!'))).toBe(false);
    });
  });

  describe('once a symbol has prices', () => {
    it('calls nothing and writes nothing while the latest close is from the last weekday', async () => {
      const world = makeWorld({ points: [point('AAPL.US', WEDNESDAY)] });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');
      expect(world.events).toEqual(['read key']);
    });

    it('treats Friday as the last weekday on a Monday', async () => {
      const monday = THURSDAY + 4 * DAY_MS;
      const world = makeWorld({ points: [point('AAPL.US', THURSDAY + DAY_MS)] });

      await refreshSharePrices({ ...depsFor(world), now: () => monday + 1000 });

      expect(calls(world)).toEqual([]);
    });

    it('fetches only the days after the latest close', async () => {
      const world = makeWorld({ points: [point('AAPL.US', TUESDAY - DAY_MS)] });

      await refreshSharePrices(depsFor(world));

      expect(calls(world)).toEqual(['eod AAPL.US 2026-09-29 2026-10-01']);
    });

    it('calls a symbol once per UTC day, even when its answer had no close', async () => {
      const world = makeWorld();

      await refreshSharePrices(depsFor(world));
      await refreshSharePrices(depsFor(world));

      expect(calls(world)).toEqual(['eod AAPL.US 2026-06-01 2026-10-01']);
    });

    it('calls the symbol again on the next UTC day', async () => {
      const world = makeWorld();

      await refreshSharePrices(depsFor(world));
      await refreshSharePrices({ ...depsFor(world), now: () => NOW + DAY_MS });

      expect(calls(world)).toHaveLength(2);
    });
  });

  describe('quota', () => {
    it('reserves the calls before it makes them, then writes once', async () => {
      const world = makeWorld();

      await refreshSharePrices(depsFor(world));

      expect(world.events).toEqual([
        'read key',
        'reserve 1',
        'eod AAPL.US 2026-06-01 2026-10-01',
        'save',
      ]);
    });

    it('runs one refresh at a time, so two overlapping refreshes ask for a symbol once', async () => {
      const world = makeWorld();

      await Promise.all([refreshSharePrices(depsFor(world)), refreshSharePrices(depsFor(world))]);

      expect(calls(world)).toEqual(['eod AAPL.US 2026-06-01 2026-10-01']);
      expect(world.quota?.calls).toBe(1);
    });

    it('starts the next refresh after one that failed', async () => {
      const world = makeWorld();
      const broken = refreshSharePrices({
        ...depsFor(world),
        listShares: async () => {
          throw new Error('database closed');
        },
      });

      await expect(broken).rejects.toThrow('database closed');
      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');
    });

    it('keeps the daily limit and count a key save stored while the calls were out', async () => {
      const world = makeWorld();

      await refreshSharePrices({
        ...depsFor(world),
        fetchEod: async () => {
          world.quota = { day: THURSDAY, calls: 7, dailyLimit: 100, symbols: ['AAPL.US'] };

          return [];
        },
      });

      expect(world.quota).toEqual({
        day: THURSDAY,
        calls: 7,
        dailyLimit: 100,
        symbols: ['AAPL.US'],
      });
    });

    it('calls nothing and writes nothing once only the 2 search calls are left', async () => {
      const world = makeWorld({
        quota: { day: THURSDAY, calls: 18, dailyLimit: 20, symbols: [] },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('quotaExhausted');
      expect(world.events).toEqual(['read key']);
    });

    it('starts a quota stored on an earlier UTC day over', async () => {
      const world = makeWorld({
        quota: { day: WEDNESDAY, calls: 20, dailyLimit: 20, symbols: ['AAPL.US'] },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');
      expect(world.quota).toEqual({
        day: THURSDAY,
        calls: 1,
        dailyLimit: 20,
        symbols: ['AAPL.US'],
      });
    });

    it('refreshes the oldest price first when the calls left do not cover every symbol', async () => {
      const world = makeWorld({
        holdings: [
          share({ id: 'apple', symbol: 'AAPL.US' }),
          share({ id: 'sap', symbol: 'SAP.XETRA', currency: 'EUR' }),
          share({ id: 'never', symbol: 'MSFT.US' }),
          share({ id: 'nvidia', symbol: 'NVDA.US' }),
        ],
        points: [
          point('AAPL.US', TUESDAY),
          { ...point('SAP.XETRA', TUESDAY - 7 * DAY_MS), currency: 'EUR' },
          point('NVDA.US', TUESDAY - DAY_MS),
        ],
        quota: { day: THURSDAY, calls: 16, dailyLimit: 20, symbols: [] },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('quotaExhausted');
      expect(calls(world)).toEqual([
        'eod MSFT.US 2026-06-01 2026-10-01',
        'eod SAP.XETRA 2026-09-23 2026-10-01',
      ]);
      expect(world.quota?.calls).toBe(18);
    });

    it('marks the day used up and stops when EODHD reports the daily limit', async () => {
      const world = makeWorld({
        holdings: [
          share({ id: 'apple' }),
          share({ id: 'sap', symbol: 'SAP.XETRA', currency: 'EUR' }),
        ],
        eod: { 'AAPL.US': new EodhdQuotaError() },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('quotaExhausted');
      expect(calls(world)).toEqual(['eod AAPL.US 2026-06-01 2026-10-01']);
      expect(world.quota).toEqual({ day: THURSDAY, calls: 20, dailyLimit: 20, symbols: [] });
    });

    it('stops on the per-minute rate limit and leaves the rest of the day', async () => {
      const world = makeWorld({
        holdings: [
          share({ id: 'apple' }),
          share({ id: 'sap', symbol: 'SAP.XETRA', currency: 'EUR' }),
        ],
        eod: { 'AAPL.US': new EodhdRateLimitError() },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('failed');
      expect(calls(world)).toEqual(['eod AAPL.US 2026-06-01 2026-10-01']);
      expect(world.quota).toEqual({ day: THURSDAY, calls: 1, dailyLimit: 20, symbols: [] });
    });
  });

  describe('failures', () => {
    it('stops at a rejected key, spends nothing more, and keeps the closes already fetched', async () => {
      const world = makeWorld({
        holdings: [
          share({ id: 'apple' }),
          share({ id: 'sap', symbol: 'SAP.XETRA', currency: 'EUR' }),
          share({ id: 'nvidia', symbol: 'NVDA.US' }),
        ],
        points: [point('AAPL.US', TUESDAY - DAY_MS), point('NVDA.US', TUESDAY - DAY_MS)],
        eod: {
          'SAP.XETRA': [{ day: WEDNESDAY, close: '240.5' }],
          'AAPL.US': new EodhdAuthError(),
        },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('failed');
      expect(calls(world)).toEqual([
        'eod SAP.XETRA 2026-06-01 2026-10-01',
        'eod AAPL.US 2026-09-29 2026-10-01',
      ]);
      expect(world.quota).toEqual({
        day: THURSDAY,
        calls: 2,
        dailyLimit: 20,
        symbols: ['SAP.XETRA'],
      });
      expect(world.saved[0]?.rows).toEqual([
        {
          instrument: 'share:SAP.XETRA',
          day: WEDNESDAY,
          price: '240.5',
          currency: 'EUR',
          source: 'eodhd',
        },
      ]);
    });

    it('skips a symbol outside the plan and refreshes the rest', async () => {
      const world = makeWorld({
        holdings: [
          share({ id: 'vod', symbol: 'VOD.LSE', currency: 'GBP', quoteCurrency: 'GBP' }),
          share({ id: 'apple' }),
        ],
        eod: {
          'VOD.LSE': new EodhdNotInPlanError(),
          'AAPL.US': [{ day: WEDNESDAY, close: '325.13' }],
        },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');
      expect(calls(world)).toHaveLength(2);
      expect(world.quota?.symbols).toEqual(['AAPL.US', 'VOD.LSE']);
      expect(world.saved[0]?.rows).toHaveLength(1);
    });

    it('skips a symbol EODHD cannot answer, refreshes the rest, and leaves it for tomorrow', async () => {
      const world = makeWorld({
        holdings: [
          share({ id: 'first', symbol: 'AAA.US' }),
          share({ id: 'second', symbol: 'BBB.US' }),
          share({ id: 'third', symbol: 'CCC.US' }),
        ],
        eod: {
          'AAA.US': new EodhdUnavailableError(),
          'BBB.US': [{ day: WEDNESDAY, close: '10' }],
          'CCC.US': [{ day: WEDNESDAY, close: '20' }],
        },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');
      await refreshSharePrices(depsFor(world));

      expect(calls(world)).toEqual([
        'eod AAA.US 2026-06-01 2026-10-01',
        'eod BBB.US 2026-06-01 2026-10-01',
        'eod CCC.US 2026-06-01 2026-10-01',
      ]);
      expect(world.saved[0]?.rows.map((row) => row.instrument)).toEqual([
        'share:BBB.US',
        'share:CCC.US',
      ]);
      expect(world.quota?.symbols).toEqual(['AAA.US', 'BBB.US', 'CCC.US']);
    });

    it('skips a hand-typed share whose search EODHD cannot answer', async () => {
      const world = makeWorld({
        holdings: [
          share({ id: 'vod', symbol: 'VOD.LSE', currency: 'GBP', handTyped: true }),
          share({ id: 'apple' }),
        ],
        search: { VOD: new EodhdUnavailableError() },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');
      expect(calls(world)).toEqual(['eod AAPL.US 2026-06-01 2026-10-01', 'search VOD LSE']);
      expect(world.quota?.symbols).toEqual(['AAPL.US', 'VOD.LSE']);
    });

    it('stops when EODHD cannot be reached and retries later the same day, counting the call', async () => {
      const world = makeWorld({ eod: { 'AAPL.US': new EodhdNetworkError() } });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('failed');
      expect(world.quota).toEqual({ day: THURSDAY, calls: 1, dailyLimit: 20, symbols: [] });

      world.eod = {};
      await refreshSharePrices(depsFor(world));

      expect(calls(world)).toHaveLength(2);
    });

    it('logs a failed call by its error name, never the key', async () => {
      const world = makeWorld({ eod: { 'AAPL.US': new EodhdAuthError() } });

      await refreshSharePrices(depsFor(world));

      expect(warn).toHaveBeenCalledWith('[share-refresh] EODHD request failed', {
        name: 'EodhdAuthError',
        code: undefined,
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
    });

    it('logs a skipped share without its symbol', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'vod', symbol: 'VOD.LSE', currency: 'GBP', handTyped: true })],
      });

      await refreshSharePrices(depsFor(world));

      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('VOD');
    });
  });

  describe('price unit', () => {
    it('stores a pence close as pounds for a GBP holding of a GBX listing', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'vod', symbol: 'VOD.LSE', currency: 'GBP', quoteCurrency: 'GBX' })],
        eod: { 'VOD.LSE': [{ day: WEDNESDAY, close: '122.7' }] },
      });

      await refreshSharePrices(depsFor(world));

      expect(world.saved[0]?.rows).toEqual([
        {
          instrument: 'share:VOD.LSE',
          day: WEDNESDAY,
          price: '1.227',
          currency: 'GBP',
          source: 'eodhd',
        },
      ]);
    });

    it('calls nothing for a listing whose unit is not the holding currency', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'vod', symbol: 'VOD.LSE', currency: 'GBP', quoteCurrency: 'USD' })],
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');
      expect(calls(world)).toEqual([]);
    });

    it('resolves the unit of a hand-typed share with one search, stores it, and converts the close', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'vod', symbol: 'VOD.LSE', currency: 'GBP', handTyped: true })],
        search: {
          VOD: [
            { symbol: 'VOD.US', name: 'Vodafone ADR', currency: 'USD' },
            { symbol: 'VOD.LSE', name: 'Vodafone Group PLC', currency: 'GBX' },
          ],
        },
        eod: { 'VOD.LSE': [{ day: WEDNESDAY, close: '122.7' }] },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');

      expect(calls(world)).toEqual(['search VOD LSE', 'eod VOD.LSE 2026-06-01 2026-10-01']);
      expect(world.saved[0]?.rows).toEqual([
        {
          instrument: 'share:VOD.LSE',
          day: WEDNESDAY,
          price: '1.227',
          currency: 'GBP',
          source: 'eodhd',
        },
      ]);
      expect(world.saved[0]?.units).toEqual([
        { holdingId: 'vod', symbol: 'VOD.LSE', quoteCurrency: 'GBX' },
      ]);
      expect(world.quota).toEqual({
        day: THURSDAY,
        calls: 2,
        dailyLimit: 20,
        symbols: ['VOD.LSE'],
      });
    });

    it('never searches again once the unit is stored', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'vod', symbol: 'VOD.LSE', currency: 'GBP', handTyped: true })],
        search: { VOD: [{ symbol: 'VOD.LSE', name: 'Vodafone Group PLC', currency: 'GBX' }] },
      });

      await refreshSharePrices(depsFor(world));
      await refreshSharePrices({ ...depsFor(world), now: () => NOW + DAY_MS });

      expect(calls(world)).toEqual([
        'search VOD LSE',
        'eod VOD.LSE 2026-06-01 2026-10-01',
        'eod VOD.LSE 2026-06-01 2026-10-02',
      ]);
    });

    it('skips a hand-typed share whose listing the search cannot find exactly', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'vod', symbol: 'VOD.LSE', currency: 'GBP', handTyped: true })],
        search: { VOD: [{ symbol: 'VOD.US', name: 'Vodafone ADR', currency: 'USD' }] },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');
      expect(calls(world)).toEqual(['search VOD LSE']);
      expect(world.saved[0]?.rows).toEqual([]);
      expect(world.saved[0]?.units).toEqual([]);
      expect(world.quota).toEqual({
        day: THURSDAY,
        calls: 1,
        dailyLimit: 20,
        symbols: ['VOD.LSE'],
      });
    });

    it('stores a resolved unit it cannot use, so it never searches for it again', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'vod', symbol: 'VOD.LSE', currency: 'GBP', handTyped: true })],
        search: { VOD: [{ symbol: 'VOD.LSE', name: 'Vodafone Group PLC', currency: 'USD' }] },
      });

      await refreshSharePrices(depsFor(world));
      await refreshSharePrices({ ...depsFor(world), now: () => NOW + DAY_MS });

      expect(calls(world)).toEqual(['search VOD LSE']);
      expect(world.saved[0]?.units).toEqual([
        { holdingId: 'vod', symbol: 'VOD.LSE', quoteCurrency: 'USD' },
      ]);
    });

    it('never searches for a symbol with no exchange suffix', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'vod', symbol: 'VOD', currency: 'GBP', handTyped: true })],
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('ok');
      expect(calls(world)).toEqual([]);
    });

    it('leaves a hand-typed share for tomorrow when only one call is left', async () => {
      const world = makeWorld({
        holdings: [
          share({ id: 'vod', symbol: 'VOD.LSE', currency: 'GBP', handTyped: true }),
          share({ id: 'apple' }),
        ],
        points: [point('AAPL.US', TUESDAY)],
        quota: { day: THURSDAY, calls: 17, dailyLimit: 20, symbols: [] },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('quotaExhausted');
      expect(calls(world)).toEqual(['eod AAPL.US 2026-09-30 2026-10-01']);
    });

    it('stops at the daily limit on the search call', async () => {
      const world = makeWorld({
        holdings: [share({ id: 'vod', symbol: 'VOD.LSE', currency: 'GBP', handTyped: true })],
        search: { VOD: new EodhdQuotaError() },
      });

      await expect(refreshSharePrices(depsFor(world))).resolves.toBe('quotaExhausted');
      expect(calls(world)).toEqual(['search VOD LSE']);
      expect(world.quota?.calls).toBe(20);
    });
  });
});
