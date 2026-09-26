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
   * (ready, not stuck) while disabled; flipping back to `true` re-runs the
   * effect below and starts the real query. Defaults to `true` so every
   * existing call site is unaffected.
   */
  enabled = true,
  { cached = false }: LiveQueryOptions = {},
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(content-keyed subscription) keyed on tablesKey (a stable serialized primitive), not the `tables` array reference itself — see the identical rationale on the effect below.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(content-keyed subscription) sql/params/tables/query are re-derived every render from stable serialized primitives (paramsKey/tablesKey) and a fireOn memoized on tablesKey; depending on their object/array *references* instead would re-subscribe on every render whenever a caller passes an inline literal (e.g. `useLiveQuery(q, ['accounts'])` in JSX) and — because the native callback can fire synchronously — infinite-loop.
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let alive = true;

    const myKey = currentKey;

    // Apply one accepted, still-mounted result to this hook's state.
    const applySettled = (settled: Either<Error, T[]>): void => {
      const previousAppliedKey = appliedKey.current;

      appliedKey.current = myKey;

      if (isLeft(settled)) {
        const caughtError: Error = bifold(settled);

        // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a rejected reactive query would otherwise fail silently — the screen only sees `error` if it happens to read it — so log the failing query's SQL and the error itself here, the one place every consumer's failure passes through.
        console.warn('[useLiveQuery] query failed', sql, caughtError);
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

      freshKey.current = myKey;
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

    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) runQuery folds a rejected read into a Left and never rejects
    runQuery();

    const subscription = first(
      eitherSync<unknown, () => void>(() =>
        rawDatabase.reactiveExecute({
          query: sql,
          arguments: params,
          fireOn,
          callback: () => {
            // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) runQuery folds a rejected read into a Left and never rejects
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
      };
    }

    const unsubscribe: () => void = bifold(subscription);

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [sql, paramsKey, fireOn, enabled]);

  return { data: enabled ? data : [], error, isLoading, isFresh };
}
