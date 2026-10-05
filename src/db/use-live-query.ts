import { logFailure } from '@kiko/diagnostics';
import { useEffect, useMemo, useRef, useState } from 'react';
import either, { bifold, type Either, eitherSync, first, isLeft, isRight } from 'fnts/either';

import { rawDatabase } from './client';

type SQLQuery<T> = { toSQL(): { sql: string; params: unknown[] } } & PromiseLike<T[]>;

// Normalizes a thrown, unknown value into an `Error` for the `error?: Error`
// contract. It is applied through fnts's `first` (the Either left-channel map),
// not from a `catch` block — the try/catch is replaced by `either`/`eitherSync`.
const toError = (caught: unknown): Error =>
  caught instanceof Error ? caught : new Error(String(caught));

export const LIVE_QUERY_CACHE_LIMIT = 100;

// `reactiveExecute` is registered ONLY as a change trigger (see the doc
// comment below) — its own result rows are never read, since `runQuery`
// re-fetches the mapped, typed rows through `query` itself on every fire.
// Registering the REAL sql/params here would still make op-sqlite execute
// the whole query on its worker and build a native HostObject per row on
// every write, purely to hand the callback a result it then discards; a
// constant, argument-less trigger produces the same fire-on-write behavior
// for a fraction of the cost.
const REACTIVE_TRIGGER_QUERY = 'SELECT 1';
const REACTIVE_TRIGGER_ARGUMENTS: unknown[] = [];

// The last settled rows per full query key (sql + params), shared by every
// hook instance. A native-stack pop unmounts a screen, so reopening it is a
// fresh mount: a hit here lets a DISPLAY screen's mount render its data on the
// FIRST frame (isLoading false) while the query still re-runs and re-subscribes
// in the background. Every successful read writes it; only a query passed
// `{ cached: true }` reads it (kiko-architecture: display screens only).
// Bounded as an LRU (Map insertion order = recency).
const liveQueryCache = new Map<string, unknown[]>();

const readCache = (key: string): unknown[] | undefined => {
  const rows = liveQueryCache.get(key);

  if (rows !== undefined) {
    liveQueryCache.delete(key);
    liveQueryCache.set(key, rows);
  }

  return rows;
};

const writeCache = (key: string, rows: unknown[]): void => {
  liveQueryCache.delete(key);
  liveQueryCache.set(key, rows);

  if (liveQueryCache.size > LIVE_QUERY_CACHE_LIMIT) {
    const [leastRecentKey] = liveQueryCache.keys();

    liveQueryCache.delete(leastRecentKey);
  }
};

export const clearLiveQueryCache = (): void => {
  liveQueryCache.clear();
};

export type LiveQueryOptions = {
  /**
   * `true` lets a mount start from the last cached rows for this key — a
   * DISPLAY screen's readiness query only (kiko-architecture). Never for a
   * query that seeds a form or drives a write: a write made while no
   * subscriber was mounted leaves the entry one read old, and a one-shot seed
   * would latch it. Defaults to `false`.
   */
  cached?: boolean;
  /**
   * `true` keeps the subscription but DEFERS reads: a reactive fire only
   * marks the query dirty (no read, no state change). `data` keeps its last
   * rows. `isFresh` is false while dirty. Flipping to `false` runs ONE read
   * if dirty, none if clean. The mount read always runs. Not the same as
   * `enabled` (which unsubscribes and returns `[]`). Defaults to `false`.
   */
  paused?: boolean;
};

/**
 * Reactive read hook built on op-sqlite's `reactiveExecute` primitive
 * (Drizzle's own `useLiveQuery` only supports expo-sqlite).
 *
 * Pass a Drizzle query builder — never an already-`.execute()`d result,
 * that would defeat reactivity — plus the table names it depends on.
 * `reactiveExecute` is used only as a change trigger: its own rows are
 * raw, snake_case SQL columns with JSON columns left unparsed, so the
 * mapped, typed rows are obtained by awaiting `query` itself, once on
 * mount and again on every reactive fire.
 */
