import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

// Test helper: render a drizzle WHERE condition (an `SQL` from `eq`/`and`/
// `isNull`/etc.) to its parameterized SQL text and bound params, via the
// SAME `sqlToQuery` a real query builder uses internally for `.toSQL()` —
// so a test can assert the EXACT predicate a repo function issues (which
// columns, which values, `and`-ed how), not just that SOME `where(...)` was
// called — a weakness the `setCategory`/`setLoanPayment` tests had before
// this helper existed. One dialect instance is enough:
// rendering is pure and carries no connection state.
const dialect = new SQLiteSyncDialect();

export const renderCondition = (condition: unknown): { sql: string; params: unknown[] } => {
  // `sqlToQuery` also returns a `typings` array (bind-value coercion hints)
  // that no caller here cares about — dropped so a test's expected object
  // only has to name `sql` and `params`.
  const { sql, params } = dialect.sqlToQuery(condition as SQL);

  return { sql, params };
};
