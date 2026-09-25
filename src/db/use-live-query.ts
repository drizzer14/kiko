import { useEffect, useMemo, useRef, useState } from 'react';
import either, { bifold, eitherSync, first, isLeft } from 'fnts/either';

import { rawDatabase } from './client';

type SQLQuery<T> = { toSQL(): { sql: string; params: unknown[] } } & PromiseLike<T[]>;

// Normalizes a thrown, unknown value into an `Error` for the `error?: Error`
// contract. It is applied through fnts's `first` (the Either left-channel map),
// not from a `catch` block — the try/catch is replaced by `either`/`eitherSync`.
const toError = (caught: unknown): Error =>
  caught instanceof Error ? caught : new Error(String(caught));

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
): { data: T[]; error?: Error; isLoading: boolean } {
  const [data, setData] = useState<T[]>([]);
  const [error, setError] = useState<Error | undefined>();
  const { sql, params } = query.toSQL();
  const paramsKey = JSON.stringify(params);
  const tablesKey = tables.join(',');
  const currentKey = `${sql}::${paramsKey}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(content-keyed subscription) keyed on tablesKey (a stable serialized primitive), not the `tables` array reference itself — see the identical rationale on the effect below.
  const fireOn = useMemo(() => tables.map((table) => ({ table })), [tablesKey]);
  // Generation counter: `runQuery` runs on mount and again on every
  // reactive fire as independent, un-cancelled async calls. If two
  // overlapping calls settle out of order (e.g. two rapid writes), an
  // older call's result must not overwrite a newer one.
  const generation = useRef(0);
  // The generation and sql+paramsKey a settled result was last APPLIED
  // from — NOT the newest generation that has merely STARTED (see the guard
  // below, where that distinction matters).
  const appliedGeneration = useRef(0);
  const appliedKey = useRef<string | undefined>(undefined);
  // isLoading is derived, not stored: true whenever the CURRENT render's
  // sql+paramsKey has no applied result yet — true on first mount and true
  // again the instant the key changes (a dependent query re-keying off data
  // that only just arrived, e.g. holding-detail's
  // accountsRepo.byIdQuery(holding?.accountId)), false for the whole
  // duration of a reactive re-run against the SAME key (`appliedKey` does
  // not change until a NEWER generation for that key settles).
  const isLoading = appliedKey.current !== currentKey;

  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(content-keyed subscription) sql/params/tables/query are re-derived every render from stable serialized primitives (paramsKey/tablesKey) and a fireOn memoized on tablesKey; depending on their object/array *references* instead would re-subscribe on every render whenever a caller passes an inline literal (e.g. `useLiveQuery(q, ['accounts'])` in JSX) and — because the native callback can fire synchronously — infinite-loop.
  useEffect(() => {
    let alive = true;

    const myKey = currentKey;

    const runQuery = async (): Promise<void> => {
      const myGeneration = ++generation.current;

      const result = await either<unknown, T[]>(async () => query);

      // Unmount guard, and a monotonic-generation guard: apply a finished
      // result only if it is NEWER than the last APPLIED one — not only if
      // it is the newest STARTED one. Comparing against the newest started
      // generation instead drops every in-order result under a dense write
      // burst (a newer run always starts before the previous one settles),
      // leaving the screen on the spinner until the burst stops; comparing
      // against the newest APPLIED one still drops a result that finishes
      // out of order behind one that already won.
      if (!alive || myGeneration <= appliedGeneration.current) {
        return;
      }

      const previousAppliedKey = appliedKey.current;

      appliedGeneration.current = myGeneration;
      appliedKey.current = myKey;

      const settled = first(result, toError);

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

      setData(bifold(settled));
      setError(undefined);
    };

    runQuery();

    const subscription = first(
      eitherSync<unknown, () => void>(() =>
        rawDatabase.reactiveExecute({
          query: sql,
          arguments: params,
          fireOn,
          callback: () => {
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
  }, [sql, paramsKey, fireOn]);

  return { data, error, isLoading };
}
