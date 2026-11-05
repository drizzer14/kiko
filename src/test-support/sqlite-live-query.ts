import maybe, { foldMap } from 'fnts/maybe';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { applyAllMigrations, databaseClientOver } from './real-sqlite';

/**
 * A whole data layer for a navigator test: a real migrated `node:sqlite` database behind the
 * real repositories (`@kiko/db/client`). The REAL `useLiveQuery` runs on it: the `rawDatabase`
 * double answers its `reactiveExecute` and fires the callback when a write to a listed table
 * commits. A test file mocks `@kiko/db/client` with `clientModule()` through a `require` of this
 * module in its factory, and calls `openSqliteWorld` before each test.
 */

type Subscriber = { tables: readonly string[]; fire: () => void };

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

// The one native call the real `useLiveQuery` makes: it registers a trigger on a table list and
// answers with the way to stop it. The trigger query itself is never run.
const reactiveExecute = ({
  fireOn,
  callback,
}: {
  fireOn: readonly { table: string }[];
  callback: () => void;
}): (() => void) => {
  const subscriber: Subscriber = { tables: fireOn.map(({ table }) => table), fire: callback };

  subscribers.add(subscriber);

  return () => {
    subscribers.delete(subscriber);
  };
};

/** What a `jest.mock('@kiko/db/client', ...)` factory returns. */
export const clientModule = () => ({
  ...databaseClientOver(() => {
    if (committed.engine === undefined) {
      throw new Error('sqlite-live-query: openSqliteWorld was not called before the first query');
    }

    return observed(committed.engine);
  }),
  rawDatabase: { reactiveExecute },
});
