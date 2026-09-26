import { act, renderHook } from '@testing-library/react-native';

import { LIVE_QUERY_CACHE_LIMIT, clearLiveQueryCache, useLiveQuery } from './use-live-query';

const mockUnsubscribe = jest.fn();
const mockReactiveExecute = jest.fn();
// jest's mock-hoisting guard only allows module-factory closures to
// reference variables prefixed with `mock` (case-insensitive) — see
// babel-plugin-jest-hoist. A plain holder object (not a top-level
// `let`) so the factory can stash the registered callback for tests to
// fire manually, simulating a reactive change notification.
const mockReactiveCallback: { current?: (response: { rows: unknown[] }) => void } = {};

jest.mock('./client', () => ({
  rawDatabase: {
    reactiveExecute: (config: { callback: (r: { rows: unknown[] }) => void }) => {
      mockReactiveExecute(config);
      mockReactiveCallback.current = config.callback;

      return mockUnsubscribe;
    },
  },
}));

const mockRows: { current: Array<{ id: string }> } = { current: [{ id: 'a' }] };

type Resolve = (rows: unknown[]) => void;
type Reject = (reason: unknown) => void;

// A minimal Drizzle-query double: exposes `toSQL()` like a real query
// builder, and is itself awaitable (thenable) — `await query` is how
// the hook must get Drizzle-mapped (typed, camelCase, JSON-parsed)
// rows, as opposed to reactiveExecute's raw snake_case SQL rows.
// `settle` runs on EVERY `await query` (the mount read and each reactive
// re-run) and decides how that one read settles.
const queryDouble = (params: unknown[], settle: (resolve: Resolve, reject: Reject) => void) => ({
  toSQL: () => ({ sql: 'SELECT * FROM accounts WHERE id = ?', params }),
  // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) this doubles as a Drizzle query builder, which is itself awaitable — the hook's contract requires `query` to be a thenable, so this test double must expose `then`.
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return new Promise<unknown[]>(settle).then(onfulfilled, onrejected);
  },
});

// Every read resolves with whatever `mockRows` holds at that moment.
const fakeQuery = queryDouble([], (resolve) => resolve(mockRows.current));

// A query whose reads never settle until the test says so: `resolvers[n]`
// settles the n-th read (0 = mount, 1+ = reactive re-runs), so a test can
// observe a render before any read lands, or settle reads out of order.
const pendingQuery = (params: unknown[] = []) => {
  const resolvers: Resolve[] = [];
  const query = queryDouble(params, (resolve) => {
    resolvers.push(resolve);
  });

  return { query, resolvers };
};

const settledQuery = (params: unknown[], rows: unknown[]) =>
  queryDouble(params, (resolve) => resolve(rows));

const rejectingQuery = (params: unknown[] = []) =>
  queryDouble(params, (_resolve, reject) => reject(new Error('boom')));

// A reactive change notification, flushed far enough for the re-run it
// starts to register its own read.
const fireReactive = async (): Promise<void> => {
  await act(async () => {
    mockReactiveCallback.current?.({ rows: [] });
    await Promise.resolve();
  });
};

const settle = async (resolve: Resolve, rows: unknown[]): Promise<void> => {
  await act(async () => {
    resolve(rows);
  });
};

const silenceWarnings = () => jest.spyOn(console, 'warn').mockImplementation(() => {});

