/*
 Namespace every SYNCED transaction's `external_id` by its holding's account id.

 The `(source, external_id)` unique index (`transactions_source_external` in
 `src/db/schema.ts`) is GLOBAL — it is shared across every connection of every
 provider. Monobank statement ids are globally unique, so two Monobank
 connections were always safe. But Binance deposit/withdrawal record ids are only
 PER-ACCOUNT sequences: two Binance connections can each emit `deposit:<id>` with
 the SAME raw id. Once the multi-account plan removed the one-connection-per-
 provider invariant, that shared key let the second connection's upsert refresh
 the FIRST connection's row instead of inserting its own — a real correctness bug
 (Risk R-1).

 The sync now writes `external_id` as `${account_id}:${sourceId}` (see
 `mapStatementItem` in `src/monobank/sync.ts` and `depositRow`/`withdrawalRow` in
 `src/crypto-sync/binance/binance.transactions.ts`), so every connection's
 keyspace is disjoint. This backfill rewrites the rows that already exist to that
 exact form, derived by joining `transactions.holding_id -> holdings.account_id`,
 so a re-sync of a pre-migration row matches its backfilled row IN PLACE rather
 than inserting a duplicate.

 Only `monobank` / `binance` rows are touched — a `manual` row carries a null
 `external_id` and is left alone (and excluded by `source` anyway).

 IDEMPOTENT: the `NOT LIKE h.account_id || ':%'` guard rewrites only a row whose
 external id does NOT already begin with its holding's `${account_id}:`, so a
 second run — or a row a Phase-6 sync already wrote in the namespaced form — is a
 no-op and can never double-prefix. Account ids are v4 UUIDs (no `%`/`_`), so the
 LIKE pattern carries no unintended wildcard. A row whose holding is missing
 matches nothing in the `EXISTS`/`SET` join and is left untouched, never nulled.

 This is a DATA-only migration — no schema change — so `drizzle-kit generate`
 produces nothing and there is no `0029_snapshot.json` (modeled on the data-only
 `0022_backfill_last_full_sync_at.sql` / `0028_backfill_sync_state.sql`).
*/
UPDATE `transactions`
SET `external_id` = (
  SELECT `h`.`account_id` || ':' || `transactions`.`external_id`
  FROM `holdings` `h`
  WHERE `h`.`id` = `transactions`.`holding_id`
)
WHERE `source` IN ('monobank', 'binance')
  AND `external_id` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `holdings` `h`
    WHERE `h`.`id` = `transactions`.`holding_id`
      AND `transactions`.`external_id` NOT LIKE `h`.`account_id` || ':%'
  );
