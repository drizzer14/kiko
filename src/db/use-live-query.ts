import { useEffect, useMemo, useState } from 'react';
import { rawDatabase } from './client';

type SQLQuery = { toSQL(): { sql: string; params: unknown[] } };

/**
 * Reactive read hook built directly on op-sqlite's `reactiveExecute`
 * primitive (Drizzle's own `useLiveQuery` only supports expo-sqlite).
 *
 * Pass a Drizzle query builder (never an already-`.execute()`d result —
 * that would defeat reactivity) plus the list of table names the query
 * depends on. The callback fires again whenever a `write()` (see
 * `src/db/client.ts`) commits a transaction touching one of `tables`.
 *
 * Callers routinely pass `tables` (and sometimes `query`) as a fresh
 * array/object literal on every render — e.g.
 * `useLiveQuery(accountsRepo.list(), ['accounts'])` inline in a
 * component. The subscription's re-run condition is therefore keyed on
 * the *serialized content* of `sql`/`params`/`tables`, not their object
 * identity: keying on identity would re-subscribe (and, because the
 * mock/native callback can fire synchronously inside the effect, could
 * infinite-loop) on every single render.
 */
export function useLiveQuery<T>(query: SQLQuery, tables: string[]): { data: T[]; error?: Error } {
  const [data, setData] = useState<T[]>([]);
  const [error, setError] = useState<Error | undefined>();
  const { sql, params } = query.toSQL();
  const paramsKey = JSON.stringify(params);
  const tablesKey = tables.join(',');
  const fireOn = useMemo(() => tablesKey.split(',').map(table => ({ table })), [tablesKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(content-keyed subscription) params/tables are re-derived every render from stable serialized primitives (paramsKey/tablesKey); depending on the `params` array or `fireOn` object *reference* instead would re-subscribe on every render whenever a caller passes an inline array/object literal (a normal calling pattern, e.g. `useLiveQuery(q, ['accounts'])` in JSX) and — because the native/mock callback can fire synchronously inside the effect — infinite-loop.
  useEffect(() => {
    try {
      const unsubscribe = rawDatabase.reactiveExecute({
        query: sql,
        arguments: params,
        fireOn,
        callback: (response: { rows: T[] }) => setData(response.rows ?? []),
      });
      return unsubscribe;
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
      return undefined;
    }
  }, [sql, paramsKey, fireOn]);

  return { data, error };
}
