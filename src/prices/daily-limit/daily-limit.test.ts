import {
  EodhdAuthError,
  EodhdQuotaError,
  type UserLimits,
  EodhdNetworkError,
  EodhdRateLimitError,
} from '../eodhd';
import type { QuoteQuota } from '../quote-quota';

import { recheckRejectedKey, confirmDailyLimit, type DailyLimitDeps } from './daily-limit';

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

  it('never stores the limit of a key replaced while the check was out', async () => {
    const world = makeWorld();
    const secondKey: QuoteQuota = {
      day: TODAY,
      calls: 0,
      dailyLimit: 20,
      symbols: [],
      isLimitUnconfirmed: true,
      keyGeneration: 1,
    };
    const deps = depsFor(world);

    await confirmDailyLimit({
      ...deps,
      fetchUserLimits: async (key) => {
        const limits = await deps.fetchUserLimits?.(key);

        world.quota = secondKey;

        return limits as UserLimits;
      },
    });

    expect(world.quota).toEqual(secondKey);
  });

  it('marks the key rejected when EODHD rejects it', async () => {
    const world = makeWorld({ answer: new EodhdAuthError() });

    await confirmDailyLimit(depsFor(world));

    expect(world.quota).toMatchObject({ isKeyRejected: true, isLimitUnconfirmed: true });
  });

  it('never marks a key replaced while the check was out as rejected', async () => {
    const world = makeWorld({ answer: new EodhdAuthError() });
    const deps = depsFor(world);

    await confirmDailyLimit({
      ...deps,
      fetchUserLimits: async () => {
        world.quota = { ...(world.quota as QuoteQuota), keyGeneration: 1 };

        throw new EodhdAuthError();
      },
    });

    expect(world.quota).not.toHaveProperty('isKeyRejected');
  });
});

describe('recheckRejectedKey', () => {
  const rejected: QuoteQuota = {
    day: TODAY,
    calls: 4,
    dailyLimit: 20,
    symbols: ['AAPL.US'],
    isKeyRejected: true,
    keyGeneration: 2,
  };

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("clears the rejection and stores the key's limit and count when EODHD accepts the key", async () => {
    const world = makeWorld({ quota: rejected });

    await expect(recheckRejectedKey(depsFor(world))).resolves.toEqual({ isAccepted: true });
    expect(world.events).toEqual(['read key', 'user']);
    expect(world.quota).toEqual({
      day: TODAY,
      calls: 7,
      dailyLimit: 100,
      symbols: ['AAPL.US'],
      keyGeneration: 2,
    });
  });

  it('clears the rejection and marks the day used up when EODHD answers with its daily limit', async () => {
    const world = makeWorld({ quota: rejected, answer: new EodhdQuotaError() });
    const { isKeyRejected: _wasRejected, ...accepted } = rejected;

    await expect(recheckRejectedKey(depsFor(world))).resolves.toEqual({ isAccepted: true });
    expect(world.quota).toStrictEqual({ ...accepted, calls: 20, isLimitUnconfirmed: true });
  });

  it.each([
    ['still rejects the key', new EodhdAuthError()],
    ['cannot be reached', new EodhdNetworkError()],
  ])('keeps the rejection and returns the error when EODHD %s', async (_case, error) => {
    const world = makeWorld({ quota: rejected, answer: error });

    await expect(recheckRejectedKey(depsFor(world))).resolves.toEqual({
      isAccepted: false,
      error,
    });
    expect(world.quota).toEqual(rejected);
  });

  it('keeps the rejection a newer key stored while the check was out', async () => {
    const world = makeWorld({ quota: rejected });
    const newer: QuoteQuota = { ...rejected, keyGeneration: 3 };
    const deps = depsFor(world);

    await recheckRejectedKey({
      ...deps,
      fetchUserLimits: async (key) => {
        const limits = await deps.fetchUserLimits?.(key);

        world.quota = newer;

        return limits as UserLimits;
      },
    });

    expect(world.quota).toEqual(newer);
  });

  it('asks EODHD nothing while the key is not rejected', async () => {
    const world = makeWorld();

    await expect(recheckRejectedKey(depsFor(world))).resolves.toEqual({ isAccepted: true });
    expect(world.events).toEqual([]);
  });
});
