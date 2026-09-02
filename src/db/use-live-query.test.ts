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
});