describe('useLiveQuery', () => {
  beforeEach(() => {
    mockRows.current = [{ id: 'a' }];
    mockReactiveCallback.current = undefined;
    clearLiveQueryCache();
  });

  it('runs the Drizzle query for mapped rows on mount', async () => {
    const { result } = await renderHook(() => useLiveQuery(fakeQuery, ['accounts']));
    expect(mockReactiveExecute).toHaveBeenCalled();
    expect(result.current.data).toEqual([{ id: 'a' }]);
  });

  it('re-runs the Drizzle query (ignoring reactiveExecute raw rows) on a reactive fire', async () => {
    const { result } = await renderHook(() => useLiveQuery(fakeQuery, ['accounts']));
    mockRows.current = [{ id: 'b' }];

    await act(async () => {
      mockReactiveCallback.current?.({ rows: [{ id: 'raw-should-be-ignored' }] });
    });

    expect(result.current.data).toEqual([{ id: 'b' }]);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = await renderHook(() => useLiveQuery(fakeQuery, ['accounts']));
    await unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('keeps the latest initiated query when an earlier fire resolves after a later one', async () => {
    const { query, resolvers } = pendingQuery();

    const { result } = await renderHook(() => useLiveQuery(query, ['accounts']));
    await settle(resolvers[0], [{ id: 'initial' }]);
    expect(result.current.data).toEqual([{ id: 'initial' }]);

    // Fire #1 initiates an older runQuery call (registers resolvers[1]);
    // fire #2 a newer one (registers resolvers[2]).
    await fireReactive();
    await fireReactive();

    // Resolve out of order: the newer call settles first, then the older,
    // stale call settles after it. The stale result must not win.
    await act(async () => {
      resolvers[2]([{ id: 'newest' }]);
      resolvers[1]([{ id: 'stale' }]);
    });

    expect(result.current.data).toEqual([{ id: 'newest' }]);
  });

  it('keeps applying a finished result even when a newer run has already started but not settled (dense write burst)', async () => {
    // Simulates a burst of writes where each fire starts a new runQuery
    // before the previous one has finished: the generation guard must apply
    // an in-order result the moment it settles rather than dropping it just
    // because a newer generation has since STARTED (only a newer generation
    // that has already been APPLIED should win).
    const { query, resolvers } = pendingQuery();

    const { result } = await renderHook(() => useLiveQuery(query, ['accounts']));
    await settle(resolvers[0], [{ id: 'initial' }]);

    // Fire #1 starts generation 2 (registers resolvers[1]); fire #2 starts
    // generation 3 (registers resolvers[2]) BEFORE generation 2 has settled.
    await fireReactive();
    await fireReactive();

    // Generation 2 settles first, even though generation 3 has already
    // started — it must still apply, since nothing newer has been APPLIED yet.
    await settle(resolvers[1], [{ id: 'gen-2' }]);
    expect(result.current.data).toEqual([{ id: 'gen-2' }]);

    // Generation 3 settles later and applies on top of it.
    await settle(resolvers[2], [{ id: 'gen-3' }]);
    expect(result.current.data).toEqual([{ id: 'gen-3' }]);
  });

  it('reports isLoading until the first query settles', async () => {
    const { query, resolvers } = pendingQuery();

    const { result } = await renderHook(() => useLiveQuery(query, ['accounts']));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);

    await settle(resolvers[0], [{ id: 'a' }]);

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'a' }]);
  });

  it('clears isLoading when the first query fails', async () => {
    const warnSpy = silenceWarnings();
    const { result } = await renderHook(() => useLiveQuery(rejectingQuery(), ['accounts']));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe('boom');
    warnSpy.mockRestore();
  });

  it('flips isLoading back to true when the query key changes, until the new key settles', async () => {
    const resolveById = new Map<string, Resolve>();
    const queryFor = (id: string) =>
      queryDouble([id], (resolve) => {
        resolveById.set(id, resolve);
      });

    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useLiveQuery(queryFor(id), ['accounts']),
      { initialProps: { id: 'a' } },
    );

    expect(result.current.isLoading).toBe(true);

    await settle(resolveById.get('a') as Resolve, [{ id: 'a' }]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'a' }]);

    // The key changes (a dependent query re-keying once its own upstream data
    // arrives, e.g. holding-detail's accountsRepo.byIdQuery(holding?.accountId)):
    // isLoading must report true again until the NEW key's own result lands —
    // a stale render must never keep showing the OLD key's data as "loaded".
    await rerender({ id: 'b' });
    expect(result.current.isLoading).toBe(true);

    await settle(resolveById.get('b') as Resolve, [{ id: 'b' }]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'b' }]);
  });

  it('keeps isLoading false across a same-key reactive re-run (never flips back to true)', async () => {
    const { result } = await renderHook(() => useLiveQuery(fakeQuery, ['accounts']));
    expect(result.current.isLoading).toBe(false);

    mockRows.current = [{ id: 'b' }];
    await fireReactive();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'b' }]);
  });

  it('clears data to [] when a re-keyed query rejects (a same-key rejection keeps the previous data)', async () => {
    const { query: queryA, resolvers } = pendingQuery(['a']);
    let rejectSecond!: Reject;
    const queryB = queryDouble(['b'], (_resolve, reject) => {
      rejectSecond = reject;
    });

    const warnSpy = silenceWarnings();
    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useLiveQuery(id === 'a' ? queryA : queryB, ['accounts']),
      { initialProps: { id: 'a' } },
    );

    await settle(resolvers[0], [{ id: 'a' }]);
    expect(result.current.data).toEqual([{ id: 'a' }]);

    await rerender({ id: 'b' });

    await act(async () => {
      rejectSecond(new Error('boom'));
    });

    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe('boom');
    warnSpy.mockRestore();
  });

  it('keeps the previous data when a SAME-key reactive re-run rejects, unlike a re-keyed rejection', async () => {
    let resolveFirst!: Resolve;
    let rejectSecond!: Reject;
    let callCount = 0;
    const sameKeyQuery = queryDouble([], (resolve, reject) => {
      callCount += 1;
      if (callCount === 1) {
        resolveFirst = resolve;
      } else {
        rejectSecond = reject;
      }
    });

    const warnSpy = silenceWarnings();
    const { result } = await renderHook(() => useLiveQuery(sameKeyQuery, ['accounts']));

    await settle(resolveFirst, [{ id: 'a' }]);
    expect(result.current.data).toEqual([{ id: 'a' }]);

    await fireReactive();
    await act(async () => {
      rejectSecond(new Error('boom'));
    });

    expect(result.current.data).toEqual([{ id: 'a' }]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe('boom');
    warnSpy.mockRestore();
  });

  it('logs a rejected query instead of failing silently', async () => {
    const warnSpy = silenceWarnings();

    await renderHook(() => useLiveQuery(rejectingQuery(), ['accounts']));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[useLiveQuery]'),
      expect.anything(),
      expect.objectContaining({ message: 'boom' }),
    );
    warnSpy.mockRestore();
  });
});

