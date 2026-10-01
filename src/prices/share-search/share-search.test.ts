import type { Currency } from '@kiko/currency/currency';

import {
  EodhdAuthError,
  EodhdQuotaError,
  EodhdServerError,
  EodhdNetworkError,
  EodhdNotInPlanError,
  EodhdRateLimitError,
  EodhdUnavailableError,
  type SymbolMatch,
} from '../eodhd';
import type { QuoteQuota } from '../quote-quota';

import { searchShares, type ShareSearchDeps } from './share-search';

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY = 'fake-eodhd-key-0000';
const TODAY = Date.UTC(2026, 9, 1);
const NOW = TODAY + 9 * 60 * 60 * 1000;
const FIAT: Currency[] = ['UAH', 'USD', 'EUR', 'GBP'];

const listing = (overrides: Partial<SymbolMatch> = {}): SymbolMatch => ({
  symbol: 'AAPL.US',
  name: 'Apple Inc',
  isin: 'US0378331005',
  currency: 'USD',
  isPrimary: true,
  ...overrides,
});

type World = {
  key: string | undefined;
  quota: QuoteQuota | null;
  answer: SymbolMatch[] | Error;
  events: string[];
};

const makeWorld = (overrides: Partial<World> = {}): World => ({
  key: KEY,
  quota: null,
  answer: [listing()],
  events: [],
  ...overrides,
});

const depsFor = (world: World): ShareSearchDeps => ({
  now: () => NOW,
  readKey: async () => world.key,
  updateQuota: async (build) => {
    world.quota = build(world.quota);
    world.events.push(`quota ${world.quota?.calls}`);
  },
  searchSymbols: async (query, key, _fetchImpl, exchange) => {
    world.events.push(`search ${query}`.concat(key === KEY ? '' : '!', exchange ?? ''));

    if (world.answer instanceof Error) {
      throw world.answer;
    }

    return world.answer;
  },
});

const quota = (overrides: Partial<QuoteQuota> = {}): QuoteQuota => ({
  day: TODAY,
  calls: 0,
  dailyLimit: 20,
  symbols: [],
  ...overrides,
});

