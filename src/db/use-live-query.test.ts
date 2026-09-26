import { act, renderHook } from '@testing-library/react-native';

import { useLiveQuery } from './use-live-query';

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

// A minimal Drizzle-query double: exposes `toSQL()` like a real query
// builder, and is itself awaitable (thenable) — `await query` is how
// the hook must get Drizzle-mapped (typed, camelCase, JSON-parsed)
// rows, as opposed to reactiveExecute's raw snake_case SQL rows.
const fakeQuery = {
  toSQL: () => ({ sql: 'SELECT * FROM accounts', params: [] as unknown[] }),
  // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) this doubles as a Drizzle query builder, which is itself awaitable — the hook's contract requires `query` to be a thenable, so this test double must expose `then`.
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(mockRows.current).then(onfulfilled, onrejected);
  },
};

describe('useLiveQuery', () => {
  beforeEach(() => {
    mockRows.current = [{ id: 'a' }];
    mockReactiveCallback.current = undefined;
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
    // A controllable thenable: each `await query` registers a resolver in
    // `resolvers` (in call order) instead of resolving immediately, so the
    // test can resolve two overlapping runQuery calls out of order.
    const resolvers: Array<(rows: Array<{ id: string }>) => void> = [];
    const controllableQuery = {
      toSQL: () => ({ sql: 'SELECT * FROM accounts', params: [] as unknown[] }),
      // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) same rationale as `fakeQuery` above — must double as an awaitable Drizzle query builder.
      then<TResult1 = Array<{ id: string }>, TResult2 = never>(
        onfulfilled?: ((value: Array<{ id: string }>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return new Promise<Array<{ id: string }>>((resolve) => {
          resolvers.push(resolve);
        }).then(onfulfilled, onrejected);
      },
    };

    const { result } = await renderHook(() => useLiveQuery(controllableQuery, ['accounts']));
    await act(async () => {
      resolvers[0]([{ id: 'initial' }]);
    });
    expect(result.current.data).toEqual([{ id: 'initial' }]);

    // Fire #1 initiates an older runQuery call (registers resolvers[1]).
    await act(async () => {
      mockReactiveCallback.current?.({ rows: [] });
      await Promise.resolve();
    });

    // Fire #2 initiates a newer runQuery call (registers resolvers[2]).
    await act(async () => {
      mockReactiveCallback.current?.({ rows: [] });
      await Promise.resolve();
    });

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
    const resolvers: Array<(rows: Array<{ id: string }>) => void> = [];
    const burstQuery = {
      toSQL: () => ({ sql: 'SELECT * FROM accounts', params: [] as unknown[] }),
      // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) same rationale as `fakeQuery` above.
      then<TResult1 = Array<{ id: string }>, TResult2 = never>(
        onfulfilled?: ((value: Array<{ id: string }>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return new Promise<Array<{ id: string }>>((resolve) => {
          resolvers.push(resolve);
        }).then(onfulfilled, onrejected);
      },
    };

    const { result } = await renderHook(() => useLiveQuery(burstQuery, ['accounts']));
    await act(async () => {
      resolvers[0]([{ id: 'initial' }]);
    });

    // Fire #1 starts generation 2 (registers resolvers[1]).
    await act(async () => {
      mockReactiveCallback.current?.({ rows: [] });
      await Promise.resolve();
    });
    // Fire #2 starts generation 3 (registers resolvers[2]) BEFORE generation 2
    // has settled.
    await act(async () => {
      mockReactiveCallback.current?.({ rows: [] });
      await Promise.resolve();
    });

    // Generation 2 settles first, even though generation 3 has already
    // started — it must still apply, since nothing newer has been APPLIED yet.
    await act(async () => {
      resolvers[1]([{ id: 'gen-2' }]);
    });
    expect(result.current.data).toEqual([{ id: 'gen-2' }]);

    // Generation 3 settles later and applies on top of it.
    await act(async () => {
      resolvers[2]([{ id: 'gen-3' }]);
    });
    expect(result.current.data).toEqual([{ id: 'gen-3' }]);
  });

  it('reports isLoading until the first query settles', async () => {
    let resolveRows!: (rows: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => {
      resolveRows = resolve;
    });
    const slowQuery = {
      toSQL: fakeQuery.toSQL,
      // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) same rationale as `fakeQuery` — the hook awaits the query builder itself.
      then<TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return pending.then(onfulfilled, onrejected);
      },
    };

    const { result } = await renderHook(() => useLiveQuery(slowQuery, ['accounts']));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);

    await act(async () => {
      resolveRows([{ id: 'a' }]);
      await pending;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'a' }]);
  });

  it('clears isLoading when the first query fails', async () => {
    const failingQuery = {
      toSQL: fakeQuery.toSQL,
      // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) same rationale as `fakeQuery`.
      then<TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.reject(new Error('boom')).then(onfulfilled, onrejected);
      },
    };

    const { result } = await renderHook(() => useLiveQuery(failingQuery, ['accounts']));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe('boom');
  });

  it('flips isLoading back to true when the query key changes, until the new key settles', async () => {
    let resolveFirst!: (rows: unknown[]) => void;
    let resolveSecond!: (rows: unknown[]) => void;
    const queryFor = (id: string, resolve: (settle: (rows: unknown[]) => void) => void) => ({
      toSQL: () => ({ sql: 'SELECT * FROM accounts WHERE id = ?', params: [id] }),
      // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) same rationale as `fakeQuery` above.
      then<TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return new Promise<unknown[]>((settle) => resolve(settle)).then(onfulfilled, onrejected);
      },
    });

    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) =>
        useLiveQuery(
          queryFor(id, (settle) => {
            if (id === 'a') {
              resolveFirst = settle;
            } else {
              resolveSecond = settle;
            }
          }),
          ['accounts'],
        ),
      { initialProps: { id: 'a' } },
    );

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveFirst([{ id: 'a' }]);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'a' }]);

    // The key changes (a dependent query re-keying once its own upstream data
    // arrives, e.g. holding-detail's accountsRepo.byIdQuery(holding?.accountId)):
    // isLoading must report true again until the NEW key's own result lands —
    // a stale render must never keep showing the OLD key's data as "loaded".
    await rerender({ id: 'b' });
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveSecond([{ id: 'b' }]);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'b' }]);
  });

  it('keeps isLoading false across a same-key reactive re-run (never flips back to true)', async () => {
    const { result } = await renderHook(() => useLiveQuery(fakeQuery, ['accounts']));
    expect(result.current.isLoading).toBe(false);

    mockRows.current = [{ id: 'b' }];
    await act(async () => {
      mockReactiveCallback.current?.({ rows: [] });
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'b' }]);
  });

  it('clears data to [] when a re-keyed query rejects (a same-key rejection keeps the previous data)', async () => {
    let resolveFirst!: (rows: unknown[]) => void;
    let rejectSecond!: (reason: unknown) => void;
    const queryFor = (id: string) => ({
      toSQL: () => ({ sql: 'SELECT * FROM accounts WHERE id = ?', params: [id] }),
      // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) same rationale as `fakeQuery` above.
      then<TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return new Promise<unknown[]>((settle, reject) => {
          if (id === 'a') {
            resolveFirst = settle;
          } else {
            rejectSecond = reject;
          }
        }).then(onfulfilled, onrejected);
      },
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useLiveQuery(queryFor(id), ['accounts']),
      { initialProps: { id: 'a' } },
    );

    await act(async () => {
      resolveFirst([{ id: 'a' }]);
    });
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
    let resolveFirst!: (rows: unknown[]) => void;
    let rejectSecond!: (reason: unknown) => void;
    let callCount = 0;
    const sameKeyQuery = {
      toSQL: () => ({ sql: 'SELECT * FROM accounts', params: [] as unknown[] }),
      // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) same rationale as `fakeQuery` above.
      then<TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        callCount += 1;
        const isFirstCall = callCount === 1;

        return new Promise<unknown[]>((settle, reject) => {
          if (isFirstCall) {
            resolveFirst = settle;
          } else {
            rejectSecond = reject;
          }
        }).then(onfulfilled, onrejected);
      },
    };

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = await renderHook(() => useLiveQuery(sameKeyQuery, ['accounts']));

    await act(async () => {
      resolveFirst([{ id: 'a' }]);
    });
    expect(result.current.data).toEqual([{ id: 'a' }]);

    await act(async () => {
      mockReactiveCallback.current?.({ rows: [] });
    });
    await act(async () => {
      rejectSecond(new Error('boom'));
    });

    expect(result.current.data).toEqual([{ id: 'a' }]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe('boom');
    warnSpy.mockRestore();
  });

  it('logs a rejected query instead of failing silently', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const failingQuery = {
      toSQL: fakeQuery.toSQL,
      // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) same rationale as `fakeQuery`.
      then<TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.reject(new Error('boom')).then(onfulfilled, onrejected);
      },
    };

    await renderHook(() => useLiveQuery(failingQuery, ['accounts']));

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
  });

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
    const { result, rerender } = await renderHook(
      ({ enabled }: { enabled: boolean }) => useLiveQuery(fakeQuery, ['accounts'], enabled),
      { initialProps: { enabled: false } },
    );

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
});
