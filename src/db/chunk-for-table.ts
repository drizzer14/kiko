import { type Table, getTableColumns } from 'drizzle-orm';

// Each row binds one parameter per PRESENT key (nulls included — Drizzle
// still binds them, `drizzle-orm/sqlite-core/dialect.js:362-380`), and
// SQLite rejects a statement with more than SQLITE_MAX_VARIABLE_NUMBER
// (32766) bound parameters — the same ceiling `rateHistoryRepo.upsertMany`
// (`src/rates/rate-history-repo/rate-history.repo.ts`) chunks around. A
// FIXED rows-per-chunk constant broke this once already: T29 added 3
// columns to `transactions` (15 -> 18) and pushed `restoreDataSnapshot`'s
// old 2000-row chunk from 30000 params (safe) to 36000 (over the limit) — a
// `.kiko` backup with >= 1821 transactions failed to restore, and
// `insertDedupRowsTx`'s single unchunked insert failed the same way past
// ~2980 rows for a statement import and ~2731 for a Monobank sync (T29
// review round 1, C1 and M6). Deriving the chunk size from EACH table's own
// column count, every time, means a future column can never silently
// repeat this: the widest table just gets a smaller chunk.
const SAFE_BOUND_PARAMETER_LIMIT = 32000;

const chunkRows = <T>(rows: T[], size: number): T[][] => {
  const parts: T[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    parts.push(rows.slice(start, start + size));
  }
  return parts;
};

/** Chunks `rows` for `table` at the largest size that keeps every insert's
 * bound-parameter count under `SAFE_BOUND_PARAMETER_LIMIT`, computed from
 * the table's OWN column count rather than a fixed row count — see the
 * doc comment above `SAFE_BOUND_PARAMETER_LIMIT`. Shared by
 * `restoreDataSnapshot` (`data-transfer/snapshot/restore-snapshot.ts`) and
 * `insertDedupRowsTx` (`transactions/repo/transactions.repo.ts`), the two
 * insert paths whose row count is caller-controlled and unbounded. */
export const chunkForTable = <T>(table: Table, rows: T[]): T[][] => {
  const columnCount = Object.keys(getTableColumns(table)).length;
  const rowsPerChunk = Math.max(1, Math.floor(SAFE_BOUND_PARAMETER_LIMIT / columnCount));
  return chunkRows(rows, rowsPerChunk);
};
