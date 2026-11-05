import maybe, { foldMap } from 'fnts/maybe';
import { useEffect, useRef, useState } from 'react';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { applyAllMigrations, databaseClientOver } from './real-sqlite';

/**
 * A whole data layer for a navigator test: a real migrated `node:sqlite` database behind the
 * real repositories (`@kiko/db/client`), and a live-query hook that reads the real query on it and
 * reads again when a write to one of its tables commits. A test file mocks `@kiko/db/client` with
 * `clientModule()` and `@kiko/db/use-live-query` with `liveQueryModule()`, each through a
 * `require` of this module in its factory, and calls `openSqliteWorld` before each test.
 * The hook keeps the contract of the real one that a screen depends on: a disabled read answers
 * `[]` and not loading, a read is loading until it has answered for its own query, and a
 * `paused` read defers a fire to one read when it resumes.
 */

type Subscriber = { tables: readonly string[]; fire: () => void };

type Settled<Row> = { key?: string; rows: Row[]; error?: Error; isFresh: boolean };

const subscribers = new Set<Subscriber>();
const committed = { engine: undefined as DatabaseSync | undefined };
const pending = { inTransaction: false, tables: new Set<string>() };

const WRITE_STATEMENT =
  /^\s*(?:insert\s+(?:or\s+\w+\s+)?into|update(?:\s+or\s+\w+)?|delete\s+from)\s+["`]?(\w+)/i;

const fireFor = (tables: ReadonlySet<string>): void => {
  for (const subscriber of [...subscribers]) {
    if (subscriber.tables.some((table) => tables.has(table))) {
      subscriber.fire();
    }
  }
};

const changed = (tables: readonly string[]): void => {
  if (pending.inTransaction) {
    for (const table of tables) {
      pending.tables.add(table);
    }

    return;
  }

  fireFor(new Set(tables));
};

// The engine a repository sees: every write is reported to the subscribers once it commits.
const observed = (database: DatabaseSync): DatabaseSync => {
  const prepare = (statementText: string) => {
    const statement = database.prepare(statementText);
    const written = foldMap(maybe(WRITE_STATEMENT.exec(statementText)?.[1]), (table) => [table]);

    if (written === undefined) {
      return statement;
    }

    const run = (...parameters: SQLInputValue[]) => {
      const result = statement.run(...parameters);

      changed(written);

      return result;
    };

    return new Proxy(statement, {
      get: (target, property) => {
        if (property === 'run') {
          return run;
        }

        const member = Reflect.get(target, property);

        return typeof member === 'function' ? member.bind(target) : member;
      },
    });
  };

  const exec = (statementText: string): void => {
    database.exec(statementText);

    if (statementText === 'BEGIN') {
      pending.inTransaction = true;
    } else if (statementText === 'COMMIT' || statementText === 'ROLLBACK') {
      const tables = statementText === 'COMMIT' ? new Set(pending.tables) : new Set<string>();

      pending.inTransaction = false;
      pending.tables.clear();
      fireFor(tables);
    }
  };

  return { prepare, exec } as unknown as DatabaseSync;
};

/** A fresh migrated database for the test that is about to run. */
export const openSqliteWorld = (): DatabaseSync => {
  committed.engine?.close();
  pending.inTransaction = false;
  pending.tables.clear();
  subscribers.clear();

  const database = new DatabaseSync(':memory:');

  applyAllMigrations(database);
  committed.engine = database;

  return database;
};

export const closeSqliteWorld = (): void => {
  committed.engine?.close();
  committed.engine = undefined;
  subscribers.clear();
};

/** What a `jest.mock('@kiko/db/client', ...)` factory returns. */
export const clientModule = () =>
  databaseClientOver(() => {
    if (committed.engine === undefined) {
      throw new Error('sqlite-live-query: openSqliteWorld was not called before the first query');
    }

    return observed(committed.engine);
  });

type LiveQuery<Row> = { toSQL(): { sql: string; params: unknown[] } } & PromiseLike<Row[]>;

const useSqliteLiveQuery = <Row>(
  query: LiveQuery<Row>,
  tables: string[],
  enabled = true,
  { paused = false }: { cached?: boolean; paused?: boolean } = {},
) => {
  const { sql, params } = query.toSQL();
  const paramsKey = JSON.stringify(params);
  const key = `${sql}::${paramsKey}`;
  const tablesKey = tables.join(',');
  const [settled, setSettled] = useState<Settled<Row>>({ rows: [], isFresh: false });
  const generation = useRef(0);
  const applied = useRef(0);
  const isPaused = useRef(paused);
  const isDirty = useRef(false);
  const read = useRef<(() => Promise<void>) | undefined>(undefined);

  useEffect(() => {
    isPaused.current = paused;

    if (!paused && isDirty.current) {
      isDirty.current = false;
      read.current?.();
    }
  }, [paused]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(content-keyed subscription)
  useEffect(() => {
    if (!enabled) {
      setSettled({ rows: [], isFresh: false });

      return;
    }

    let alive = true;

    const run = async (): Promise<void> => {
      generation.current += 1;

      const mine = generation.current;

      let next: Settled<Row>;

      try {
        next = { key, rows: await query, isFresh: !isDirty.current };
      } catch (caught) {
        next = {
          key,
          rows: [],
          error: caught instanceof Error ? caught : new Error(String(caught)),
          isFresh: false,
        };
      }

      if (mine <= applied.current || !alive) {
        return;
      }

      applied.current = mine;
      setSettled(next);
    };

    read.current = run;
    isDirty.current = false;
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
    run();

    const subscriber: Subscriber = {
      tables,
      fire: () => {
        if (isPaused.current) {
          isDirty.current = true;

          return;
        }

        // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
        run();
      },
    };

    subscribers.add(subscriber);

    return () => {
      alive = false;
      subscribers.delete(subscriber);
      read.current = undefined;
    };
  }, [sql, paramsKey, tablesKey, enabled]);

  return {
    data: enabled ? settled.rows : [],
    error: settled.error,
    isLoading: enabled && settled.key !== key,
    isFresh: !enabled || (settled.key === key && settled.isFresh),
  };
};

/** What a `jest.mock('@kiko/db/use-live-query', ...)` factory returns. */
export const liveQueryModule = () => ({
  ...jest.requireActual('@kiko/db/use-live-query'),
  useLiveQuery: useSqliteLiveQuery,
});
