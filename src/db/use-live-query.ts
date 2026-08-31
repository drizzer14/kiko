import either, { bifold, eitherSync, first, isLeft } from 'fnts/either';
import { useEffect, useMemo, useRef, useState } from 'react';

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
): { data: T[]; error?: Error } {
  const [data, setData] = useState<T[]>([]);
  const [error, setError] = useState<Error | undefined>();
  const { sql, params } = query.toSQL();
  const paramsKey = JSON.stringify(params);
  const tablesKey = tables.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(content-keyed subscription) keyed on tablesKey (a stable serialized primitive), not the `tables` array reference itself — see the identical rationale on the effect below.
  const fireOn = useMemo(() => tables.map(table => ({ table })), [tablesKey]);
  // Generation counter: `runQuery` runs on mount and again on every
  // reactive fire as independent, un-cancelled async calls. If two
  // overlapping calls settle out of order (e.g. two rapid writes), an
  // older call's result must not overwrite a newer one.
  const generation = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(content-keyed subscription) sql/params/tables/query are re-derived every render from stable serialized primitives (paramsKey/tablesKey) and a fireOn memoized on tablesKey; depending on their object/array *references* instead would re-subscribe on every render whenever a caller passes an inline literal (e.g. `useLiveQuery(q, ['accounts'])` in JSX) and — because the native callback can fire synchronously — infinite-loop.
  useEffect(() => {
    let alive = true;

    const runQuery = async (): Promise<void> => {
      const myGeneration = ++generation.current;

      const result = await either<unknown, T[]>(async () => query);

      // Out-of-order / unmount guard: an older overlapping run must not win,
      // and a settled run after unmount must not touch state.
      if (!alive || myGeneration !== generation.current) {
        return;
      }

      const settled = first(result, toError);

      if (isLeft(settled)) {
        setError(bifold(settled));

        return;
      }

      setData(bifold(settled));
      setError(undefined);
    };

    void runQuery();

    const subscription = first(
      eitherSync<unknown, () => void>(() =>
        rawDatabase.reactiveExecute({
          query: sql,
          arguments: params,
          fireOn,
          callback: () => void runQuery(),
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

  return { data, error };
}