// kiko-architecture: no request or query for data the user does not have. A
// caller (e.g. usePriceBook) can disable the query entirely — never a
// per-holding loop, and never a screen stuck "not ready" forever.
describe('useLiveQuery — the enabled argument', () => {
  beforeEach(() => {
    mockRows.current = [{ id: 'a' }];
    mockReactiveCallback.current = undefined;
    mockReactiveExecute.mockClear();
    clearLiveQueryCache();
  });

  const renderToggled = (initialEnabled: boolean) =>
    renderHook(
      ({ enabled }: { enabled: boolean }) => useLiveQuery(fakeQuery, ['accounts'], enabled),
      { initialProps: { enabled: initialEnabled } },
    );

  it('never runs the query and never subscribes while disabled', async () => {
    const { result } = await renderHook(() => useLiveQuery(fakeQuery, ['accounts'], false));

    expect(mockReactiveExecute).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
  });

  it('reports ready (isLoading=false), never stuck loading, while disabled', async () => {
    const { result } = await renderHook(() => useLiveQuery(fakeQuery, ['accounts'], false));

    expect(result.current.isLoading).toBe(false);
  });

  it('starts the query once enabled flips true, and reports the real data', async () => {
    const { result, rerender } = await renderToggled(false);

    expect(mockReactiveExecute).not.toHaveBeenCalled();

    await act(async () => {
      await rerender({ enabled: true });
    });

    expect(mockReactiveExecute).toHaveBeenCalled();
    expect(result.current.data).toEqual([{ id: 'a' }]);
  });

  it('defaults to enabled when the argument is omitted (backward compatible)', async () => {
    const { result } = await renderHook(() => useLiveQuery(fakeQuery, ['accounts']));

    expect(mockReactiveExecute).toHaveBeenCalled();
    expect(result.current.data).toEqual([{ id: 'a' }]);
  });

  it('drops its data and unsubscribes once enabled flips true -> false (matches the doc, no stale rows)', async () => {
    const { result, rerender } = await renderToggled(true);

    expect(result.current.data).toEqual([{ id: 'a' }]);
    mockUnsubscribe.mockClear();

    await act(async () => {
      await rerender({ enabled: false });
    });

    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});

// kiko-architecture: a DISPLAY screen reopened within seconds shows its data on
// the first frame. A native-stack pop unmounts the screen, so every reopen is a
// fresh mount — the last settled rows per query key are served from a
// module-level cache (to a query that opted in) while the query still re-runs
// in the background.
describe('useLiveQuery — the live-query cache', () => {
  // The display-screen opt-in (`{ cached: true }`); every other query never
  // reads the cache.
  const CACHED = { cached: true };

  // Mounts a query once, lets its read settle, and unmounts — leaving its
  // rows in the cache the way a popped screen does.
  const visitOnce = async (query: ReturnType<typeof queryDouble>): Promise<void> => {
    const visit = await renderHook(() => useLiveQuery(query, ['accounts']));
    await visit.unmount();
  };

  const mountCached = (query: ReturnType<typeof queryDouble>) =>
    renderHook(() => useLiveQuery(query, ['accounts'], true, CACHED));

  beforeEach(() => {
    mockReactiveCallback.current = undefined;
    mockReactiveExecute.mockClear();
    clearLiveQueryCache();
  });

  it('serves a remount of the same key from the cache on the first render, and still re-runs the query', async () => {
    await visitOnce(settledQuery(['a'], [{ id: 'cached' }]));
    mockReactiveExecute.mockClear();

    const { query, resolvers } = pendingQuery(['a']);
    const { result } = await mountCached(query);

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'cached' }]);
    expect(mockReactiveExecute).toHaveBeenCalled();
    expect(resolvers).toHaveLength(1);

    await settle(resolvers[0], [{ id: 'fresh' }]);

    expect(result.current.data).toEqual([{ id: 'fresh' }]);
  });

  it('updates the cached rows on a reactive change after a remount', async () => {
    await visitOnce(settledQuery(['a'], [{ id: 'cached' }]));

    const second = await renderHook(() =>
      useLiveQuery(settledQuery(['a'], [{ id: 'changed' }]), ['accounts']),
    );
    await fireReactive();
    expect(second.result.current.data).toEqual([{ id: 'changed' }]);
    await second.unmount();

    const { result } = await mountCached(pendingQuery(['a']).query);

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'changed' }]);
  });

  it('never shares a cache entry between different params of the same sql', async () => {
    await visitOnce(settledQuery(['a'], [{ id: 'a' }]));

    const { result } = await mountCached(pendingQuery(['b']).query);

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);
  });

  it('never caches a rejected read', async () => {
    const warnSpy = silenceWarnings();
    await visitOnce(rejectingQuery(['a']));

    const { result } = await mountCached(pendingQuery(['a']).query);

    expect(result.current.isLoading).toBe(true);
    warnSpy.mockRestore();
  });

  it('evicts the least recently used key once the cache holds more than its limit', async () => {
    for (let index = 0; index <= LIVE_QUERY_CACHE_LIMIT; index += 1) {
      await visitOnce(settledQuery([String(index)], [{ id: String(index) }]));
    }

    const oldestHook = await mountCached(pendingQuery(['0']).query);
    expect(oldestHook.result.current.isLoading).toBe(true);
    await oldestHook.unmount();

    const newestHook = await mountCached(pendingQuery([String(LIVE_QUERY_CACHE_LIMIT)]).query);
    expect(newestHook.result.current.isLoading).toBe(false);
  });

  // kiko-architecture: the cache is for display screens only. A query that
  // seeds a one-shot form (or drives a write) must never start from a cached
  // row: a write made while that form was unmounted (a lot added, a
  // contribution saved) never refreshed the entry, so a latched seed would
  // save the stale row back over it.
  it('never reads the cache for a query that did not opt in, so a form seed waits for its fresh read', async () => {
    await visitOnce(settledQuery(['a'], [{ id: 'stale' }]));

    const { query, resolvers } = pendingQuery(['a']);
    const { result } = await renderHook(() => useLiveQuery(query, ['accounts']));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);

    await settle(resolvers[0], [{ id: 'fresh' }]);

    expect(result.current.data).toEqual([{ id: 'fresh' }]);
  });

  it('serves a cached display mount the cached rows first, then the fresh row written elsewhere', async () => {
    await visitOnce(settledQuery(['a'], [{ id: 'before-write' }]));

    const { query, resolvers } = pendingQuery(['a']);
    const { result } = await mountCached(query);

    expect(result.current.data).toEqual([{ id: 'before-write' }]);
    expect(result.current.isFresh).toBe(false);

    await settle(resolvers[0], [{ id: 'after-write' }]);

    expect(result.current.data).toEqual([{ id: 'after-write' }]);
    expect(result.current.isFresh).toBe(true);
  });

  it('reports isFresh only once the first read for the current key has applied, with no cache hit', async () => {
    const { query, resolvers } = pendingQuery(['a']);
    const { result } = await mountCached(query);

    expect(result.current.isFresh).toBe(false);

    await settle(resolvers[0], [{ id: 'a' }]);

    expect(result.current.isFresh).toBe(true);
  });

  it('caches a read that settles after its screen already unmounted (a Save + goBack race)', async () => {
    const leaving = pendingQuery(['a']);
    const visit = await renderHook(() => useLiveQuery(leaving.query, ['accounts']));
    await visit.unmount();

    await settle(leaving.resolvers[0], [{ id: 'settled-after-unmount' }]);

    const { result } = await mountCached(pendingQuery(['a']).query);

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'settled-after-unmount' }]);
  });

  it('never lets an older read that settles after unmount overwrite a newer one in the cache', async () => {
    const leaving = pendingQuery(['a']);
    const visit = await renderHook(() => useLiveQuery(leaving.query, ['accounts']));
    await fireReactive();
    await visit.unmount();

    await act(async () => {
      leaving.resolvers[1]([{ id: 'newer' }]);
      leaving.resolvers[0]([{ id: 'older' }]);
    });

    const { result } = await mountCached(pendingQuery(['a']).query);

    expect(result.current.data).toEqual([{ id: 'newer' }]);
  });
});
