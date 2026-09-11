/*
 Backfill the per-connection `sync_state` cursor from the global `settings` one.

 Migration 0027 added `sync_state`, which de-globalizes the Monobank sync cursor
 the app previously kept as single-row `settings` columns (`last_sync_at`,
 `last_full_sync_at`, `last_sync_display_at`, `failed_sync_monobank_ids`). The
 sync now reads and writes those cursors PER connected account via
 `sync_state`, keyed by `accounts.id` (see `src/monobank/sync.ts`).

 An already-connected user has exactly one account with `institution = 'monobank'`
 today, and its cursor lives in `settings`. Copy that cursor into a `sync_state`
 row for that account so the first post-upgrade sync resumes from the existing
 cursor rather than doing a slow full re-fetch of every card. A never-connected
 user (no `institution = 'monobank'` account) matches nothing and this is a
 no-op.

 The `NOT EXISTS` guard makes this idempotent and safe to re-run: once a row for
 the account exists (from this backfill or from a real sync that has since
 advanced the cursor via `syncStateRepo`), the insert is skipped, so it never
 clobbers an advanced cursor. This is a DATA-only migration — no schema change —
 so `drizzle-kit generate` produces nothing and there is no `0028_snapshot.json`
 (modeled on the data-only `0022_backfill_last_full_sync_at.sql`).
*/
INSERT INTO `sync_state` (`account_id`, `last_sync_at`, `last_full_sync_at`, `last_sync_display_at`, `failed_sync_monobank_ids`)
SELECT `a`.`id`, `s`.`last_sync_at`, `s`.`last_full_sync_at`, `s`.`last_sync_display_at`, `s`.`failed_sync_monobank_ids`
FROM `accounts` `a` CROSS JOIN `settings` `s`
WHERE `a`.`institution` = 'monobank' AND NOT EXISTS (SELECT 1 FROM `sync_state` `x` WHERE `x`.`account_id` = `a`.`id`);
