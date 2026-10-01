import type { QuoteQuota } from '../quote-quota';
import { EodhdRateLimitError, type UserLimits } from '../eodhd';

import { confirmDailyLimit, type DailyLimitDeps } from './daily-limit';

const KEY = 'fake-eodhd-key-0000';
const TODAY = Date.UTC(2026, 9, 1);
const NOW = TODAY + 9 * 60 * 60 * 1000;

type World = {
  key: string | undefined;
  quota: QuoteQuota | null;
  answer: UserLimits | Error;
  events: string[];
};

const makeWorld = (overrides: Partial<World> = {}): World => ({
  key: KEY,
  quota: { day: TODAY, calls: 20, dailyLimit: 20, symbols: [], isLimitUnconfirmed: true },
  answer: { dailyLimit: 100, requestsToday: 7, requestsDay: TODAY },
  events: [],
  ...overrides,
});

const depsFor = (world: World): DailyLimitDeps => ({
  now: () => NOW,
  readKey: async () => {
    world.events.push('read key');

    return world.key;
  },
  loadQuota: async () => world.quota,
  updateQuota: async (build) => {
    world.quota = build(world.quota);
  },
  fetchUserLimits: async (key) => {
    world.events.push('user'.concat(key === KEY ? '' : '!'));

    if (world.answer instanceof Error) {
      throw world.answer;
    }

    return world.answer;
  },
});

describe('confirmDailyLimit', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("stores the key's own limit and EODHD's count once the limit was unconfirmed", async () => {
    const world = makeWorld();

    await confirmDailyLimit(depsFor(world));

    expect(world.events).toEqual(['read key', 'user']);
    expect(world.quota).toEqual({ day: TODAY, calls: 7, dailyLimit: 100, symbols: [] });
  });

  it('keeps a limit a key save confirmed while the check was out', async () => {
    const world = makeWorld();
    const saved: QuoteQuota = { day: TODAY, calls: 2, dailyLimit: 50, symbols: [] };
    const deps = depsFor(world);

    await confirmDailyLimit({
      ...deps,
      fetchUserLimits: async (key) => {
        const limits = await deps.fetchUserLimits?.(key);

        world.quota = saved;

        return limits as UserLimits;
      },
    });

    expect(world.quota).toEqual(saved);
  });

  it.each([
    ['no stored quota', null],
    ['a confirmed limit', { day: TODAY, calls: 3, dailyLimit: 20, symbols: [] }],
  ])('reads neither the key nor EODHD with %s', async (_case, quota) => {
    const world = makeWorld({ quota });

    await confirmDailyLimit(depsFor(world));

    expect(world.events).toEqual([]);
    expect(world.quota).toEqual(quota);
  });

  it('asks EODHD nothing without a saved key', async () => {
    const world = makeWorld({ key: undefined });

    await confirmDailyLimit(depsFor(world));

    expect(world.events).toEqual(['read key']);
  });

  it('leaves the limit unconfirmed for the next try when EODHD does not answer', async () => {
    const world = makeWorld({ answer: new EodhdRateLimitError() });
    const before = world.quota;

    await confirmDailyLimit(depsFor(world));

    expect(world.quota).toEqual(before);
    expect(warn).toHaveBeenCalledWith('[daily-limit] EODHD limit check failed', {
      name: 'EodhdRateLimitError',
      code: undefined,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
  });
});
