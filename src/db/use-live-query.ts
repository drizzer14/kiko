import { useEffect, useMemo, useState } from 'react';
import { rawDatabase } from './client';

type SQLQuery<T> = { toSQL(): { sql: string; params: unknown[] } } & PromiseLike<T[]>;

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(content-keyed subscription) sql/params/tables/query are re-derived every render from stable serialized primitives (paramsKey/tablesKey) and a fireOn memoized on tablesKey; depending on their object/array *references* instead would re-subscribe on every render whenever a caller passes an inline literal (e.g. `useLiveQuery(q, ['accounts'])` in JSX) and — because the native callback can fire synchronously — infinite-loop.
  useEffect(() => {
    let alive = true;

    const runQuery = async () => {
      try {
        const rows = await query;
        if (!alive) return;
        setData(rows);
        setError(undefined);
      } catch (caught) {
        if (!alive) return;
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      }
    };

    void runQuery();

    try {
      const unsubscribe = rawDatabase.reactiveExecute({
        query: sql,
        arguments: params,
        fireOn,
        callback: () => void runQuery(),
      });
      return () => {
        alive = false;
        unsubscribe();
      };
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
      return () => {
        alive = false;
      };
    }
  }, [sql, paramsKey, fireOn]);

  return { data, error };
}
