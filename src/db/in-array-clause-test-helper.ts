/**
 * Test helper: extract the column name and bound values an
 * `inArray(column, ids)` clause targets. A drizzle `inArray` condition is an
 * `SQL` whose `queryChunks` mix a `Column` instance (its `name` is the
 * SNAKE_CASE column name), a plain ARRAY chunk of bound `Param`s (one per
 * id), and `StringChunk` SQL text — the array-clause counterpart of
 * `sync-state.repo.test.ts`'s `accountIdFromCondition`, which does the same
 * for a single-value `eq(...)` clause. Shared by the holding and account
 * repo tests that assert `clearLoanLinksForHoldingsTx`'s exact predicate
 * (T29 review round 1, I1/M2), whose capture setup is otherwise identical.
 */
export const inArrayClauseFromCondition = (
  condition: unknown,
): { column: string; ids: string[] } => {
  const chunks = (condition as { queryChunks: unknown[] }).queryChunks;
  const columnChunk = chunks.find(
    (chunk): chunk is { name: string } =>
      typeof chunk === 'object' &&
      chunk !== null &&
      typeof (chunk as { name?: unknown }).name === 'string',
  );
  const idsChunk = chunks.find((chunk): chunk is { value: string }[] => Array.isArray(chunk));

  return {
    column: columnChunk?.name ?? '',
    ids: (idsChunk ?? []).map((param) => param.value),
  };
};