describe('searchShares', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('asks EODHD with the saved key and returns each listing in its holding currency', async () => {
    const world = makeWorld();

    await expect(searchShares('AAPL', FIAT, depsFor(world))).resolves.toEqual({
      status: 'ok',
      listings: [
        {
          symbol: 'AAPL.US',
          name: 'Apple Inc',
          isin: 'US0378331005',
          currency: 'USD',
          quoteCurrency: 'USD',
        },
      ],
    });
    expect(world.events).toEqual(['quota 1', 'search AAPL']);
  });

  it('searches by ISIN the same way', async () => {
    const world = makeWorld();

    await searchShares('US0378331005', FIAT, depsFor(world));

    expect(world.events).toEqual(['quota 1', 'search US0378331005']);
  });

  it('sends the query without its surrounding spaces', async () => {
    const world = makeWorld();

    await searchShares('  AAPL ', FIAT, depsFor(world));

    expect(world.events).toContain('search AAPL');
  });

  it('turns a pence listing into a pound holding priced in pence', async () => {
    const world = makeWorld({
      answer: [listing({ symbol: 'VOD.LSE', name: 'Vodafone Group PLC', currency: 'GBX' })],
    });

    const result = await searchShares('VOD', FIAT, depsFor(world));

    expect(result).toEqual({
      status: 'ok',
      listings: [expect.objectContaining({ currency: 'GBP', quoteCurrency: 'GBX' })],
    });
  });

  it('drops a listing whose currency the holding cannot take', async () => {
    const world = makeWorld({
      answer: [
        listing({ symbol: 'AAPL.TO', currency: 'CAD' }),
        listing({ symbol: 'AAPL.XX', currency: 'XYZ' }),
        listing({ symbol: 'VOD.LSE', currency: 'GBX' }),
        listing(),
      ],
    });

    const result = await searchShares('AAPL', ['USD'], depsFor(world));

    expect(result).toEqual({
      status: 'ok',
      listings: [expect.objectContaining({ symbol: 'AAPL.US' })],
    });
  });

  it('lists the primary listings first and keeps EODHD order otherwise', async () => {
    const world = makeWorld({
      answer: [
        listing({ symbol: 'AAPL.NEO', isPrimary: false }),
        listing({ symbol: 'AAPL.US' }),
        listing({ symbol: 'AAPL.MX', isPrimary: false }),
        listing({ symbol: 'APC.XETRA', currency: 'EUR' }),
      ],
    });

    const result = await searchShares('AAPL', FIAT, depsFor(world));

    expect(result.status === 'ok' && result.listings.map(({ symbol }) => symbol)).toEqual([
      'AAPL.US',
      'APC.XETRA',
      'AAPL.NEO',
      'AAPL.MX',
    ]);
  });

  it('leaves out an ISIN EODHD does not know', async () => {
    const world = makeWorld({ answer: [listing({ isin: undefined })] });

    await expect(searchShares('AAPL', FIAT, depsFor(world))).resolves.toEqual({
      status: 'ok',
      listings: [{ symbol: 'AAPL.US', name: 'Apple Inc', currency: 'USD', quoteCurrency: 'USD' }],
    });
  });

  describe('gate', () => {
    it('spends nothing without a saved key', async () => {
      const world = makeWorld({ key: undefined });

      await expect(searchShares('AAPL', FIAT, depsFor(world))).resolves.toEqual({
        status: 'noKey',
      });
      expect(world.events).toEqual([]);
    });
  });

  describe('quota', () => {
    it('reserves the call on the current UTC day before it asks', async () => {
      const world = makeWorld({ quota: quota({ calls: 5, symbols: ['AAPL.US'] }) });

      await searchShares('AAPL', FIAT, depsFor(world));

      expect(world.quota).toEqual(quota({ calls: 6, symbols: ['AAPL.US'] }));
    });

    it('may spend the last calls a refresh leaves for search', async () => {
      const world = makeWorld({ quota: quota({ calls: 19 }) });

      await expect(searchShares('AAPL', FIAT, depsFor(world))).resolves.toMatchObject({
        status: 'ok',
      });
      expect(world.quota).toEqual(quota({ calls: 20 }));
    });

    it('asks nothing once the day is used up', async () => {
      const world = makeWorld({ quota: quota({ calls: 20 }) });

      await expect(searchShares('AAPL', FIAT, depsFor(world))).resolves.toEqual({
        status: 'quotaExhausted',
      });
      expect(world.events.filter((event) => event.startsWith('search'))).toEqual([]);
      expect(world.quota).toEqual(quota({ calls: 20 }));
    });

    it('starts a quota stored on an earlier UTC day over', async () => {
      const world = makeWorld({ quota: quota({ day: TODAY - DAY_MS, calls: 20 }) });

      await expect(searchShares('AAPL', FIAT, depsFor(world))).resolves.toMatchObject({
        status: 'ok',
      });
      expect(world.quota).toEqual(quota({ calls: 1 }));
    });

    it('marks the day used up when EODHD reports the daily limit', async () => {
      const world = makeWorld({ quota: quota({ calls: 3 }), answer: new EodhdQuotaError() });

      await expect(searchShares('AAPL', FIAT, depsFor(world))).resolves.toEqual({
        status: 'quotaExhausted',
      });
      expect(world.quota).toEqual(quota({ calls: 20 }));
    });

    it('gives the call back when EODHD never answered', async () => {
      const world = makeWorld({ quota: quota({ calls: 3 }), answer: new EodhdNetworkError() });

      await expect(searchShares('AAPL', FIAT, depsFor(world))).resolves.toEqual({
        status: 'failed',
      });
      expect(world.quota).toEqual(quota({ calls: 3 }));
    });
  });

  describe('failures', () => {
    it.each([
      ['a rejected key', new EodhdAuthError()],
      ['a search outside the plan', new EodhdNotInPlanError()],
      ['the per-minute limit', new EodhdRateLimitError()],
      ['a server error', new EodhdServerError()],
      ['a bad answer', new EodhdUnavailableError()],
    ])('reports %s as failed and counts the call', async (_reason, error) => {
      const world = makeWorld({ quota: quota({ calls: 3 }), answer: error });

      await expect(searchShares('AAPL', FIAT, depsFor(world))).resolves.toEqual({
        status: 'failed',
      });
      expect(world.quota).toEqual(quota({ calls: 4 }));
    });

    it('logs a failed search by its error name, never the key or the query', async () => {
      const world = makeWorld({ answer: new EodhdAuthError() });

      await searchShares('US0378331005', FIAT, depsFor(world));

      expect(warn).toHaveBeenCalledWith('[share-search] EODHD search failed', {
        name: 'EodhdAuthError',
        code: undefined,
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('US0378331005');
    });
  });
});