export function useLiveQuery<T>(
  query: SQLQuery<T>,
  tables: string[],
  /**
   * `false` skips the query AND the reactive subscription entirely — never a
   * request or read for data a disabled caller does not need
   * (kiko-architecture). `data` reads as `[]` and `isLoading` as `false`
   * (ready, not stuck) while disabled. Flipping back to `true` re-runs the
   * effect below and reads from scratch: `isLoading` is `true` and `data` is
   * `[]` until that read lands, never the rows read before it was disabled.
   * Defaults to `true` so every existing call site is unaffected.
   */
  enabled = true,
  { cached = false, paused = false }: LiveQueryOptions = {},
): { data: T[]; error?: Error; isLoading: boolean; isFresh: boolean } {
  const { sql, params } = query.toSQL();
  const paramsKey = JSON.stringify(params);
  const tablesKey = tables.join(',');
  const currentKey = `${sql}::${paramsKey}`;
  // Read once, on mount only, and only when opted in: a cache hit seeds both
  // the rows and the key they belong to, so the first render is already
  // "applied" (not loading).
  const [cachedOnMount] = useState(() =>
    cached ? (readCache(currentKey) as T[] | undefined) : undefined,
  );
  const [data, setData] = useState<T[]>(cachedOnMount ?? []);
  const [error, setError] = useState<Error | undefined>();
  // Keyed on tablesKey (a stable serialized primitive), not the `tables` array reference itself —
  // see the identical rationale on the effect below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(content-keyed subscription)
  const fireOn = useMemo(() => tables.map((table) => ({ table })), [tablesKey]);
  // Generation counter: `runQuery` runs on mount and again on every
  // reactive fire as independent, un-cancelled async calls. If two
  // overlapping calls settle out of order (e.g. two rapid writes), an
  // older call's result must not overwrite a newer one.
  const generation = useRef(0);
  // The generation a settled result was last ACCEPTED from (cached, and
  // applied while mounted), and the sql+paramsKey it was last APPLIED from —
  // NOT the newest generation that has merely STARTED (see the guard below,
  // where that distinction matters).
  const appliedGeneration = useRef(0);
  const appliedKey = useRef<string | undefined>(
    cachedOnMount === undefined ? undefined : currentKey,
  );
  // The key whose own read (never a cache hit) last applied successfully in
  // THIS mount. A display screen gates a write it derives from its rows (a
  // drag reorder) on `isFresh`, since cached rows can be one read old.
  const freshKey = useRef<string | undefined>(undefined);
  // Mirrors `paused` for the reactive callback below, which is defined once
  // inside the effect that does not re-run when `paused` toggles (see that
  // effect's own deps) and so cannot read a fresh prop value directly.
  const pausedRef = useRef(paused);
  // Set by the reactive callback when a fire is deferred while paused;
  // cleared the moment the deferred read actually runs, on unpause.
  const dirtyRef = useRef(false);
  // Assigned inside the main effect below so unpausing can call the SAME
  // runQuery closure that effect subscribed with, without depending on
  // `paused` itself and re-subscribing.
  const runQueryRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Refreshes `pausedRef` for the callback above, then — unpausing only —
  // runs the ONE deferred read, if any; a clean unpause (nothing fired while
  // paused) reads nothing.
  useEffect(() => {
    pausedRef.current = paused;

    if (!paused && dirtyRef.current) {
      dirtyRef.current = false;
      // runQuery folds a rejected read into a Left and never rejects.
      // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
      runQueryRef.current?.();
    }
  }, [paused]);
  // isLoading is derived, not stored: true whenever the CURRENT render's
  // sql+paramsKey has no applied result yet — true on first mount and true
  // again the instant the key changes (a dependent query re-keying off data
  // that only just arrived, e.g. holding-detail's
  // accountsRepo.byIdQuery(holding?.accountId)), false for the whole
  // duration of a reactive re-run against the SAME key (`appliedKey` does
  // not change until a NEWER generation for that key settles).
  // `false` while disabled — never "not ready" forever (kiko-architecture): a
  // caller gating a whole screen's readiness on this must see it flip, not
  // spin, for a query it deliberately never ran.
  const isLoading = enabled && appliedKey.current !== currentKey;
  const isFresh = !enabled || freshKey.current === currentKey;

  // sql/params/tables/query are re-derived every render from stable serialized primitives
  // (paramsKey/tablesKey) and a fireOn memoized on tablesKey; depending on their object/array
  // *references* instead would re-subscribe on every render whenever a caller passes an inline
  // literal (e.g. `useLiveQuery(q, ['accounts'])` in JSX) and — because the native callback can
  // fire synchronously — infinite-loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(content-keyed subscription)
  useEffect(() => {
    if (!enabled) {
      // A disabled query forgets what it read: the rows can be a day or one
      // import old by the time it is enabled again, and a key that did not
      // change in between (a parameterless read) would otherwise report them as
      // this read's own result. Re-enabling reads as loading with no rows until
      // the new read lands.
      appliedKey.current = undefined;
      freshKey.current = undefined;
      setData((rows) => (rows.length === 0 ? rows : []));

      return;
    }

    let alive = true;

    const myKey = currentKey;

    // A fresh subscription (a re-key while paused, or enabled flipping back
    // on) always runs its own mount read below — any dirty flag left over
    // from a torn-down subscription is now stale and must not also trigger
    // a second, redundant read on the next unpause.
    dirtyRef.current = false;

    // Apply one accepted, still-mounted result to this hook's state.
    const applySettled = (settled: Either<Error, T[]>): void => {
      const previousAppliedKey = appliedKey.current;

      appliedKey.current = myKey;

      if (isLeft(settled)) {
        const caughtError: Error = bifold(settled);

        // A rejected reactive query would otherwise fail silently — the screen
        // only sees `error` if it happens to read it — and every consumer's
        // failure passes through here. `sql` holds placeholders, never params.
        logFailure(`[useLiveQuery] query failed: ${sql}`, caughtError);
        setError(caughtError);

        // A re-keyed query's rejection must not keep showing the OLD key's
        // data as this key's result; a same-key rejection keeps it, matching
        // a same-key success.
        if (previousAppliedKey !== myKey) {
          setData([]);
        }

        return;
      }

      const rows: T[] = bifold(settled);

      // An in-flight read started before a LATER fire marked the query dirty
      // (while paused) does not reflect that later write — it must not mark
      // this key fresh, or `isFresh` would report the (stale) applied rows
      // as current while a deferred read is still owed.
      if (!dirtyRef.current) {
        freshKey.current = myKey;
      }
      setData(rows);
      setError(undefined);
    };

    const runQuery = async (): Promise<void> => {
      const myGeneration = ++generation.current;

      const result = await either<unknown, T[]>(async () => query);

      // Monotonic-generation guard: accept a finished result only if it is
      // NEWER than the last ACCEPTED one — not only if it is the newest
      // STARTED one. Comparing against the newest started generation instead
      // drops every in-order result under a dense write burst (a newer run
      // always starts before the previous one settles), leaving the screen on
      // the spinner until the burst stops; comparing against the newest
      // accepted one still drops a result that finishes out of order behind
      // one that already won — in state AND in the cache.
      if (myGeneration <= appliedGeneration.current) {
        return;
      }

      appliedGeneration.current = myGeneration;

      const settled = first(result, toError);

      // Cache BEFORE the unmount guard: a screen that unmounts before its own
      // read settles (a form's Save + goBack(), a quick pop) must still leave
      // the entry current. A rejected read is never cached.
      if (isRight(settled)) {
        writeCache(myKey, bifold(settled));
      }

      if (alive) {
        applySettled(settled);
      }
    };

    runQueryRef.current = runQuery;

    // runQuery folds a rejected read into a Left and never rejects.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
    runQuery();

    const subscription = first(
      eitherSync<unknown, () => void>(() =>
        rawDatabase.reactiveExecute({
          query: REACTIVE_TRIGGER_QUERY,
          arguments: REACTIVE_TRIGGER_ARGUMENTS,
          fireOn,
          callback: () => {
            if (pausedRef.current) {
              dirtyRef.current = true;
              freshKey.current = undefined;

              return;
            }

            // runQuery folds a rejected read into a Left and never rejects.
            // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
            runQuery();
          },
        }),
      ),
      toError,
    );

    if (isLeft(subscription)) {
      setError(bifold(subscription));

      return () => {
        alive = false;
        runQueryRef.current = undefined;
      };
    }

    const unsubscribe: () => void = bifold(subscription);

    return () => {
      alive = false;
      unsubscribe();
      runQueryRef.current = undefined;
    };
  }, [sql, paramsKey, fireOn, enabled]);

  return { data: enabled ? data : [], error, isLoading, isFresh };
}
