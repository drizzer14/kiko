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

/** Splits `rows` into fixed-size chunks, preserving order. The one generic
 * list-chunking primitive in the codebase — `chunkForTable` derives its
 * per-table chunk SIZE from column count and calls this to do the actual
 * slicing; `insertDedupRowsTx`'s `IN_CLAUSE_CHUNK_SIZE` (`transactions.repo.ts`)
 * reuses it directly for its scalar `IN (...)` lookups, which have no
 * column count to derive a size from. */
export const chunkRows = <T>(rows: T[], size: number): T[][] => {
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
 * `restoreDataSnapshot` (`data-transfer/snapshot/restore-snapshot.ts`),
 * `insertDedupRowsTx` (`transactions/repo/transactions.repo.ts`), and
 * `ratesRepo.upsertMany` (`src/rates/repo/rates.repo.ts`) — three insert
 * paths whose row count is caller-controlled (a `.kiko` restore, a
 * Monobank sync or user-picked statement file, a live rate-history
 * response) and unbounded. */
export const chunkForTable = <T>(table: Table, rows: T[]): T[][] => {
  const columnCount = Object.keys(getTableColumns(table)).length;
  const rowsPerChunk = Math.max(1, Math.floor(SAFE_BOUND_PARAMETER_LIMIT / columnCount));
  return chunkRows(rows, rowsPerChunk);
};
